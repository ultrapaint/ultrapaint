import type { UndoResult, UndoState } from "@ultrapaint/contracts/edit";
import {
  type BadRequest,
  Conflict,
  ForbiddenPath,
  NotFound,
  Stale,
} from "@ultrapaint/contracts/errors";
import { Context, Effect, FileSystem, Layer, Path, Semaphore } from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { EventBus } from "../events.ts";
import { makeExists } from "../fs-exists.ts";
import { hashContent } from "../hash.ts";
import { RepoPaths } from "./repo-paths.ts";

const JOURNAL_LIMIT = 200;
/**
 * The text the journal may hold, before and after, across its steps. Each step keeps whole
 * copies of the files it touched: two hundred steps over a large page would hold hundreds of
 * megabytes. The newest step is always kept.
 */
const JOURNAL_CHARS = 32 * 1024 * 1024;

/** One file as an action left it: `null` is a file that does not exist. */
interface FileChange {
  after: string | null;
  before: string | null;
  readonly file: string;
}

/** A file a step moved, by its name before and after. */
interface FileMove {
  readonly from: string;
  readonly to: string;
}

/** One undo step: everything a single action changed, in every file it touched. */
interface JournalEntry {
  readonly changes: readonly FileChange[];
  readonly label: string;
  /** Files it moved: what names a file in one state names it differently in another. */
  readonly moves?: readonly FileMove[];
}

/** The name `file` has after the steps, applied in order. */
const forwardThrough = (entries: readonly JournalEntry[], file: string) =>
  entries.reduce(
    (name, entry) => entry.moves?.find((m) => m.from === name)?.to ?? name,
    file
  );

/** The name `file` had before the steps, taken back newest first. */
const backThrough = (entries: readonly JournalEntry[], file: string) =>
  entries.reduceRight(
    (name, entry) => entry.moves?.find((m) => m.to === name)?.from ?? name,
    file
  );

const sizeOf = (entry: JournalEntry) =>
  entry.changes.reduce(
    (sum, c) => sum + (c.before?.length ?? 0) + (c.after?.length ?? 0),
    0
  );

/** The newest steps that fit the journal's limits, at least the newest one. */
export const withinLimits = (
  entries: readonly JournalEntry[]
): JournalEntry[] => {
  const kept: JournalEntry[] = [];
  let chars = 0;
  for (const entry of entries.toReversed()) {
    chars += sizeOf(entry);
    if (
      kept.length > 0 &&
      (kept.length >= JOURNAL_LIMIT || chars > JOURNAL_CHARS)
    ) {
      break;
    }
    kept.push(entry);
  }
  return kept.reverse();
};

export interface SourceFile {
  readonly abs: string;
  readonly content: string;
  readonly hash: string;
}

export type EditFailure =
  | NotFound
  | ForbiddenPath
  | Stale
  | Conflict
  | BadRequest;

/**
 * How a file of the designs is read and written: what its text holds, and the text a value is
 * written as. `decode` is given null for a file that is not there.
 */
export interface FileCodec<A, E = never> {
  readonly decode: (text: string | null) => Effect.Effect<A, E>;
  readonly encode: (value: A) => string;
}

/**
 * What an action does to files inside a transaction. Every change is recorded, and the whole
 * transaction becomes one undo step.
 *
 * Read-modify-write is one rule: whatever a step writes from a file's content, it reads inside
 * the step (`read`, `readDocument`, `updateFile`), under the journal's lock. An edit, an undo, a
 * comment or another action made meanwhile then lands before the step or after it, never between
 * its reading and its writing, so nothing is lost and no module needs a lock of its own for it.
 */
export interface EditTransaction {
  /** A new file; there must not be one there yet. */
  readonly create: (
    rel: string,
    content: string
  ) => Effect.Effect<void, EditFailure>;
  /**
   * Moves a file to a new one, which must not be there yet. Recorded as a move, so that a
   * change carried into the steps (a comment added since) names the file as each step had it.
   */
  readonly move: (from: string, to: string) => Effect.Effect<void, EditFailure>;
  /** The file as it is now, the step's own writes included: its text, or null when there is none. */
  readonly read: (rel: string) => Effect.Effect<string | null, EditFailure>;
  /** The file as it is now, read as the codec says. */
  readonly readDocument: <A, E>(
    rel: string,
    codec: FileCodec<A, E>
  ) => Effect.Effect<A, E | EditFailure>;
  readonly remove: (rel: string) => Effect.Effect<void, EditFailure>;
  /** Writes the file as given, whether it exists or not. Writing what is there changes nothing. */
  readonly write: (
    rel: string,
    content: string
  ) => Effect.Effect<void, EditFailure>;
}

/**
 * Changes a file inside a step: read as the codec says, made into its next value by `f`, and
 * written back, which changes nothing when its text is what is there. Answers with the value as
 * it was.
 */
export const updateFile = <A, E>(
  tx: EditTransaction,
  rel: string,
  codec: FileCodec<A, E>,
  f: (value: A) => A
): Effect.Effect<A, E | EditFailure> =>
  Effect.flatMap(tx.readDocument(rel, codec), (value) =>
    Effect.as(tx.write(rel, codec.encode(f(value))), value)
  );

/**
 * Writes design files: atomic writes and one undo journal for everything the editor changes —
 * documents, files created and deleted, the canvas layout. An action spanning several files is
 * one step; the journal is invalidated by changes made outside the editor.
 */
export class EditService extends Context.Service<
  EditService,
  {
    readonly read: (
      rel: string
    ) => Effect.Effect<SourceFile, NotFound | ForbiddenPath>;
    readonly redo: Effect.Effect<UndoResult | null, EditFailure>;
    readonly state: Effect.Effect<UndoState>;
    /**
     * Runs `body` as one undoable action. Nothing else touches the journal meanwhile, and a
     * failure puts back what the body had already changed.
     */
    readonly transaction: <A, E>(
      label: string,
      body: (tx: EditTransaction) => Effect.Effect<A, E>
    ) => Effect.Effect<A, E | EditFailure>;
    readonly undo: Effect.Effect<UndoResult | null, EditFailure>;
    /**
     * Changes a file outside the undo history, as comments are changed: no step of its own,
     * and undo does not take it back. `update` makes the file's next content from its content
     * now (null when there is none) and says what the change gave. It runs under the journal's
     * lock, and is applied as well to the file as every recorded step left it and found it, so
     * that undoing or redoing a step that touched the file (a page renamed takes its comments
     * along) carries the change and is not refused as an outside edit. `nameIn` says what a
     * file named now was called in the state given: a page moved since has its old name there.
     */
    readonly amend: <A, E>(
      rel: string,
      update: (
        content: string | null,
        nameIn: (file: string) => string
      ) => Effect.Effect<readonly [next: string, result: A], E>
    ) => Effect.Effect<A, E | ForbiddenPath | Conflict>;
  }
>()("ultrapaint/server/EditService") {
  static readonly layer = Layer.effect(
    EditService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      // Edits, undo and redo share one journal, so they run one at a time across all files.
      // Choosing the entry to undo outside the lock would race an edit that is still being
      // formatted, read that as an outside change and drop the whole history.
      const journalLock = yield* Semaphore.make(1);
      const exclusive = journalLock.withPermits(1);

      let journal: JournalEntry[] = [];
      let cursor = 0;
      let invalidated: string | undefined;

      const snapshotState = (): UndoState => {
        const undo = journal[cursor - 1];
        const redo = journal[cursor];
        return {
          canRedo: !!redo,
          canUndo: !!undo,
          invalidated,
          redoLabel: redo?.label,
          undoLabel: undo?.label,
        };
      };
      const publishState = Effect.suspend(() =>
        events.publish("edit.state", snapshotState())
      );

      const exists = makeExists(fs);

      const read = Effect.fn("EditService.read")(function* (rel: string) {
        const abs = yield* paths.resolve(rel);
        if (!(yield* exists(abs))) {
          return yield* new NotFound({ message: `file not found: ${rel}` });
        }
        const content = yield* Effect.orDie(fs.readFileString(abs));
        return { abs, content, hash: hashContent(content) };
      });

      /** The file as it is now; null when there is none. */
      const current = Effect.fnUntraced(function* (rel: string) {
        const abs = yield* paths.resolve(rel);
        return yield* fs.readFileString(abs).pipe(
          Effect.catchReason("PlatformError", "NotFound", () =>
            Effect.succeed(null)
          ),
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `${rel} cannot be read: ${error.message}`,
              })
          )
        );
      });

      /** Puts the file in the given state: its content, or gone. */
      const restore = Effect.fnUntraced(function* (
        rel: string,
        content: string | null
      ) {
        const abs = yield* paths.resolve(rel);
        yield* (
          content === null
            ? fs.remove(abs, { force: true })
            : writeAtomic(abs, content)
        ).pipe(
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `${rel} cannot be written: ${error.message}`,
              })
          )
        );
        yield* fileChanged(rel, content === null ? "" : hashContent(content));
      });

      /**
       * Puts every file in its state, going on past one that cannot be: a step half put back
       * is worse than one with a file left over. Fails with the files that could not be.
       */
      const restoreAll = Effect.fnUntraced(function* (
        states: readonly {
          readonly content: string | null;
          readonly file: string;
        }[]
      ) {
        const failed: string[] = [];
        for (const { content, file } of states) {
          const exit = yield* Effect.exit(restore(file, content));
          if (exit._tag === "Failure") {
            failed.push(file);
            yield* Effect.logError(`${file} could not be put back`, exit.cause);
          }
        }
        if (failed.length > 0) {
          return yield* new Conflict({
            message: `${failed.join(", ")} could not be put back`,
          });
        }
      });

      const fileChanged = (file: string, hash: string) =>
        events.publish("file.changed", { file, hash });

      const editable = (rel: string) =>
        paths.isEditable(rel)
          ? Effect.void
          : Effect.fail(
              new ForbiddenPath({
                message: `${rel} is outside the designs directory`,
              })
            );

      /** A recorder for one transaction; the caller holds the journal lock. */
      const recorder = () => {
        const changes: FileChange[] = [];
        const moves: FileMove[] = [];
        const record = (
          file: string,
          before: string | null,
          after: string | null
        ) => {
          const earlier = changes.find((c) => c.file === file);
          if (earlier) {
            earlier.after = after;
          } else {
            changes.push({ after, before, file });
          }
        };

        const create = Effect.fn("EditService.create")(function* (
          rel: string,
          content: string
        ) {
          yield* editable(rel);
          const abs = yield* paths.resolve(rel);
          if (yield* exists(abs)) {
            return yield* new Conflict({ message: `${rel} already exists` });
          }
          yield* restore(rel, content);
          record(rel, null, content);
        });

        const remove = Effect.fn("EditService.remove")(function* (rel: string) {
          yield* editable(rel);
          const before = yield* current(rel);
          if (before === null) {
            return;
          }
          yield* restore(rel, null);
          record(rel, before, null);
        });

        const write = Effect.fn("EditService.write")(function* (
          rel: string,
          content: string
        ) {
          yield* editable(rel);
          const before = yield* current(rel);
          if (before === content) {
            return;
          }
          yield* restore(rel, content);
          record(rel, before, content);
        });

        const move = Effect.fn("EditService.move")(function* (
          from: string,
          to: string
        ) {
          yield* editable(from);
          const content = yield* current(from);
          if (content === null) {
            return yield* new NotFound({ message: `${from} is not there` });
          }
          yield* create(to, content);
          yield* remove(from);
          moves.push({ from, to });
        });

        const readDocument = <A, E>(rel: string, codec: FileCodec<A, E>) =>
          Effect.flatMap(current(rel), codec.decode);

        const tx: EditTransaction = {
          create,
          move,
          read: current,
          readDocument,
          remove,
          write,
        };
        return {
          changes: () => changes.filter((c) => c.before !== c.after),
          moves: () => [...moves],
          tx,
        };
      };

      const transaction = <A, E>(
        label: string,
        body: (tx: EditTransaction) => Effect.Effect<A, E>
      ): Effect.Effect<A, E | EditFailure> =>
        exclusive(
          Effect.suspend(() => {
            const r = recorder();
            return body(r.tx).pipe(
              // What went through before the failure goes back: an action is all or nothing.
              // A file that cannot be is logged; the action's own failure is what the caller
              // hears.
              Effect.onError(() =>
                restoreAll(
                  r
                    .changes()
                    .toReversed()
                    .map((c) => ({ content: c.before, file: c.file }))
                ).pipe(Effect.ignore)
              ),
              Effect.tap(() => {
                const changes = r.changes();
                if (changes.length === 0) {
                  return Effect.void;
                }
                // Drop redo entries beyond the cursor, then append.
                const moves = r.moves();
                journal = withinLimits([
                  ...journal.slice(0, cursor),
                  moves.length > 0
                    ? { changes, label, moves }
                    : { changes, label },
                ]);
                cursor = journal.length;
                invalidated = undefined;
                return publishState;
              })
            );
          })
        ).pipe(
          Effect.withSpan("EditService.transaction", { attributes: { label } })
        );

      /** The first file the entry touched that is no longer as the entry left it. */
      const drifted = Effect.fnUntraced(function* (
        entry: JournalEntry,
        undoing: boolean
      ) {
        for (const change of entry.changes) {
          const expected = undoing ? change.after : change.before;
          if ((yield* current(change.file)) !== expected) {
            return change.file;
          }
        }
        return null;
      });

      /** Drops the history an outside change made impossible to walk. */
      const invalidate = (
        file: string,
        entry: JournalEntry,
        undoing: boolean
      ) => {
        if (undoing) {
          invalidated = `${file} changed outside the editor since "${entry.label}"; older undo entries were dropped`;
          journal = journal.slice(cursor);
          cursor = 0;
        } else {
          invalidated = `${file} changed outside the editor; redo history was dropped`;
          journal = journal.slice(0, cursor);
        }
        return invalidated;
      };

      /** What the step reports: the files it put back, and the action it was. */
      const resultOf = (entry: JournalEntry): UndoResult => ({
        files: entry.changes.map((c) => c.file),
        label: entry.label,
      });

      /** Puts every file the entry touched back as it was before, or forward as after. */
      const walk = (entry: JournalEntry, undoing: boolean) =>
        restoreAll(
          (undoing ? entry.changes.toReversed() : entry.changes).map(
            (change) => ({
              content: undoing ? change.before : change.after,
              file: change.file,
            })
          )
        );

      const amend = <A, E>(
        rel: string,
        update: (
          content: string | null,
          nameIn: (file: string) => string
        ) => Effect.Effect<readonly [next: string, result: A], E>
      ): Effect.Effect<A, E | ForbiddenPath | Conflict> =>
        exclusive(
          Effect.gen(function* () {
            yield* editable(rel);
            const now = yield* current(rel);
            const [next, result] = yield* update(now, (file) => file);
            if (next === now) {
              return result;
            }
            yield* restore(rel, next);
            // The steps that recorded the file see it changed the same way. A state where it
            // did not exist stays so, and one the change cannot be made to stays as it was.
            const rebase = (
              content: string | null,
              nameIn: (file: string) => string
            ) =>
              content === null
                ? Effect.succeed(null)
                : update(content, nameIn).pipe(
                    Effect.map(([rebased]) => rebased),
                    Effect.orElseSucceed(() => content)
                  );
            // The states before the cursor are the past, the ones after it the steps undone:
            // a file is named in each as the moves between it and now have it.
            for (const [i, entry] of journal.entries()) {
              const past = i < cursor;
              const before = (file: string) =>
                past
                  ? backThrough(journal.slice(i, cursor), file)
                  : forwardThrough(journal.slice(cursor, i), file);
              const after = (file: string) =>
                past
                  ? backThrough(journal.slice(i + 1, cursor), file)
                  : forwardThrough(journal.slice(cursor, i + 1), file);
              for (const change of entry.changes) {
                if (change.file === rel) {
                  change.before = yield* rebase(change.before, before);
                  change.after = yield* rebase(change.after, after);
                }
              }
            }
            return result;
          })
        ).pipe(Effect.withSpan("EditService.amend"));

      /** Moves the cursor one step in either direction, refusing if a file drifted. */
      const step = (direction: "undo" | "redo") =>
        exclusive(
          Effect.gen(function* () {
            const undoing = direction === "undo";
            const entry = undoing ? journal[cursor - 1] : journal[cursor];
            if (!entry) {
              return null;
            }
            const file = yield* drifted(entry, undoing);
            if (file !== null) {
              const message = invalidate(file, entry, undoing);
              yield* publishState;
              return yield* new Stale({ message });
            }
            yield* walk(entry, undoing);
            cursor += undoing ? -1 : 1;
            yield* publishState;
            return resultOf(entry);
          })
        ).pipe(Effect.withSpan(`EditService.${direction}`));

      return EditService.of({
        amend,
        read,
        redo: step("redo"),
        state: Effect.sync(snapshotState),
        transaction,
        undo: step("undo"),
      });
    })
  );
}
