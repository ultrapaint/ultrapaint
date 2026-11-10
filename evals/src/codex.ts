/**
 * Codex in exec mode: the user's own `codex` with its own sign-in, read-only, with the pictures
 * attached, answering in JSON to the schema it is given.
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Effect, FileSystem, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { EvalsError } from "./errors.ts";
import type { Asked, Reply } from "./models.ts";

const TIMEOUT = "25 minutes";

/** A line of `codex exec --json`: what it is doing, and at the end what it said and used. */
const Event = Schema.Struct({
  item: Schema.optional(
    Schema.Struct({
      text: Schema.optional(Schema.String),
      type: Schema.optional(Schema.String),
    })
  ),
  type: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.optional(Schema.Number),
      output_tokens: Schema.optional(Schema.Number),
    })
  ),
});
const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(Event));
const decodeJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown)
);

/** The events of a run, in order; a line that is not one is its log, and left out. */
export const codexEvents = (output: string) =>
  output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .flatMap((line) => Option.toArray(decodeEvent(line)));

export const askCodex = Effect.fn("askCodex")(function* (asked: Asked) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const schemaFile = path.join(
    os.tmpdir(),
    `codex-schema-${randomUUID()}.json`
  );
  yield* fs
    .writeFileString(schemaFile, JSON.stringify(asked.schema))
    .pipe(
      Effect.mapError(
        (cause) =>
          new EvalsError({ message: `codex's schema file: ${String(cause)}` })
      )
    );
  const output = yield* spawner
    .string(
      ChildProcess.make(
        "codex",
        [
          // `-`: the prompt is read from stdin, which takes one longer than an argument can be.
          "exec",
          "-",
          "--json",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--model",
          asked.model,
          ...(asked.effort
            ? ["-c", `model_reasoning_effort="${asked.effort}"`]
            : []),
          "--output-schema",
          schemaFile,
          ...(asked.images ?? []).flatMap((image) => ["-i", image]),
        ],
        {
          cwd: asked.cwd,
          stdin: Stream.make(new TextEncoder().encode(asked.prompt)),
        }
      )
    )
    .pipe(
      Effect.timeout(TIMEOUT),
      Effect.mapError(
        (cause) =>
          new EvalsError({ message: `codex exec failed: ${String(cause)}` })
      ),
      Effect.ensuring(Effect.ignore(fs.remove(schemaFile)))
    );
  const events = codexEvents(output);
  const text = events.findLast((e) => e.item?.type === "agent_message")?.item
    ?.text;
  if (text === undefined) {
    return yield* new EvalsError({
      message: `codex exec gave no answer: ${output.slice(-500)}`,
    });
  }
  const structured = yield* decodeJson(text).pipe(
    Effect.mapError(
      () =>
        new EvalsError({
          message: `codex answered something else than JSON: ${text.slice(0, 500)}`,
        })
    )
  );
  const usage = events.findLast((e) => e.type === "turn.completed")?.usage;
  return {
    costUsd: 0,
    structured,
    text,
    tokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
  } satisfies Reply;
});
