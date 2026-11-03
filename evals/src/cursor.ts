/**
 * Cursor's agent in print mode, for the steps run on the user's Cursor plan: read-only, reading
 * the pictures itself. It takes no schema, so the schema goes in the prompt, and an answer that
 * does not fit it is asked for again (`Models`).
 */
import { Effect, Option, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { EvalsError } from "./errors.ts";
import type { Asked, Reply } from "./models.ts";

const TIMEOUT = "25 minutes";

/** What `cursor-agent --output-format json` prints when it is done. */
const PrintResult = Schema.Struct({
  is_error: Schema.optional(Schema.Boolean),
  result: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      cacheReadTokens: Schema.optional(Schema.Number),
      cacheWriteTokens: Schema.optional(Schema.Number),
      inputTokens: Schema.optional(Schema.Number),
      outputTokens: Schema.optional(Schema.Number),
    })
  ),
});

const decodeJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown)
);
const decodePrintResult = Schema.decodeUnknownOption(PrintResult);

/** The JSON object in a text, from its first `{` to its last `}`: the agent may wrap it in prose. */
export const jsonObjectIn = (text: string) =>
  decodeJson(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

export const askCursor = Effect.fn("askCursor")(function* (asked: Asked) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const prompt = `${asked.prompt}

Read the picture files with your file-reading tool. Change nothing. Answer with only one JSON object, no prose and no code fence, that fits this JSON Schema exactly:

${JSON.stringify(asked.schema)}`;
  const output = yield* spawner
    .string(
      ChildProcess.make(
        "cursor-agent",
        [
          "-p",
          prompt,
          "--model",
          asked.model,
          "--mode",
          "ask",
          "--trust",
          "--output-format",
          "json",
        ],
        { cwd: asked.cwd, stdin: "ignore" }
      )
    )
    .pipe(
      Effect.timeout(TIMEOUT),
      Effect.mapError(
        (cause) =>
          new EvalsError({ message: `cursor-agent failed: ${String(cause)}` })
      )
    );
  const result = Option.getOrUndefined(
    Option.flatMap(jsonObjectIn(output), decodePrintResult)
  );
  if (!result?.result || result.is_error) {
    return yield* new EvalsError({
      message: `cursor-agent gave no answer: ${output.slice(-500)}`,
    });
  }
  const structured = jsonObjectIn(result.result);
  if (Option.isNone(structured)) {
    return yield* new EvalsError({
      message: "cursor-agent's answer: answer is not JSON",
    });
  }
  const { usage } = result;
  return {
    costUsd: 0,
    structured: structured.value,
    text: result.result,
    tokens:
      (usage?.inputTokens ?? 0) +
      (usage?.cacheReadTokens ?? 0) +
      (usage?.cacheWriteTokens ?? 0) +
      (usage?.outputTokens ?? 0),
  } satisfies Reply;
});
