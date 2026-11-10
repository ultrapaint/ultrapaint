/**
 * The design-system setup (ADR 0023): five steps, in order, each ending at a gate. This service
 * keeps where each step is, reads the code (the inventory, and the audits against the saved
 * design system), keeps the mapping and the migration's batches, and takes a snapshot of the
 * working tree when a step or a batch starts and ends, so that redoing a step or reverting a batch
 * can put back what it changed. Threads are the step runner's to open and cancel
 * (`setup-steps.ts`): the tasks a step's thread expands read this service, and the thread
 * service is built on them.
 */
import type {
  DefineMode,
  DesignSystemSetup,
  MappingChange,
  MigrationBatch,
  RestoreEntry,
  SetupStep,
  SetupStepId,
  UsageInventory,
  UsageLeft,
  UsageMapping,
} from "@ultrapaint/contracts/design-system-setup";
import type {
  BadRequest,
  CommandFailed,
  ForbiddenPath,
  NotConfigured,
} from "@ultrapaint/contracts/errors";
import { plural } from "@ultrapaint/shared/text";
import { Clock, Context, Effect, Layer, Semaphore } from "effect";
import { makeMigrateBatches } from "./design-system-setup-batches.ts";
import { makeCodebaseReader } from "./design-system-setup-codebase.ts";
import {
  applyChanges,
  batchesOf,
  indexOf,
  inventorySummary,
  mappingCounts,
  mappingOf,
  mappingTable,
  type StepAction,
  stepAfter,
  targetProblem,
  titleOf,
  verifySummary,
} from "./design-system-setup-rules.ts";
import {
  makeSetupSnapshots,
  treesOf,
} from "./design-system-setup-snapshots.ts";
import {
  makeSetupStore,
  refuse,
  stepIn,
  withStep,
} from "./design-system-setup-store.ts";

export type SetupFailure =
  | NotConfigured
  | BadRequest
  | CommandFailed
  | ForbiddenPath;

/** What `next_batch` hands an agent: the batch, what the rules did, and what is left. */
export interface NextBatch {
  readonly batch: MigrationBatch;
  readonly files: readonly {
    readonly changes: number;
    readonly file: string;
    readonly left: readonly UsageLeft[];
  }[];
  /** Batches still to do after this one. */
  readonly remaining: number;
}

/** An audit lists every value off the system, not the inventory's first sixty a kind. */
const AUDIT_PER_GROUP = 5000;

/** A repo-relative file's directory; `.` for one at the root. */
const dirOf = (file: string) => {
  const cut = file.lastIndexOf("/");
  return cut === -1 ? "." : file.slice(0, cut);
};

export class DesignSystemSetupService extends Context.Service<
  DesignSystemSetupService,
  {
    /** The code read against the saved design system, by Map and Verify. */
    readonly audit: Effect.Effect<UsageInventory | null, NotConfigured>;
    /** What reverting a batch would put back. */
    readonly batchPreview: (
      batchId: string
    ) => Effect.Effect<readonly RestoreEntry[], SetupFailure>;
    /** The user goes on past a step: the working tree is what it leaves. */
    readonly complete: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /** An agent says its step is finished; it waits for the user in review. */
    readonly finish: (
      threadId: string,
      summary: string
    ) => Effect.Effect<SetupStep, SetupFailure>;
    /** The agent of Migrate says its batch is done. */
    readonly finishBatch: (
      threadId: string,
      summary: string
    ) => Effect.Effect<
      { readonly batch: MigrationBatch; readonly remaining: number },
      SetupFailure
    >;
    readonly get: Effect.Effect<DesignSystemSetup, NotConfigured>;
    readonly inventory: Effect.Effect<UsageInventory | null, NotConfigured>;
    /** What each value off the system becomes, once Map has started. */
    readonly mapping: Effect.Effect<UsageMapping | null, NotConfigured>;
    /**
     * The batch the agent of Migrate works on: the one under way, or the next, which the rules
     * rewrite first. Null when none is left.
     */
    readonly nextBatch: (
      threadId: string
    ) => Effect.Effect<NextBatch | null, SetupFailure>;
    /**
     * Puts back every file this step and the later ones changed, as it was when this step began,
     * and takes them back to todo. Their threads are left to the caller to stop first.
     */
    readonly redo: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /** What `redo` would put back. */
    readonly redoPreview: (
      step: SetupStepId
    ) => Effect.Effect<readonly RestoreEntry[], SetupFailure>;
    /** A stopped step, or one in review, under way again in its thread. */
    readonly resume: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /** Puts back what a batch changed and takes it back to todo. */
    readonly revertBatch: (
      batchId: string
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /** Decisions on the mapping, by the agent or the user; what could not be taken says why. */
    readonly setMapping: (
      changes: readonly MappingChange[],
      by: "agent" | "user"
    ) => Effect.Effect<
      {
        readonly applied: number;
        readonly mapping: UsageMapping;
        readonly problems: readonly string[];
      },
      SetupFailure
    >;
    /**
     * Starts a step once the ones before it are done. Inventory and Verify run there and then;
     * a step an agent does is given the thread it runs in.
     */
    readonly start: (
      step: SetupStepId,
      options: { readonly mode?: DefineMode; readonly threadId?: string }
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /** Stops a step, keeping what it did. Its thread is the caller's to cancel. */
    readonly stop: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
  }
>()("ultrapaint/server/DesignSystemSetupService") {
  static readonly layer = Layer.effect(
    DesignSystemSetupService,
    Effect.gen(function* () {
      const store = yield* makeSetupStore;
      const { auditFile, get, inventoryFile, mappingFile, save, saveMapping } =
        store;
      const { codebase, eachSource, readCode } = yield* makeCodebaseReader;
      const snapshots = yield* makeSetupSnapshots;
      const { release, restore, restorePlan, snapshot } = snapshots;
      // One change at a time: every change reads the state, snapshots and writes it back.
      const lock = yield* Semaphore.make(1);
      const { batchPreview, finishBatch, nextBatch, revertBatch } =
        makeMigrateBatches({ codebase, lock, snapshots, store });

      /** What a step leaves when it starts: what it found, or the work it hands its agent. */
      const begin = Effect.fnUntraced(function* (
        id: SetupStepId,
        options: { readonly mode?: DefineMode }
      ): Effect.fn.Return<Partial<SetupStep>, SetupFailure> {
        if (id === "inventory") {
          const found = yield* readCode(yield* codebase(false));
          yield* inventoryFile.write(found);
          return {
            finishedAt: found.at,
            status: "review",
            summary: inventorySummary(found),
          };
        }
        if (id === "define") {
          const found = yield* inventoryFile.read;
          return {
            mode: options.mode ?? found?.recommendation.mode ?? "adopt",
          };
        }
        if (id === "map") {
          const code = yield* codebase(true, AUDIT_PER_GROUP);
          const audit = yield* readCode(code);
          yield* auditFile.write(audit);
          const mapping = mappingOf(
            audit,
            code.usage.suggest(audit.values, code.ctx.designSystem),
            audit.at
          );
          yield* saveMapping(mapping);
          const counts = mappingCounts(mapping);
          return {
            summary: `${plural(mapping.entries.length, "value")} off the system; the rules settled ${counts.byRule}.`,
          };
        }
        if (id === "migrate") {
          const mapping = yield* mappingFile.read;
          if (!mapping) {
            return yield* refuse("There is no mapping: Map makes it first.");
          }
          const code = yield* codebase(true);
          const rewrite = code.usage.rewriter(code.ctx, mappingTable(mapping));
          const touched = yield* eachSource(code, (file, text) => {
            const out = rewrite(file, text);
            const settled =
              out.changes > 0 || out.left.some((l) => l.target !== undefined);
            return settled ? file : null;
          });
          const batches = batchesOf(
            touched.filter((f) => f !== null),
            dirOf
          );
          const files = batches.reduce((sum, b) => sum + b.files.length, 0);
          return batches.length === 0
            ? {
                batches,
                status: "review",
                summary: "Nothing the mapping settles is left in the code.",
              }
            : {
                batches,
                summary: `${plural(batches.length, "batch", "batches")}, ${plural(files, "file")}.`,
              };
        }
        const code = yield* codebase(true, AUDIT_PER_GROUP);
        const audit = yield* readCode(code);
        yield* auditFile.write(audit);
        return {
          finishedAt: audit.at,
          status: "review",
          summary: verifySummary(audit, yield* mappingFile.read),
        };
      });

      const start = Effect.fn("DesignSystemSetupService.start")(function* (
        id: SetupStepId,
        options: { readonly mode?: DefineMode; readonly threadId?: string }
      ) {
        const setup = yield* get;
        const next = stepAfter(setup, id, "start", options);
        if ("problem" in next) {
          return yield* refuse(next.problem);
        }
        const before = yield* snapshot;
        const startedAt = yield* Clock.currentTimeMillis;
        const begun = yield* begin(id, options);
        const step: SetupStep = {
          before,
          id,
          startedAt,
          status: "active",
          ...(options.threadId !== undefined && { threadId: options.threadId }),
          ...begun,
        };
        // A step that finished as it started changed nothing: it ends where it began.
        return yield* save(
          withStep(setup, id, () =>
            step.status === "review" ? { ...step, after: before } : step
          )
        );
      }, lock.withPermits(1));

      const finish = Effect.fn("DesignSystemSetupService.finish")(function* (
        threadId: string,
        summary: string
      ) {
        const setup = yield* get;
        const step = setup.steps.find((s) => s.threadId === threadId);
        const moved = step && stepAfter(setup, step.id, "finish");
        if (!(step && moved)) {
          return yield* refuse(
            "This thread does not run a step of the design-system setup."
          );
        }
        if ("problem" in moved) {
          return yield* refuse(moved.problem);
        }
        const after = yield* snapshot;
        const finishedAt = yield* Clock.currentTimeMillis;
        const next = yield* save(
          withStep(setup, step.id, (s) => ({
            ...s,
            after,
            finishedAt,
            status: moved.status,
            summary: summary.trim(),
          }))
        );
        return stepIn(next, step.id);
      }, lock.withPermits(1));

      /** A step moved as `action` takes it, its end snapshot taken or dropped. */
      const move = (name: string, action: StepAction) =>
        Effect.fn(name)(function* (id: SetupStepId) {
          const setup = yield* get;
          const moved = stepAfter(setup, id, action);
          if ("problem" in moved) {
            return yield* refuse(moved.problem);
          }
          const to = moved.status;
          const finishedAt = yield* Clock.currentTimeMillis;
          const after = to === "active" ? undefined : yield* snapshot;
          return yield* save(
            withStep(setup, id, (s) => {
              const { after: _dropped, ...rest } = s;
              return after === undefined
                ? { ...rest, status: to }
                : { ...rest, after, finishedAt, status: to };
            })
          );
        }, lock.withPermits(1));

      const stop = move("DesignSystemSetupService.stop", "stop");
      const resume = move("DesignSystemSetupService.resume", "resume");
      const complete = move("DesignSystemSetupService.complete", "complete");

      /** What redoing a step puts back. */
      const restoreOf = Effect.fnUntraced(function* (
        setup: DesignSystemSetup,
        id: SetupStepId
      ) {
        const step = stepIn(setup, id);
        if (step.status === "todo" || step.before === undefined) {
          return yield* refuse(`${titleOf(id)} has not started.`);
        }
        const plan = yield* restorePlan(
          step.before,
          setup.steps.slice(indexOf(id))
        );
        return { ...plan, base: step.before };
      });

      const redoPreview = Effect.fn("DesignSystemSetupService.redoPreview")(
        function* (id: SetupStepId) {
          const setup = yield* get;
          const { entries, now } = yield* restoreOf(setup, id);
          yield* release(setup, [now]);
          return entries;
        },
        lock.withPermits(1)
      );

      const redo = Effect.fn("DesignSystemSetupService.redo")(function* (
        id: SetupStepId
      ) {
        const setup = yield* get;
        const { base, entries, now } = yield* restoreOf(setup, id);
        yield* restore(base, entries);
        const from = indexOf(id);
        const next: DesignSystemSetup = {
          ...setup,
          steps: setup.steps.map((s, i) =>
            i >= from ? { id: s.id, status: "todo" as const } : s
          ),
        };
        yield* release(next, [
          now,
          ...setup.steps.slice(from).flatMap(treesOf),
        ]);
        if (from <= indexOf("inventory")) {
          yield* inventoryFile.write(null);
        }
        if (from <= indexOf("map")) {
          yield* auditFile.write(null);
          yield* saveMapping(null);
        }
        return yield* save(next);
      }, lock.withPermits(1));

      const setMapping = Effect.fn("DesignSystemSetupService.setMapping")(
        function* (changes: readonly MappingChange[], by: "agent" | "user") {
          const mapping = yield* mappingFile.read;
          if (!mapping) {
            return yield* refuse("There is no mapping: Map makes it first.");
          }
          const code = yield* codebase(true);
          const result = applyChanges(mapping, changes, by, (kind, target) =>
            targetProblem(kind, target, code.ctx.designSystem)
          );
          if (result.applied > 0) {
            yield* saveMapping(result.mapping);
          }
          return result;
        },
        lock.withPermits(1)
      );

      return DesignSystemSetupService.of({
        audit: auditFile.read,
        batchPreview,
        complete,
        finish,
        finishBatch,
        get,
        inventory: inventoryFile.read,
        mapping: mappingFile.read,
        nextBatch,
        redo,
        redoPreview,
        resume,
        revertBatch,
        setMapping,
        start,
        stop,
      });
    })
  );
}
