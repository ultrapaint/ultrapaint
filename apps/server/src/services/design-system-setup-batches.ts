/**
 * The batches of Migrate: the one the agent works on, rewritten by the rules when it is taken,
 * the agent saying it is done, and a batch reverted, which puts back what it changed.
 */
import type { MigrationBatch } from "@ultrapaint/contracts/design-system-setup";
import { Effect, type Semaphore } from "effect";
import type { NextBatch } from "./design-system-setup.ts";
import type {
  Codebase,
  makeCodebaseReader,
} from "./design-system-setup-codebase.ts";
import { mappingTable } from "./design-system-setup-rules.ts";
import type { makeSetupSnapshots } from "./design-system-setup-snapshots.ts";
import {
  type makeSetupStore,
  refuse,
  stepIn,
  withStep,
} from "./design-system-setup-store.ts";

export const makeMigrateBatches = (deps: {
  readonly codebase: Effect.Success<typeof makeCodebaseReader>["codebase"];
  readonly lock: Semaphore.Semaphore;
  readonly snapshots: Effect.Success<typeof makeSetupSnapshots>;
  readonly store: Effect.Success<typeof makeSetupStore>;
}) => {
  const { codebase, lock, snapshots, store } = deps;
  const { release, restore, restorePlan, snapshot } = snapshots;
  const { get, mappingFile, save } = store;

  /** Migrate, as the thread asking for a batch runs it. */
  const migrateOf = Effect.fnUntraced(function* (threadId: string) {
    const setup = yield* get;
    const step = stepIn(setup, "migrate");
    if (step.threadId !== threadId) {
      return yield* refuse(
        "This thread does not run Migrate: the batches are its agent's."
      );
    }
    if (step.status !== "active") {
      return yield* refuse(
        step.status === "stopped"
          ? "Migrate is stopped: the user resumes it from the setup."
          : `Migrate is ${step.status}: there is no batch to work on.`
      );
    }
    return { setup, step };
  });

  /** A batch's files as the rules leave them: rewritten when `write`, else only read. */
  const rewriteBatch = Effect.fnUntraced(function* (
    code: Codebase,
    table: ReadonlyMap<string, string | null>,
    batch: MigrationBatch,
    write: boolean
  ) {
    const files: NextBatch["files"][number][] = [];
    for (const file of batch.files) {
      const text = yield* code.read(file);
      if (text === null) {
        continue;
      }
      const out = code.usage.rewrite(file, text, code.ctx, table);
      if (write && out.changes > 0) {
        yield* code.write(file, out.text);
      }
      files.push({
        changes: write ? out.changes : 0,
        file,
        left: out.left,
      });
    }
    return files;
  });

  const nextBatch = Effect.fn("DesignSystemSetupService.nextBatch")(function* (
    threadId: string
  ) {
    const { setup, step } = yield* migrateOf(threadId);
    const batches = step.batches ?? [];
    const current =
      batches.find((b) => b.status === "active") ??
      batches.find((b) => b.status === "todo");
    if (!current) {
      return null;
    }
    const mapping = yield* mappingFile.read;
    if (!mapping) {
      return yield* refuse("There is no mapping: Map makes it first.");
    }
    const code = yield* codebase(true);
    // A batch under way was rewritten when it was taken; what is left is read again.
    const taking = current.status === "todo";
    const before = taking ? yield* snapshot : current.before;
    const files = yield* rewriteBatch(
      code,
      mappingTable(mapping),
      current,
      taking
    );
    const batch: MigrationBatch = taking
      ? {
          ...current,
          changes: files.reduce((sum, f) => sum + f.changes, 0),
          status: "active",
          ...(before !== undefined && { before }),
        }
      : current;
    yield* save(
      withStep(setup, "migrate", (s) => ({
        ...s,
        batches: batches.map((b) => (b.id === batch.id ? batch : b)),
      }))
    );
    return {
      batch,
      files,
      remaining: batches.filter((b) => b.status === "todo" && b.id !== batch.id)
        .length,
    } satisfies NextBatch;
  }, lock.withPermits(1));

  const finishBatch = Effect.fn("DesignSystemSetupService.finishBatch")(
    function* (threadId: string, summary: string) {
      const { setup, step } = yield* migrateOf(threadId);
      const batches = step.batches ?? [];
      const current = batches.find((b) => b.status === "active");
      if (!current) {
        return yield* refuse(
          "No batch is under way: next_batch takes the next one."
        );
      }
      const batch: MigrationBatch = {
        ...current,
        after: yield* snapshot,
        status: "done",
        summary: summary.trim(),
      };
      yield* save(
        withStep(setup, "migrate", (s) => ({
          ...s,
          batches: batches.map((b) => (b.id === batch.id ? batch : b)),
        }))
      );
      return {
        batch,
        remaining: batches.filter((b) => b.status === "todo").length,
      };
    },
    lock.withPermits(1)
  );

  /** A batch of Migrate that has started, and the setup it is in. */
  const batchOf = Effect.fnUntraced(function* (batchId: string) {
    const setup = yield* get;
    const batch = stepIn(setup, "migrate").batches?.find(
      (b) => b.id === batchId
    );
    if (!batch) {
      return yield* refuse(`Migrate has no batch ${batchId}.`);
    }
    if (batch.status === "todo" || batch.before === undefined) {
      return yield* refuse(`${batch.dir} has not been migrated yet.`);
    }
    return { base: batch.before, batch, setup };
  });

  const batchPreview = Effect.fn("DesignSystemSetupService.batchPreview")(
    function* (batchId: string) {
      const { base, batch, setup } = yield* batchOf(batchId);
      const { entries, now } = yield* restorePlan(base, [batch]);
      yield* release(setup, [now]);
      return entries;
    },
    lock.withPermits(1)
  );

  const revertBatch = Effect.fn("DesignSystemSetupService.revertBatch")(
    function* (batchId: string) {
      const { base, batch, setup } = yield* batchOf(batchId);
      const { entries, now } = yield* restorePlan(base, [batch]);
      yield* restore(base, entries);
      const reset: MigrationBatch = {
        dir: batch.dir,
        files: batch.files,
        id: batch.id,
        status: "todo",
      };
      const next = withStep(setup, "migrate", (s) => ({
        ...s,
        batches: (s.batches ?? []).map((b) => (b.id === batch.id ? reset : b)),
      }));
      yield* release(next, [now, base, ...(batch.after ? [batch.after] : [])]);
      return yield* save(next);
    },
    lock.withPermits(1)
  );

  return { batchPreview, finishBatch, nextBatch, revertBatch };
};
