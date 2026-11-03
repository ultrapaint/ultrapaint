/**
 * Cursor's agent in print mode, for the steps run on the user's Cursor plan: read-only, reading
 * the pictures itself. It takes no schema, so the schema goes in the prompt and the answer is
 * checked against it, with one more try when it does not fit.
 */
import { Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { EvalsError } from "./errors.ts";

const TIMEOUT = "25 minutes";

interface JsonSchema {
  readonly additionalProperties?: boolean;
  readonly enum?: readonly string[];
  readonly items?: JsonSchema;
  readonly properties?: Record<string, JsonSchema>;
  readonly required?: readonly string[];
  readonly type?: string;
}

/** The first thing wrong with an array or its items, or undefined when it fits. */
const arrayMisfit = (
  value: unknown,
  schema: JsonSchema,
  at: string
): string | undefined => {
  if (!Array.isArray(value)) {
    return `${at} is not an array`;
  }
  for (const [i, item] of value.entries()) {
    const wrong = schema.items && misfit(item, schema.items, `${at}[${i}]`);
    if (wrong) {
      return wrong;
    }
  }
};

/** The first thing wrong with an object or its properties, or undefined when it fits. */
const objectMisfit = (
  value: unknown,
  schema: JsonSchema,
  at: string
): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `${at} is not an object`;
  }
  const object = value as Record<string, unknown>;
  const missing = (schema.required ?? []).find((key) => !(key in object));
  if (missing) {
    return `${at}.${missing} is missing`;
  }
  for (const [key, v] of Object.entries(object)) {
    const property = schema.properties?.[key];
    const wrong = property
      ? misfit(v, property, `${at}.${key}`)
      : `${at}.${key} is not asked for`;
    if (wrong) {
      return wrong;
    }
  }
};

/** The first thing wrong with a value, or undefined when it fits. */
const misfit = (
  value: unknown,
  schema: JsonSchema,
  at: string
): string | undefined => {
  if (schema.enum && !schema.enum.includes(value as string)) {
    return `${at} is not one of ${schema.enum.join(", ")}`;
  }
  if (schema.type === "array") {
    return arrayMisfit(value, schema, at);
  }
  if (schema.type === "object") {
    return objectMisfit(value, schema, at);
  }
  return schema.type && typeof value !== schema.type
    ? `${at} is not a ${schema.type}`
    : undefined;
};

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return undefined;
  }
};

export const askCursor = Effect.fn("askCursor")(function* (options: {
  readonly cwd: string;
  /** Cursor's name of the model, with its effort. */
  readonly model: string;
  readonly prompt: string;
  readonly schema: object;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const prompt = `${options.prompt}

Read the picture files with your file-reading tool. Change nothing. Answer with only one JSON object, no prose and no code fence, that fits this JSON Schema exactly:

${JSON.stringify(options.schema)}`;
  const once = Effect.gen(function* () {
    const output = yield* spawner
      .string(
        ChildProcess.make(
          "cursor-agent",
          [
            "-p",
            prompt,
            "--model",
            options.model,
            "--mode",
            "ask",
            "--trust",
            "--output-format",
            "json",
          ],
          { cwd: options.cwd, stdin: "ignore" }
        )
      )
      .pipe(
        Effect.timeout(TIMEOUT),
        Effect.mapError(
          (cause) =>
            new EvalsError({ message: `cursor-agent failed: ${String(cause)}` })
        )
      );
    const result = parse(output) as
      | {
          readonly is_error?: boolean;
          readonly result?: string;
          readonly usage?: Record<string, number>;
        }
      | undefined;
    if (!result?.result || result.is_error) {
      return yield* new EvalsError({
        message: `cursor-agent gave no answer: ${output.slice(-500)}`,
      });
    }
    const structured = parse(result.result);
    const wrong = misfit(structured, options.schema as JsonSchema, "answer");
    if (wrong) {
      return yield* new EvalsError({
        message: `cursor-agent's answer: ${wrong}`,
      });
    }
    return {
      structured,
      usage: {
        input_tokens:
          (result.usage?.inputTokens ?? 0) +
          (result.usage?.cacheReadTokens ?? 0) +
          (result.usage?.cacheWriteTokens ?? 0),
        output_tokens: result.usage?.outputTokens ?? 0,
      } as Record<string, number>,
    };
  });
  return yield* once.pipe(Effect.retry({ times: 1 }));
});
