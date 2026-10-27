/**
 * The design-system setup's steps with their threads (ADR 0023): a step an agent runs starts
 * with a thread of its own and names the task its first prompt sends, and stopping or redoing a
 * step stops the turns of the threads it moves first. It sits above the setup and the threads:
 * the tasks the threads expand read the setup, so the setup cannot open a thread itself.
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
import { ThreadService } from "./threads/threads.ts";

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
     * turns of their threads are stopped: an agent still writing would undo the redo.
     */
    readonly redo: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
  }
>()("ultrapaint/server/SetupSteps") {
  static readonly layer = Layer.effect(
    SetupSteps,
    Effect.gen(function* () {
      const setup = yield* DesignSystemSetupService;
      const threads = yield* ThreadService;

      /** Stops the turns under way of the step, or of the step and every one after it. */
      const stopTurns = Effect.fnUntraced(function* (
        step: SetupStepId,
        only: boolean
      ) {
        const { steps } = yield* setup.get;
        const from = steps.findIndex((s) => s.id === step);
        const affected = only ? [steps[from]] : steps.slice(from);
        for (const s of affected) {
          if (s?.threadId !== undefined && s.status === "active") {
            // A thread that is not working has no turn to cancel.
            yield* Effect.ignore(threads.cancel(s.threadId));
          }
        }
      });

      const start = Effect.fn("SetupSteps.start")(function* (
        step: SetupStepId,
        mode?: DefineMode
      ) {
        const about = setupStepOf(step);
        const thread = about?.agent
          ? yield* threads.create(undefined, `Design system: ${about.title}`)
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

      return SetupSteps.of({
        redo: (step) =>
          Effect.andThen(stopTurns(step, false), setup.redo(step)),
        start,
        stop: (step) => Effect.andThen(stopTurns(step, true), setup.stop(step)),
      });
    })
  );
}
