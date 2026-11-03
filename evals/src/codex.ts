/**
 * Codex in exec mode, for the steps another model does beside Claude: it runs as the user's own
 * `codex` with its own sign-in, read-only, with the pictures attached, and answers in JSON.
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Effect, FileSystem } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { LabError } from "./errors.ts";

const TIMEOUT = "25 minutes";

export const askCodex = Effect.fn("askCodex")(function* (options: {
  readonly cwd: string;
  readonly effort: string;
  /** Paths from `cwd`, attached in this order. */
  readonly images: readonly string[];
  readonly model: string;
  readonly prompt: string;
  readonly schema: object;
}) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const schemaFile = path.join(
    os.tmpdir(),
    `codex-schema-${randomUUID()}.json`
  );
  yield* fs.writeFileString(schemaFile, JSON.stringify(options.schema));
  const output = yield* spawner
    .string(
      ChildProcess.make(
        "codex",
        [
          "exec",
          options.prompt,
          "--json",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--model",
          options.model,
          "-c",
          `model_reasoning_effort="${options.effort}"`,
          "--output-schema",
          schemaFile,
          ...options.images.flatMap((image) => ["-i", image]),
        ],
        { cwd: options.cwd, stdin: "ignore" }
      )
    )
    .pipe(
      Effect.timeout(TIMEOUT),
      Effect.mapError(
        (cause) =>
          new LabError({ message: `codex exec failed: ${String(cause)}` })
      ),
      Effect.ensuring(Effect.ignore(fs.remove(schemaFile)))
    );
  const events = output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          readonly item?: { readonly text?: string; readonly type?: string };
          readonly type?: string;
          readonly usage?: Record<string, number>;
        }
    );
  const text = events.findLast((e) => e.item?.type === "agent_message")?.item
    ?.text;
  if (text === undefined) {
    return yield* new LabError({
      message: `codex exec gave no answer: ${output.slice(-500)}`,
    });
  }
  const structured = yield* Effect.try({
    catch: () =>
      new LabError({
        message: `codex answered something else than JSON: ${text.slice(0, 500)}`,
      }),
    try: () => JSON.parse(text) as unknown,
  });
  return {
    structured,
    usage: events.findLast((e) => e.type === "turn.completed")?.usage ?? {},
  };
});
