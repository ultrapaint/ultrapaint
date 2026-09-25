import type {
  EditOp,
  EditResult,
  TransferRequest,
  UndoState,
} from "@ultrapaint/contracts/edit";
import {
  BadRequest,
  Conflict,
  ForbiddenPath,
  NotFound,
  Stale,
} from "@ultrapaint/contracts/errors";
import { SourceEditError } from "@ultrapaint/framework-api/node";
import { Context, Effect, FileSystem, Layer, Path, Semaphore } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { makeWriteAtomic } from "../atomic-write.ts";
import { EventBus } from "../events.ts";
import { hashContent } from "../hash.ts";
import { runCommand } from "../process.ts";
import { ProjectFramework } from "./framework.ts";
import { RepoPaths } from "./repo-paths.ts";

const JOURNAL_LIMIT = 200;

// A full `biome check` can take seconds with type-aware rules; format plus the two rules that
// matter for generated JSX keeps the round trip well under a second.
const BIOME_COMMAND =
  "node_modules/.bin/biome lint --write --unsafe --only=nursery/useSortedClasses --only=correctness/noUnusedImports {file}; node_modules/.bin/biome format --write {file}";
const PRETTIER_COMMAND = "node_modules/.bin/prettier --write {file}";

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
  /** The element to select again on redo. */
  readonly track: { readonly file: string; readonly index: number } | null;
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

const fileOf = (op: EditOp): string =>
  op.kind === "insert" ? op.into.file : op.target.file;

const labelOf = (op: EditOp): string => {
  switch (op.kind) {
    case "setClasses":
      return `Change classes (${[...op.add, ...op.remove.map((r) => `-${r}`)].join(" ")})`;
    case "setAttribute":
      return op.value === null ? `Remove ${op.name}` : `Set ${op.name}`;
    case "setText":
      return "Edit text";
    case "delete":
      return "Delete element";
    case "duplicate":
      return "Duplicate element";
    case "move":
      return "Move element";
    default:
      return "Insert element";
  }
};

/** A framework's source editor is pure and throws; here its failures become wire errors. */
const sourceFailure = (file: string) => (error: unknown) => {
  if (error instanceof SourceEditError) {
    return error.code === "not_found"
      ? new NotFound({ message: error.message })
      : new Conflict({ message: error.message });
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new BadRequest({ message: `${file} cannot be parsed: ${reason}` });
};

/** What an element moved to another file still refers to in the one it left. */
export const unresolvedWarning = (
  extracted: { readonly name: string; readonly unresolved: readonly string[] },
  file: string
): string[] =>
  extracted.unresolved.length === 0
    ? []
    : [
        `${extracted.name} uses ${extracted.unresolved.join(", ")} from ${file}; the copy may not render until they are replaced`,
      ];

/**
 * What an action does to files inside a transaction. Every change is recorded, and the whole
 * transaction becomes one undo step.
 */
export interface EditTransaction {
  readonly apply: (
    op: EditOp,
    expectedHash?: string
  ) => Effect.Effect<EditResult, EditFailure>;
  /** A new file, formatted like an edit unless `format` is false. */
  readonly create: (
    rel: string,
    content: string,
    options?: { readonly format?: boolean }
  ) => Effect.Effect<void, EditFailure>;
  readonly remove: (rel: string) => Effect.Effect<void, EditFailure>;
  /** Writes the file as given, whether it exists or not. Writing what is there changes nothing. */
  readonly write: (
    rel: string,
    content: string
  ) => Effect.Effect<void, EditFailure>;
}

/**
 * Applies edits to design files: atomic writes, the target repository's formatter, and one
 * undo journal for everything the editor changes — source edits, files created and deleted,
 * the canvas layout. An action spanning several files is one step; the journal is invalidated
 * by changes made outside the editor.
 */
export class EditService extends Context.Service<
  EditService,
  {
    readonly apply: (
      op: EditOp,
      expectedHash?: string
    ) => Effect.Effect<EditResult, EditFailure>;
    readonly read: (
      rel: string
    ) => Effect.Effect<SourceFile, NotFound | ForbiddenPath>;
    readonly redo: Effect.Effect<EditResult | null, EditFailure>;
    readonly state: Effect.Effect<UndoState>;
    /**
     * Runs `body` as one undoable action. Nothing else touches the journal meanwhile, and a
     * failure puts back what the body had already changed.
     */
    readonly transaction: <A, E>(
      label: string,
      body: (tx: EditTransaction) => Effect.Effect<A, E>
    ) => Effect.Effect<A, E | EditFailure>;
    /**
     * Moves or copies an element, within its file or into another, with the imports and the
     * helpers it needs. One undo step either way.
     */
    readonly transfer: (
      request: TransferRequest,
      tx?: EditTransaction
    ) => Effect.Effect<EditResult, EditFailure>;
    readonly undo: Effect.Effect<EditResult | null, EditFailure>;
  }
>()("ultrapaint/server/EditService") {
  static readonly layer = Layer.effect(
    EditService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const framework = yield* ProjectFramework;
      // Null when nothing is tracked, and when the framework cannot parse the result.
      const locate = (
        code: string,
        file: string,
        trackIndex: number | null
      ) => {
        if (trackIndex === null) {
          return null;
        }
        try {
          return framework.source.locate(code, file, trackIndex);
        } catch {
          return null;
        }
      };
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
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

      const formatter = Effect.gen(function* () {
        if (paths.settings.formatCommand) {
          return paths.settings.formatCommand;
        }
        const bin = (name: string) =>
          exists(path.join(paths.root, "node_modules", ".bin", name));
        if (yield* bin("biome")) {
          return BIOME_COMMAND;
        }
        return (yield* bin("prettier")) ? PRETTIER_COMMAND : undefined;
      });

      const format = Effect.fnUntraced(function* (rel: string) {
        const command = yield* formatter;
        if (!command) {
          return { formatted: false, warning: undefined };
        }
        const shell = command.replaceAll("{file}", JSON.stringify(rel));
        const result = yield* runCommand("/bin/sh", ["-c", shell], {
          cwd: paths.root,
          timeout: "15 seconds",
        }).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          ),
          Effect.map((r) => ({
            ok: r.exitCode === 0,
            output: r.stdout + r.stderr,
          })),
          // A formatter that cannot run or hangs is a warning on the edit, not a failed edit.
          Effect.catch((error) =>
            Effect.succeed({ ok: false, output: error.message })
          )
        );
        return result.ok
          ? { formatted: true, warning: undefined }
          : {
              formatted: false,
              warning: `formatter failed: ${result.output.trim().split("\n").slice(-3).join(" ")}`,
            };
      });

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
        let track: JournalEntry["track"] = null;
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

        const apply = Effect.fn("EditService.apply")(function* (
          op: EditOp,
          expectedHash?: string
        ) {
          const rel = fileOf(op);
          yield* editable(rel);
          const { abs, content, hash } = yield* read(rel);
          if (expectedHash && expectedHash !== hash) {
            return yield* new Stale({
              message: "the file changed since you last saw it; reloading",
            });
          }
          const outcome = yield* Effect.try({
            catch: sourceFailure(rel),
            try: () => framework.source.apply(op, content),
          });
          if (outcome.code === content) {
            return {
              changed: false,
              file: rel,
              formatted: false,
              hash,
              location: null,
              warnings: outcome.warnings,
            } satisfies EditResult;
          }
          yield* Effect.orDie(writeAtomic(abs, outcome.code));
          const { formatted, warning } = yield* format(rel);
          const after = yield* Effect.orDie(fs.readFileString(abs));
          const afterHash = hashContent(after);
          record(rel, content, after);
          if (outcome.trackIndex !== null) {
            track = { file: rel, index: outcome.trackIndex };
          }
          yield* fileChanged(rel, afterHash);
          return {
            changed: true,
            file: rel,
            formatted,
            hash: afterHash,
            // Positions shift after formatting; an unparsable result just loses the location.
            location: locate(after, rel, outcome.trackIndex),
            warnings: warning
              ? [...outcome.warnings, warning]
              : outcome.warnings,
          } satisfies EditResult;
        });

        const create = Effect.fn("EditService.create")(function* (
          rel: string,
          content: string,
          options?: { readonly format?: boolean }
        ) {
          yield* editable(rel);
          const abs = yield* paths.resolve(rel);
          if (yield* exists(abs)) {
            return yield* new Conflict({ message: `${rel} already exists` });
          }
          yield* Effect.orDie(writeAtomic(abs, content));
          if (options?.format !== false) {
            yield* format(rel);
          }
          const after = yield* Effect.orDie(fs.readFileString(abs));
          record(rel, null, after);
          yield* fileChanged(rel, hashContent(after));
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

        const tx: EditTransaction = { apply, create, remove, write };
        return {
          changes: () => changes.filter((c) => c.before !== c.after),
          track: () => track,
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
                  { changes, label, track: r.track() },
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

      const apply = (op: EditOp, expectedHash?: string) =>
        transaction(labelOf(op), (tx) => tx.apply(op, expectedHash));

      const transferIn = Effect.fn("EditService.transfer")(function* (
        tx: EditTransaction,
        { copy, index, into, target }: TransferRequest
      ) {
        if (target.file === into.file && !copy) {
          return yield* tx.apply({ index, into, kind: "move", target });
        }
        yield* editable(target.file);
        const { content } = yield* read(target.file);
        const extracted = yield* Effect.try({
          catch: sourceFailure(target.file),
          try: () => framework.source.extract(content, target, into.file),
        });
        const inserted = yield* tx.apply({
          declarations: extracted.declarations,
          imports: extracted.imports,
          index,
          into,
          jsx: extracted.jsx,
          kind: "insert",
        });
        if (!copy) {
          yield* tx.apply({ kind: "delete", target });
        }
        return {
          ...inserted,
          warnings: [
            ...inserted.warnings,
            ...unresolvedWarning(extracted, target.file),
          ],
        } satisfies EditResult;
      });

      const transfer = (request: TransferRequest, tx?: EditTransaction) =>
        tx
          ? transferIn(tx, request)
          : transaction(request.copy ? "Copy element" : "Move element", (t) =>
              transferIn(t, request)
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

      /** What the step reports: the file the action was about, as the step left it. */
      const resultOf = (entry: JournalEntry, undoing: boolean): EditResult => {
        const primary =
          entry.changes.find((c) => c.file === entry.track?.file) ??
          (entry.changes[0] as FileChange);
        const content = undoing ? primary.before : primary.after;
        return {
          changed: true,
          file: primary.file,
          formatted: true,
          hash: content === null ? "" : hashContent(content),
          location:
            !undoing && entry.track && content !== null
              ? locate(content, entry.track.file, entry.track.index)
              : null,
          warnings: [],
        };
      };

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
            return resultOf(entry, undoing);
          })
        ).pipe(Effect.withSpan(`EditService.${direction}`));

      return EditService.of({
        apply,
        read,
        redo: step("redo"),
        state: Effect.sync(snapshotState),
        transaction,
        transfer,
        undo: step("undo"),
      });
    })
  );
}
