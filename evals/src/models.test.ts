import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Models } from "./models.ts";
import { scriptedProcesses } from "./test-processes.ts";

const Answer = Schema.Struct({ brief: Schema.String });
const question = {
  cwd: "/tmp",
  decode: Answer,
  images: ["home/slice-1.jpg"],
  prompt: "Write the brief.",
  schema: {
    additionalProperties: false,
    properties: { brief: { type: "string" } },
    required: ["brief"],
    type: "object",
  },
};

/** The models, over commands that print what `print` says. */
const modelsOver = (print: Parameters<typeof scriptedProcesses>[0]) => {
  const processes = scriptedProcesses(print);
  return {
    layer: Models.layer.pipe(
      Layer.provide(Layer.merge(NodeServices.layer, processes.layer))
    ),
    ran: processes.ran,
  };
};

describe("the models", () => {
  it.effect(
    "asks Claude by default, with the schema, and decodes its answer",
    () => {
      const { layer, ran } = modelsOver(() =>
        JSON.stringify({
          is_error: false,
          result: "",
          structured_output: { brief: "A screen of customers." },
          total_cost_usd: 0.25,
        })
      );
      return Effect.gen(function* () {
        const models = yield* Models;
        const answer = yield* models.ask({ ...question, model: "opus" });
        assert.deepStrictEqual(answer, {
          costUsd: 0.25,
          tokens: 0,
          value: { brief: "A screen of customers." },
        });
        assert.strictEqual(ran[0]?.command, "claude");
        // The prompt goes on stdin, not as an argument.
        assert.deepStrictEqual(ran[0]?.args.slice(0, 5), [
          "-p",
          "--output-format",
          "json",
          "--model",
          "opus",
        ]);
        assert.include(ran[0]?.args ?? [], JSON.stringify(question.schema));
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect(
    "asks a gpt- model in Codex with its pictures attached, and counts its tokens",
    () => {
      const { layer, ran } = modelsOver(() =>
        [
          "Reading the prompt",
          JSON.stringify({ type: "thread.started" }),
          JSON.stringify({
            item: { text: '{"brief":"first thought"}', type: "agent_message" },
            type: "item.completed",
          }),
          "{ not an event",
          JSON.stringify({
            item: { text: '{"brief":"A screen."}', type: "agent_message" },
            type: "item.completed",
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: {
              cached_input_tokens: 7,
              input_tokens: 1200,
              output_tokens: 300,
            },
          }),
        ].join("\n")
      );
      return Effect.gen(function* () {
        const models = yield* Models;
        const answer = yield* models.ask({
          ...question,
          effort: "medium",
          model: "gpt-6.1-sol",
        });
        assert.deepStrictEqual(answer, {
          costUsd: 0,
          tokens: 1500,
          value: { brief: "A screen." },
        });
        assert.strictEqual(ran[0]?.command, "codex");
        const args = ran[0]?.args ?? [];
        assert.include(args, 'model_reasoning_effort="medium"');
        assert.strictEqual(args[args.indexOf("-i") + 1], "home/slice-1.jpg");
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect(
    "runs a model in the agent the editor's review runs it in, by its name",
    () => {
      const { layer, ran } = modelsOver(() =>
        JSON.stringify({
          item: { text: '{"brief":"A screen."}', type: "agent_message" },
          type: "item.completed",
        })
      );
      return Effect.gen(function* () {
        const models = yield* Models;
        assert.deepStrictEqual(
          [
            "opus",
            "gpt-6.1-sol",
            "o3",
            "codex:o3",
            "cursor:grok-4.7-high",
            "cursor-opus-5.5",
            // No agent's name before the colon: Claude's own name for a model.
            "arn:aws:bedrock:opus",
          ].map(models.runsIn),
          ["claude", "codex", "codex", "codex", "cursor", "cursor", "claude"]
        );
        yield* models.ask({ ...question, model: "o3" });
        yield* models.ask({ ...question, model: "codex:o3" });
        assert.deepStrictEqual(
          ran.map((r) => [r.command, r.args[r.args.indexOf("--model") + 1]]),
          [
            ["codex", "o3"],
            ["codex", "o3"],
          ]
        );
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect(
    "asks a cursor- model in Cursor under its name there, and once more when its answer does not fit",
    () => {
      const { layer, ran } = modelsOver((_, index) =>
        JSON.stringify({
          is_error: false,
          // The first answer says more than it was asked; the second fits, in prose.
          result:
            index === 0
              ? '{"brief":"A screen.","note":"extra"}'
              : 'Here it is: {"brief":"A screen."}',
          usage: { inputTokens: 10, outputTokens: 5 },
        })
      );
      return Effect.gen(function* () {
        const models = yield* Models;
        const answer = yield* models.ask({
          ...question,
          effort: "high",
          model: "cursor-opus-5.5",
        });
        assert.deepStrictEqual(answer.value, { brief: "A screen." });
        assert.strictEqual(answer.tokens, 15);
        assert.deepStrictEqual(
          ran.map((r) => r.command),
          ["cursor-agent", "cursor-agent"]
        );
        const args = ran[0]?.args ?? [];
        assert.strictEqual(
          args[args.indexOf("--model") + 1],
          "claude-opus-5-5-high"
        );
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect(
    "fails with what was wrong when an answer does not fit its schema",
    () => {
      const { layer } = modelsOver(() =>
        JSON.stringify({
          is_error: false,
          structured_output: { summary: "not a brief" },
        })
      );
      return Effect.gen(function* () {
        const models = yield* Models;
        const error = yield* models
          .ask({ ...question, model: "opus" })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "EvalsError");
        assert.include(error.message, "opus's answer does not fit");
      }).pipe(Effect.provide(layer));
    }
  );
});
