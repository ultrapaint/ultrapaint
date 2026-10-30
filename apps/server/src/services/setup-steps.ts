/**
 * The design-system setup's steps with their threads (ADR 0023): a step an agent runs starts
 * with a thread of its own and names the task its first prompt sends, and stopping or redoing a
 * step, or reverting Migrate's batch under way, stops the turns of the threads it moves first. It
 * sits above the setup and the threads: the tasks the threads expand read the setup, so the
 * setup cannot open a thread itself.
 */
import {
  type DefineMode,
  type DesignSystemSetup,
  type SetupStepId,
  setupStepOf,
} from "@ultrapaint/contracts/design-system-setup";
import type { TaskRequest } from "@ultrapaint/contracts/tasks";
import { Context, Effect, Layer } from "effect";
import {
  DesignSystemSetupService,
  type SetupFailure,
} from "./design-system-setup.ts";
import type { ThreadFailure } from "./threads/thread-session.ts";
import { ThreadSessions } from "./threads/thread-session.ts";

/** A step started: the setup after it, and for a step an agent runs, its thread and first task. */
export interface StepStarted {
  readonly setup: DesignSystemSetup;
  /** What the thread's first prompt asks for; the editor writes it in the composer to send. */
  readonly task: TaskRequest | null;
  readonly threadId: string | null;
}

export class SetupSteps extends Context.Service<
  SetupSteps,
  {
    /**
     * Starts a step once the ones before it are done. A step an agent runs is given a thread,
     * which a step that could not start does not leave behind.
     */
    readonly start: (
      step: SetupStepId,
      mode?: DefineMode
    ) => Effect.Effect<StepStarted, SetupFailure | ThreadFailure>;
    /** Stops a step, keeping what it did; its thread's turn, if one is under way, is stopped. */
    readonly stop: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /**
     * Puts back what this step and the later ones changed and takes them back to todo, once the
     * turns of their threads are stopped and have ended: an agent still writing would undo the
     * redo.
     */
    readonly redo: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /**
     * Puts back what a batch of Migrate changed and takes it back to todo; the batch under way
     * once Migrate's turn is stopped and has ended, for the same reason.
     */
    readonly revertBatch: (
      batchId: string
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
  }
>()("ultrapaint/server/SetupSteps") {
  static readonly layer = Layer.effect(
    SetupSteps,
    Effect.gen(function* () {
      const setup = yield* DesignSystemSetupService;
      const threads = yield* ThreadSessions;

      /** The threads of the active steps among the step, or the step and every one after it. */
      const threadsOf = Effect.fnUntraced(function* (
        step: SetupStepId,
        only: boolean
      ) {
        const { steps } = yield* setup.get;
        const from = steps.findIndex((s) => s.id === step);
        const affected = only ? [steps[from]] : steps.slice(from);
        return affected.flatMap((s) =>
          s?.threadId !== undefined && s.status === "active" ? [s.threadId] : []
        );
      });

      const stop = Effect.fn("SetupSteps.stop")(function* (step: SetupStepId) {
        for (const threadId of yield* threadsOf(step, true)) {
          // A thread that is not working has no turn to cancel. What the step did is kept, so
          // nothing waits for the turn to end.
          yield* Effect.ignore(
            Effect.flatMap(threads.of(threadId), (s) => s.cancel)
          );
        }
        return yield* setup.stop(step);
      });

      const redo = Effect.fn("SetupSteps.redo")(function* (step: SetupStepId) {
        const stopThread = (threadId: string) =>
          Effect.flatMap(threads.of(threadId), (s) => s.stop);
        yield* Effect.forEach(yield* threadsOf(step, false), stopThread, {
          concurrency: "unbounded",
          discard: true,
        });
        return yield* setup.redo(step);
      });

      const revertBatch = Effect.fn("SetupSteps.revertBatch")(function* (
        batchId: string
      ) {
        const migrate = (yield* setup.get).steps.find(
          (s) => s.id === "migrate"
        );
        const batch = migrate?.batches?.find((b) => b.id === batchId);
        // Only the batch under way is being written; a done one is Migrate's past.
        if (batch?.status === "active" && migrate?.threadId !== undefined) {
          yield* Effect.flatMap(threads.of(migrate.threadId), (s) => s.stop);
        }
        return yield* setup.revertBatch(batchId);
      });

      const start = Effect.fn("SetupSteps.start")(function* (
        step: SetupStepId,
        mode?: DefineMode
      ) {
        const about = setupStepOf(step);
        const thread = about?.agent
          ? yield* threads.create({ title: `Design system: ${about.title}` })
          : null;
        const started = yield* setup
          .start(step, {
            ...(mode && { mode }),
            ...(thread && { threadId: thread.id }),
          })
          .pipe(
            Effect.tapError(() =>
              thread ? threads.delete(thread.id) : Effect.void
            )
          );
        return {
          setup: started,
          task: thread ? { _tag: "SetupStep" as const, step } : null,
          threadId: thread?.id ?? null,
        };
      });

      return SetupSteps.of({ redo, revertBatch, start, stop });
    })
  );
}
