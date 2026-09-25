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
import { hashContent } from "../hash.ts";
import { RepoPaths } from "./repo-paths.ts";

const JOURNAL_LIMIT = 200;

/** One file as an action left it: `null` is a file that does not exist. */
interface FileChange {
  after: string | null;
  before: string | null;
  readonly file: string;
}

/** One undo step: everything a single action changed, in every file it touched. */
interface JournalEntry {
  readonly changes: readonly FileChange[];
  readonly label: string;
}

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
 * What an action does to files inside a transaction. Every change is recorded, and the whole
 * transaction becomes one undo step.
 */
export interface EditTransaction {
  /** A new file; there must not be one there yet. */
  readonly create: (
    rel: string,
    content: string
  ) => Effect.Effect<void, EditFailure>;
  readonly remove: (rel: string) => Effect.Effect<void, EditFailure>;
  /** Writes the file as given, whether it exists or not. Writing what is there changes nothing. */
  readonly write: (
    rel: string,
    content: string
  ) => Effect.Effect<void, EditFailure>;
}

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

      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

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
        return (yield* exists(abs))
          ? yield* Effect.orDie(fs.readFileString(abs))
          : null;
      });

      /** Puts the file in the given state: its content, or gone. */
      const restore = Effect.fnUntraced(function* (
        rel: string,
        content: string | null
      ) {
        const abs = yield* paths.resolve(rel);
        if (content === null) {
          yield* Effect.orDie(fs.remove(abs, { force: true }));
        } else {
          yield* Effect.orDie(writeAtomic(abs, content));
        }
        yield* fileChanged(rel, content === null ? "" : hashContent(content));
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
          yield* Effect.orDie(writeAtomic(abs, content));
          record(rel, null, content);
          yield* fileChanged(rel, hashContent(content));
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

        const tx: EditTransaction = { create, remove, write };
        return {
          changes: () => changes.filter((c) => c.before !== c.after),
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
              Effect.onError(() =>
                Effect.forEach(r.changes().toReversed(), (c) =>
                  restore(c.file, c.before).pipe(Effect.ignore)
                )
              ),
              Effect.tap(() => {
                const changes = r.changes();
                if (changes.length === 0) {
                  return Effect.void;
                }
                // Drop redo entries beyond the cursor, then append.
                journal = [
                  ...journal.slice(0, cursor),
                  { changes, label },
                ].slice(-JOURNAL_LIMIT);
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
        Effect.forEach(
          undoing ? entry.changes.toReversed() : entry.changes,
          (change) =>
            restore(change.file, undoing ? change.before : change.after),
          { discard: true }
        );

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
        read,
        redo: step("redo"),
        state: Effect.sync(snapshotState),
        transaction,
        undo: step("undo"),
      });
    })
  );
}
