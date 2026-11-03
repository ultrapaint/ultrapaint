/**
 * Claude Code in print mode, for the steps that read pictures and write judgements: the brief,
 * the judge, the report. It runs as the user's own `claude` with its own sign-in, allowed to read
 * files and nothing else, and answers in JSON when given a schema.
 *
 * What it should read goes in files under `cwd` and is named in the prompt: pictures reach it
 * through its Read tool, and a prompt stays short enough for a command line.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { LabError } from "./errors.ts";

export interface AskOptions {
  readonly cwd: string;
  /** Other directories it may read, besides `cwd`. */
  readonly dirs?: readonly string[];
  /** How hard it thinks (`high`, `max`); the command's default without one. */
  readonly effort?: string;
  /** An alias (`opus`, `sonnet`) or a full model name. */
  readonly model: string;
  readonly prompt: string;
  /** JSON Schema of the answer; without one the answer is text. */
  readonly schema?: object;
}

export interface Answer {
  readonly costUsd: number;
  /** The answer decoded from the schema's JSON, when there was a schema. */
  readonly structured: unknown;
  readonly text: string;
}

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

export class Claude extends Context.Service<
  Claude,
  { readonly ask: (options: AskOptions) => Effect.Effect<Answer, LabError> }
>()("ultrapaint/lab/Claude") {
  static readonly layer = Layer.effect(
    Claude,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const ask = Effect.fn("Claude.ask")(function* (options: AskOptions) {
        const args = [
          "-p",
          options.prompt,
          "--output-format",
          "json",
          "--model",
          options.model,
          ...(options.effort ? ["--effort", options.effort] : []),
          "--tools",
          "Read,Glob",
          "--allowedTools",
          "Read,Glob",
          ...(options.dirs ?? []).flatMap((dir) => ["--add-dir", dir]),
          ...(options.schema
            ? ["--json-schema", JSON.stringify(options.schema)]
            : []),
        ];
        const output = yield* spawner
          .string(
            ChildProcess.make("claude", args, {
              cwd: options.cwd,
              stdin: "ignore",
            })
          )
          .pipe(
            Effect.timeout(TIMEOUT),
            Effect.mapError(
              (cause) =>
                new LabError({ message: `claude -p failed: ${String(cause)}` })
            )
          );
        const result = yield* decodeResult(output.trim()).pipe(
          Effect.mapError(
            () =>
              new LabError({
                message: `claude -p answered something else than its JSON: ${output.slice(0, 500)}`,
              })
          )
        );
        if (result.is_error) {
          return yield* new LabError({
            message: `claude -p reported an error: ${result.result ?? "no message"}`,
          });
        }
        if (options.schema && result.structured_output === undefined) {
          return yield* new LabError({
            message: `claude -p gave no structured answer: ${(result.result ?? "").slice(0, 500)}`,
          });
        }
        return {
          costUsd: result.total_cost_usd ?? 0,
          structured: result.structured_output,
          text: result.result ?? "",
        } satisfies Answer;
      });

      return Claude.of({ ask });
    })
  );
}
