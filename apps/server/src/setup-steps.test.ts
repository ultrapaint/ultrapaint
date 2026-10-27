/**
 * The setup's steps with their threads (`setup-steps.ts`), on the in-process threads of
 * `testing/threads.ts` and a setup that only keeps where each step is.
 */
import { assert, describe, it } from "@effect/vitest";
import {
  type DesignSystemSetup,
  emptySetup,
  type SetupStep,
} from "@ultrapaint/contracts/design-system-setup";
import { BadRequest } from "@ultrapaint/contracts/errors";
import { Effect, Layer, Ref } from "effect";
import { DesignSystemSetupService } from "./services/design-system-setup.ts";
import { SetupSteps } from "./services/setup-steps.ts";
import { ChatPreferences } from "./services/threads/chat-preferences.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { ThreadService } from "./services/threads/threads.ts";
import { ScriptedAgents } from "./testing/scripted-agents.ts";
import { ThreadTest } from "./testing/threads.ts";

const unused = Effect.die("not used by the step runner");

const withStep = (
  setup: DesignSystemSetup,
  id: SetupStep["id"],
  change: Partial<SetupStep>
): DesignSystemSetup => ({
  ...setup,
  steps: setup.steps.map((s) => (s.id === id ? { ...s, ...change } : s)),
});

/**
 * Where each step is, and nothing else: Define starts, Map refuses as a step whose turn has not
 * come does, stopping a step keeps its thread.
 */
const Setup = Layer.effect(
  DesignSystemSetupService,
  Effect.gen(function* () {
    const state = yield* Ref.make(emptySetup(0));
    return DesignSystemSetupService.of({
      audit: unused,
      batchPreview: () => unused,
      complete: () => unused,
      finish: () => unused,
      finishBatch: () => unused,
      get: Ref.get(state),
      inventory: unused,
      mapping: unused,
      nextBatch: () => unused,
      redo: (step) =>
        Ref.updateAndGet(state, (s) => withStep(s, step, { status: "todo" })),
      redoPreview: () => unused,
      resume: () => unused,
      revertBatch: () => unused,
      setMapping: () => unused,
      start: (step, { threadId }) =>
        step === "map"
          ? Effect.fail(
              new BadRequest({ message: "Map starts once Define is done" })
            )
          : Ref.updateAndGet(state, (s) =>
              withStep(s, step, {
                status: "active",
                ...(threadId && { threadId }),
              })
            ),
      stepOf: () => unused,
      stop: (step) =>
        Ref.updateAndGet(state, (s) =>
          withStep(s, step, { status: "stopped" })
        ),
    });
  })
);

const StepsTest = SetupSteps.layer.pipe(
  Layer.provideMerge(Setup),
  Layer.provideMerge(ThreadTest)
);

const test = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, Layer.Success<typeof StepsTest>>
) => it.effect(name, () => Effect.provide(body(), StepsTest));

describe("the setup's step runner", () => {
  test("starts a step an agent runs with its thread and its first task", () =>
    Effect.gen(function* () {
      const steps = yield* SetupSteps;
      const store = yield* ThreadStore;
      const started = yield* steps.start("define");
      assert.deepStrictEqual(started.task, {
        _tag: "SetupStep",
        step: "define",
      });
      const thread = yield* store.get(started.threadId ?? "");
      assert.strictEqual(thread?.title, "Design system: Define");
      assert.strictEqual(
        started.setup.steps.find((s) => s.id === "define")?.threadId,
        thread?.id
      );
    }));

  test("leaves no empty thread behind a step that could not start", () =>
    Effect.gen(function* () {
      const steps = yield* SetupSteps;
      const store = yield* ThreadStore;
      const refused = yield* Effect.flip(steps.start("map"));
      assert.strictEqual(refused.message, "Map starts once Define is done");
      assert.deepStrictEqual(yield* store.list, []);
    }));

  test("gives a step that runs there and then no thread", () =>
    Effect.gen(function* () {
      const steps = yield* SetupSteps;
      const store = yield* ThreadStore;
      const started = yield* steps.start("inventory");
      assert.isNull(started.threadId);
      assert.isNull(started.task);
      assert.deepStrictEqual(yield* store.list, []);
    }));

  test("stops the turn of a step it stops, and keeps the thread", () =>
    Effect.gen(function* () {
      const steps = yield* SetupSteps;
      const threads = yield* ThreadService;
      const store = yield* ThreadStore;
      const agents = yield* ScriptedAgents;
      yield* (yield* ChatPreferences).setDefaults({ agentId: "scripted" });
      const { threadId } = yield* steps.start("define");
      const id = threadId ?? "";
      yield* threads.prompt({
        attachments: [],
        text: "/design-system define",
        threadId: id,
      });
      const turn = yield* (yield* agents.next).nextTurn;
      const stopped = yield* steps.stop("define");
      assert.strictEqual(
        stopped.steps.find((s) => s.id === "define")?.status,
        "stopped"
      );
      // The agent is asked to stop, and the thread says so until it has.
      assert.strictEqual((yield* store.get(id))?.status, "cancelling");
      yield* turn.cancelled;
    }));
});
