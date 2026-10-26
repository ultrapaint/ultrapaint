/**
 * `brief`: what the agent is told about a reference, its content without its design. Written
 * once by a model from the capture, then read and corrected by a person, and kept: every round
 * gives the agent the same brief, so rounds can be compared.
 */
import path from "node:path";
import { Effect, FileSystem } from "effect";
import { Claude } from "./claude.ts";
import {
  briefFile,
  captureDir,
  listDir,
  prompt,
  referenceDir,
} from "./layout.ts";
import type { LoadedReference } from "./reference.ts";

const BriefSchema = {
  additionalProperties: false,
  properties: { brief: { type: "string" } },
  required: ["brief"],
  type: "object",
};

export const writeBrief = Effect.fn("writeBrief")(function* (
  reference: LoadedReference,
  options: { readonly force: boolean; readonly model: string }
) {
  const fs = yield* FileSystem.FileSystem;
  const claude = yield* Claude;
  const file = briefFile(reference.id);
  if ((yield* fs.exists(file)) && !options.force) {
    yield* Effect.log(
      `${reference.id}: has a brief (--force to write it again)`
    );
    return;
  }
  const files = (yield* listDir(captureDir(reference.id))).map((name) =>
    path.join("capture", name)
  );
  if (files.length === 0) {
    yield* Effect.logWarning(`${reference.id}: capture it first`);
    return;
  }
  const answer = yield* claude.ask({
    cwd: referenceDir(reference.id),
    model: options.model,
    prompt: yield* prompt("brief", {
      files: files.map((f) => `- ${f}`).join("\n"),
      kind: reference.kind,
      name: reference.name,
    }),
    schema: BriefSchema,
  });
  const { brief } = answer.structured as { readonly brief: string };
  yield* fs.writeFileString(file, `${brief.trim()}\n`);
  yield* Effect.log(
    `${reference.id}: brief written ($${answer.costUsd.toFixed(2)}); read it before a round`
  );
});
