/**
 * `brief`: what the agent is told about a reference, its content without its design. Written
 * once by a model from the capture, then read and corrected by a person, and kept: every round
 * gives the agent the same brief, so rounds can be compared.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { listDir, prompt } from "./layout.ts";
import { Models } from "./models.ts";
import {
  describeViewports,
  type LoadedReference,
  viewportsOf,
} from "./reference.ts";

const Brief = Schema.Struct({ brief: Schema.String });
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
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const file = data.briefFile(reference.id);
  if ((yield* fs.exists(file)) && !options.force) {
    yield* Effect.log(
      `${reference.id}: has a brief (--force to write it again)`
    );
    return;
  }
  const files = (yield* listDir(data.captureDir(reference.id))).map((name) =>
    path.join("capture", name)
  );
  if (files.length === 0) {
    yield* Effect.logWarning(`${reference.id}: capture it first`);
    return;
  }
  const answer = yield* models.ask({
    cwd: data.referenceDir(reference.id),
    decode: Brief,
    model: options.model,
    prompt: yield* prompt("brief", {
      files: files.map((f) => `- ${f}`).join("\n"),
      kind: reference.kind,
      name: reference.name,
      viewports: describeViewports(viewportsOf(reference)),
    }),
    schema: BriefSchema,
  });
  const { brief } = answer.value;
  yield* fs.writeFileString(file, `${brief.trim()}\n`);
  yield* Effect.log(
    `${reference.id}: brief written ($${answer.costUsd.toFixed(2)}); read it before a round`
  );
});
