/**
 * The design-system setup's snapshots: the working tree kept as a git tree when a step or a batch
 * starts and ends, each held by a ref named after it, and what putting the tree back to one of
 * them would touch.
 */
import type {
  DesignSystemSetup,
  RestoreEntry,
  SetupStep,
} from "@ultrapaint/contracts/design-system-setup";
import { BadRequest } from "@ultrapaint/contracts/errors";
import { Effect } from "effect";
import { ProjectManager } from "../project.ts";
import { GitService } from "./git.ts";

/** Each snapshot is kept by a ref named after its tree: `refs/ultrapaint/setup/<tree>`. */
const REF_PREFIX = "refs/ultrapaint/setup";

/** Every snapshot a step keeps, its batches' included. */
export const treesOf = (step: SetupStep): string[] =>
  [
    step.before,
    step.after,
    ...(step.batches ?? []).flatMap((b) => [b.before, b.after]),
  ].filter((t) => t !== undefined);

export const makeSetupSnapshots = Effect.gen(function* () {
  const project = yield* ProjectManager;

  const git = <A, E>(f: (g: GitService["Service"]) => Effect.Effect<A, E>) =>
    project.use(Effect.flatMap(GitService, f));

  /** The working tree as it is, as a git tree kept by a ref named after it. */
  const snapshot = git((g) => g.snapshotTree(REF_PREFIX)).pipe(
    Effect.mapError((error) =>
      error._tag === "CommandFailed"
        ? new BadRequest({
            message: `The setup keeps each step as a git snapshot, and git could not take one: ${error.message}`,
          })
        : error
    )
  );

  /** Lets go of the refs of snapshots nothing keeps; steps and batches often share one. */
  const release = Effect.fnUntraced(function* (
    setup: DesignSystemSetup,
    trees: Iterable<string>
  ) {
    const kept = new Set(setup.steps.flatMap(treesOf));
    for (const tree of new Set(trees)) {
      if (!kept.has(tree)) {
        // A ref already gone is what was wanted.
        yield* git((g) => Effect.ignore(g.deleteRef(`${REF_PREFIX}/${tree}`)));
      }
    }
  });

  /**
   * What putting the working tree back to `base` touches: the files the ranges changed, as
   * the working tree has them now.
   */
  const restorePlan = Effect.fnUntraced(function* (
    base: string,
    ranges: readonly { readonly after?: string; readonly before?: string }[]
  ) {
    const now = yield* snapshot;
    const entries = yield* git((g) =>
      Effect.gen(function* () {
        const touched = new Set<string>();
        for (const range of ranges) {
          if (range.before !== undefined) {
            for (const change of yield* g.changedBetween(
              range.before,
              range.after ?? now
            )) {
              touched.add(change.path);
            }
          }
        }
        const changes = yield* g.changedBetween(base, now);
        return changes
          .filter((c) => touched.has(c.path))
          .map(
            (c): RestoreEntry => ({
              action: c.status === "A" ? "delete" : "restore",
              path: c.path,
            })
          );
      })
    );
    return { entries, now };
  });

  return { git, release, restorePlan, snapshot };
});
