import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "agent discovery",
  (it) => {
    it.effect(
      "lists an agent's models before any thread has prompted it, and gives them to a waiting thread",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const waiting = yield* client["threads.create"]({ agentId: "fake" });
          assert.isUndefined(waiting.configOptions);

          const options = yield* client["agents.discover"]({ agentId: "fake" });
          assert.deepStrictEqual(
            options.configOptions.map((o) => [o.id, o.currentValue]),
            [["model", "fast"]]
          );
          assert.deepStrictEqual(
            options.modes?.map((m) => m.id),
            ["ask", "auto"]
          );
          assert.deepStrictEqual(
            (yield* client["agents.options"]()).map((a) => a.agentId),
            ["fake"]
          );

          const thread = (yield* client["threads.list"]()).find(
            (t) => t.id === waiting.id
          );
          assert.isUndefined(thread?.sessionId);
          assert.deepStrictEqual(
            thread?.configOptions?.[0]?.options.map((o) => o.value),
            ["fast", "smart"]
          );
          // Discovery leaves nothing in the thread: its session is still the first prompt's.
          assert.lengthOf(
            yield* client["threads.items"]({ threadId: waiting.id }),
            0
          );
        })
    );

    it.effect(
      "does not sign in on the user's behalf, and says why the models are missing",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const error = yield* Effect.flip(
            client["agents.discover"]({ agentId: "fake-auth" })
          );
          assert.strictEqual(error._tag, "AgentFailure");
          assert.include(error.message, "did not list its models");
          assert.isUndefined(
            (yield* client["agents.options"]()).find(
              (a) => a.agentId === "fake-auth"
            )
          );
        })
    );

    it.effect("fails for an agent that is not configured", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const error = yield* Effect.flip(
          client["agents.discover"]({ agentId: "nobody" })
        );
        assert.strictEqual(error._tag, "AgentFailure");
      })
    );
  }
);
