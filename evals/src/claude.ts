/**
 * Claude Code in print mode: the user's own `claude` with its own sign-in, allowed to read files
 * and nothing else, answering in JSON when given a schema. What it should read goes in files under
 * `cwd` and is named in the prompt: pictures reach it through its Read tool, and a prompt stays
 * short enough for a command line.
 */
import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { EvalsError } from "./errors.ts";
import type { Asked, Reply } from "./models.ts";

const PrintResult = Schema.Struct({
  is_error: Schema.Boolean,
  result: Schema.optional(Schema.String),
  structured_output: Schema.optional(Schema.Unknown),
  total_cost_usd: Schema.optional(Schema.Number),
});
const decodeResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PrintResult)
);

/** A judgement over a dozen pictures takes minutes; past this one something is stuck. */
const TIMEOUT = "25 minutes";

export const askClaude = Effect.fn("askClaude")(function* (asked: Asked) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const args = [
    "-p",
    asked.prompt,
    "--output-format",
    "json",
    "--model",
    asked.model,
    ...(asked.effort ? ["--effort", asked.effort] : []),
    "--tools",
    "Read,Glob",
    "--allowedTools",
    "Read,Glob",
    ...(asked.dirs ?? []).flatMap((dir) => ["--add-dir", dir]),
    ...(asked.schema ? ["--json-schema", JSON.stringify(asked.schema)] : []),
  ];
  const output = yield* spawner
    .string(
      ChildProcess.make("claude", args, { cwd: asked.cwd, stdin: "ignore" })
    )
    .pipe(
      Effect.timeout(TIMEOUT),
      Effect.mapError(
        (cause) =>
          new EvalsError({ message: `claude -p failed: ${String(cause)}` })
      )
    );
  const result = yield* decodeResult(output.trim()).pipe(
    Effect.mapError(
      () =>
        new EvalsError({
          message: `claude -p answered something else than its JSON: ${output.slice(0, 500)}`,
        })
    )
  );
  if (result.is_error) {
    return yield* new EvalsError({
      message: `claude -p reported an error: ${result.result ?? "no message"}`,
    });
  }
  if (asked.schema && result.structured_output === undefined) {
    return yield* new EvalsError({
      message: `claude -p gave no structured answer: ${(result.result ?? "").slice(0, 500)}`,
    });
  }
  return {
    costUsd: result.total_cost_usd ?? 0,
    structured: result.structured_output,
    text: result.result ?? "",
    // Its print result says what it cost, which is what a step reports for it.
    tokens: 0,
  } satisfies Reply;
});
