/**
 * The pages as they were before the turns a round covers (ADR 0156), read from the designs'
 * history (ADR 0087): each of the thread's turns keeps a point, and a point's `compare` gives
 * every page it changed as it was before it. What the checks read on a page is what changed
 * since then; a page with no before is read whole.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { Effect } from "effect";
import { OpenProject } from "../../project.ts";
import { History } from "../history.ts";

/** Each page as it was before the first of the turns that changed it; null for one they made. */
export type Befores = ReadonlyMap<string, DesignNode | null>;

export const makeTurnBefores = Effect.fnUntraced(function* () {
  const project = yield* OpenProject;

  /**
   * The pages, repository-relative, as they were before the thread's turns that ended after
   * `since`, the first that changed each; a page none of them changed is not there. No turn
   * runs under a review: one that ended after the last round started came after that round.
   */
  return (
    threadId: string,
    since: number,
    pages: readonly string[]
  ): Effect.Effect<Befores> =>
    project
      .use(
        Effect.gen(function* () {
          const befores = new Map<string, DesignNode | null>();
          const history = yield* Effect.serviceOption(History);
          if (history._tag === "None") {
            return befores;
          }
          const wanted = new Set(pages);
          const { points } = yield* history.value.get;
          // Oldest first, so that each page is taken as the first of them found it.
          const turns = points
            .filter(
              (p) =>
                p.kind === "turn" && p.threadId === threadId && p.at > since
            )
            .reverse();
          for (const point of turns) {
            if (!point.files.some((f) => wanted.has(f) && !befores.has(f))) {
              continue;
            }
            for (const change of yield* history.value.compare(point.id)) {
              if (wanted.has(change.file) && !befores.has(change.file)) {
                befores.set(change.file, change.before);
              }
            }
          }
          return befores;
        })
      )
      .pipe(
        // A history that can't say (the project closed, a point gone) leaves every page with no
        // before: the checks read them whole, as they did before the history was asked.
        Effect.orElseSucceed((): Befores => new Map())
      );
});
