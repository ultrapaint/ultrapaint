import type { SourceLocation } from "@ultrapaint/contracts/base";
import type {
  EditOp,
  EditResult,
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

interface JournalEntry {
  readonly after: string;
  readonly before: string;
  readonly file: string;
  readonly label: string;
  readonly trackIndex: number | null;
}

export interface SourceFile {
  readonly abs: string;
  readonly content: string;
  readonly hash: string;
}

type EditFailure = NotFound | ForbiddenPath | Stale | Conflict | BadRequest;

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

/**
 * Applies edits to screen files: one writer per file, atomic writes, the target repository's
 * formatter, and an undo journal that is invalidated by external changes.
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

      const fileChanged = (file: string, hash: string) =>
        events.publish("file.changed", { file, hash });

      const apply = Effect.fn("EditService.apply")(function* (
        op: EditOp,
        expectedHash?: string
      ) {
        const rel = fileOf(op);
        if (!paths.isEditable(rel)) {
          return yield* new ForbiddenPath({
            message: `${rel} is outside the designs directory`,
          });
        }
        return yield* exclusive(
          Effect.gen(function* () {
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
            // Positions shift after formatting; an unparsable result just loses the location.
            const location: SourceLocation | null = locate(
              after,
              rel,
              outcome.trackIndex
            );

            // Drop redo entries beyond the cursor, then append.
            journal = [
              ...journal.slice(0, cursor),
              {
                after,
                before: content,
                file: rel,
                label: labelOf(op),
                trackIndex: outcome.trackIndex,
              },
            ].slice(-JOURNAL_LIMIT);
            cursor = journal.length;
            invalidated = undefined;

            yield* fileChanged(rel, afterHash);
            yield* publishState;
            return {
              changed: true,
              file: rel,
              formatted,
              hash: afterHash,
              location,
              warnings: warning
                ? [...outcome.warnings, warning]
                : outcome.warnings,
            } satisfies EditResult;
          })
        );
      });

      /** Moves the cursor one step in either direction, refusing if the file drifted. */
      const step = (direction: "undo" | "redo") =>
        exclusive(
          Effect.suspend(() => {
            const entry =
              direction === "undo" ? journal[cursor - 1] : journal[cursor];
            if (!entry) {
              return Effect.succeed(null);
            }
            const expected = direction === "undo" ? entry.after : entry.before;
            const next = direction === "undo" ? entry.before : entry.after;
            return Effect.gen(function* () {
              const { abs, content } = yield* read(entry.file);
              if (content !== expected) {
                if (direction === "undo") {
                  invalidated = `${entry.file} changed outside the editor since "${entry.label}"; older undo entries were dropped`;
                  journal = journal.slice(cursor);
                  cursor = 0;
                } else {
                  invalidated = `${entry.file} changed outside the editor; redo history was dropped`;
                  journal = journal.slice(0, cursor);
                }
                yield* publishState;
                return yield* new Stale({ message: invalidated });
              }
              yield* Effect.orDie(writeAtomic(abs, next));
              cursor += direction === "undo" ? -1 : 1;
              const hash = hashContent(next);
              yield* fileChanged(entry.file, hash);
              yield* publishState;
              return {
                changed: true,
                file: entry.file,
                formatted: true,
                hash,
                location:
                  direction === "redo"
                    ? locate(next, entry.file, entry.trackIndex)
                    : null,
                warnings: [],
              } satisfies EditResult;
            });
          })
        ).pipe(Effect.withSpan(`EditService.${direction}`));

      return EditService.of({
        apply,
        read,
        redo: step("redo"),
        state: Effect.sync(snapshotState),
        undo: step("undo"),
      });
    })
  );
}
