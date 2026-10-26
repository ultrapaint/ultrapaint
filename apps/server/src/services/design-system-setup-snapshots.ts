/**
 * The design-system setup's snapshots: the project's files kept in the tool's snapshot store when
 * a step or a batch starts and ends, and what putting the files back to one of them would touch.
 * No git is needed (ADR 0023 as amended): the store is in the state directory, and the files are
 * those the folder's `.gitignore` keeps.
 */
import type {
  DesignSystemSetup,
  RestoreEntry,
  SetupStep,
} from "@ultrapaint/contracts/design-system-setup";
import { BadRequest } from "@ultrapaint/contracts/errors";
import { Effect } from "effect";
import { hashContent } from "../hash.ts";
import { ProjectManager } from "../project.ts";
import { RepoPaths } from "./repo-paths.ts";
import { SnapshotStore } from "./snapshot-store.ts";
import { WorkingTree } from "./working-tree.ts";

/** Every snapshot a step keeps, its batches' included. */
export const treesOf = (step: SetupStep): string[] =>
  [
    step.before,
    step.after,
    ...(step.batches ?? []).flatMap((b) => [b.before, b.after]),
  ].filter((t) => t !== undefined);

const unreadable = (error: { readonly message: string }) =>
  new BadRequest({
    message: `${error.message} The setup's snapshots are kept by the tool; one taken by an older version, in git, is not read: redo the setup from its first step.`,
  });

export const makeSetupSnapshots = Effect.gen(function* () {
  const project = yield* ProjectManager;
  const store = yield* SnapshotStore;

  /** The store keeps each project's setup apart: two projects may share a state directory. */
  const namespace = project.use(
    Effect.map(RepoPaths, ({ root }) => `setup/${hashContent(root)}`)
  );

  /** The project's files as they are, kept in the store. Answers the snapshot's id. */
  const snapshot = project
    .use(
      Effect.gen(function* () {
        const paths = yield* RepoPaths;
        const files = yield* (yield* WorkingTree).files;
        return yield* store.record(yield* namespace, paths.root, files);
      })
    )
    .pipe(
      Effect.mapError((error) =>
        error._tag === "SnapshotStoreFailed"
          ? new BadRequest({
              message: `The setup keeps each step as a snapshot, and it could not take one: ${error.message}`,
            })
          : error
      )
    );

  /** Lets go of the snapshots nothing keeps; steps and batches often share one. */
  const release = Effect.fnUntraced(function* (
    setup: DesignSystemSetup,
    trees: Iterable<string>
  ) {
    const kept = new Set(setup.steps.flatMap(treesOf));
    const dropped = [...new Set(trees)].filter((tree) => !kept.has(tree));
    if (dropped.length === 0) {
      return;
    }
    yield* store.release(yield* namespace, dropped);
    yield* store.collect;
  });

  /**
   * What putting the files back to `base` touches: the files the ranges changed, as they are
   * now.
   */
  const restorePlan = Effect.fnUntraced(function* (
    base: string,
    ranges: readonly { readonly after?: string; readonly before?: string }[]
  ) {
    const now = yield* snapshot;
    const touched = new Set<string>();
    for (const range of ranges) {
      if (range.before !== undefined) {
        const changes = yield* store
          .changedBetween(range.before, range.after ?? now)
          .pipe(Effect.mapError(unreadable));
        for (const change of changes) {
          touched.add(change.path);
        }
      }
    }
    const changes = yield* store
      .changedBetween(base, now)
      .pipe(Effect.mapError(unreadable));
    const entries = changes
      .filter((c) => touched.has(c.path))
      .map(
        (c): RestoreEntry => ({
          action: c.status === "A" ? "delete" : "restore",
          path: c.path,
        })
      );
    return { entries, now };
  });

  /** Puts the files back as `base` has them, and removes the ones it does not. */
  const restore = (base: string, entries: readonly RestoreEntry[]) =>
    project.use(
      Effect.gen(function* () {
        const paths = yield* RepoPaths;
        // Only files of the project: a path that leads out is refused before anything moves.
        yield* Effect.forEach(entries, (e) => paths.resolve(e.path), {
          discard: true,
        });
        yield* store
          .restore(base, paths.root, entries)
          .pipe(
            Effect.mapError((error) =>
              error._tag === "SnapshotMissing"
                ? unreadable(error)
                : new BadRequest({ message: error.message })
            )
          );
      })
    );

  return { release, restore, restorePlan, snapshot };
});
