/**
 * Who changed the files a turn changed. The folder's stamps before and after a turn say which
 * files changed during it (ADR 0031), not who changed them: with two threads' turns at once, or
 * the user editing while an agent works, each turn would be credited with everyone's files.
 *
 * A witness is opened as a turn sets out for its agent, and hears, until the turn is over, every
 * file the server is told was written and for whom (`DesignFiles.writes`: a thread's agent through
 * the editor or its MCP tools, the editor's user) and every file the agent's tool calls name as
 * edited. It is crowded when something else changed files meanwhile: another thread's turn was
 * open at the same time, or a file was written for the user or another thread. A turn that was
 * not crowded keeps every file the stamps found, what its agent's shell wrote included, which the
 * server never hears of; a crowded one keeps the files its agent was seen writing, and the rest
 * changed during it, by someone not known.
 */
import { Effect, Exit, Scope } from "effect";
import type { OpenProject } from "../../project.ts";
import { DesignFiles, type FileWrite } from "../design-files.ts";

/** A turn's files: its agent's, and those changed during it by someone not known. */
export interface TurnFiles {
  readonly changedDuring?: readonly string[];
  readonly changedFiles: readonly string[];
}

export interface TurnWitness {
  /** A file the agent edits, by its path in the repository: one its tool call names. */
  readonly claim: (file: string) => void;
  /** The witness stops hearing: the turn is over. What it heard is kept for `split`. */
  readonly close: Effect.Effect<void>;
  /** The files the stamps found changed during the turn, as the agent's and the rest. */
  readonly split: (changed: readonly string[]) => TurnFiles;
}

interface Open {
  crowded: boolean;
}

/** The witnesses of every thread's turns, which tell each other they overlap. */
export const makeTurnWitnesses = (project: OpenProject["Service"]) => {
  const open = new Set<Open>();

  /** A witness for a turn of `threadId`, hearing from now on. */
  const witness = Effect.fnUntraced(function* (threadId: string) {
    const scope = yield* Scope.make();
    // A project closed meanwhile tells nothing: the stamps alone then say what changed.
    const since = yield* project
      .use(Effect.map(DesignFiles, (files) => files.writes))
      .pipe(
        Effect.flatMap(Scope.provide(scope)),
        Effect.orElseSucceed(() => Effect.succeed<readonly FileWrite[]>([]))
      );
    const self: Open = { crowded: open.size > 0 };
    for (const other of open) {
      other.crowded = true;
    }
    open.add(self);
    const claimed = new Set<string>();

    /** What was written since last heard: the agent's own, or someone else's. */
    const hear = Effect.map(since, (writes) => {
      for (const { by, file } of writes) {
        if (by._tag === "Thread" && by.threadId === threadId) {
          claimed.add(file);
        } else if (by._tag !== "Unknown") {
          self.crowded = true;
        }
      }
    });

    const close = Effect.suspend(() =>
      open.delete(self)
        ? Effect.andThen(hear, Scope.close(scope, Exit.void))
        : Effect.void
    );

    return {
      claim: (file) => {
        claimed.add(file);
      },
      close,
      split: (changed) => {
        if (!self.crowded) {
          return { changedFiles: changed };
        }
        const changedFiles = changed.filter((f) => claimed.has(f));
        const changedDuring = changed.filter((f) => !claimed.has(f));
        return changedDuring.length > 0
          ? { changedDuring, changedFiles }
          : { changedFiles };
      },
    } satisfies TurnWitness;
  });

  return { witness };
};
