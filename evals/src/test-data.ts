/**
 * A data directory of a test's own, for the tests: a temporary directory that goes with the
 * test's scope, as `EvalsConfig`'s `data`, and the files a test writes into it.
 */
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import { dataDirAt, EvalsConfig } from "./config.ts";
import { writeJson, writeText } from "./layout.ts";

/** A fresh, empty data directory for each test it is provided to, and Node's services. */
export const TestData = Layer.effect(
  EvalsConfig,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "evals-data-" });
    return EvalsConfig.of({
      browser: undefined,
      checkout: path.resolve(import.meta.dirname, "..", ".."),
      data: dataDirAt(root),
      editorLog: false,
      findings: path.join(root, "findings"),
      gaps: path.join(root, "evals-gaps"),
      skillsBriefing: undefined,
    });
  })
).pipe(Layer.provideMerge(NodeServices.layer));

/** Files written under the data directory, by their path from it: JSON for a value, else text. */
export const writeData = Effect.fn("writeData")(function* (
  files: Readonly<Record<string, unknown>>
) {
  const { data } = yield* EvalsConfig;
  for (const [file, content] of Object.entries(files)) {
    const at = path.join(data.root, file);
    yield* typeof content === "string"
      ? writeText(at, content)
      : writeJson(at, content);
  }
});

/** A file of the data directory, by its path from it. */
export const readData = Effect.fn("readData")(function* (file: string) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(path.join(data.root, file));
});

/** A judge's answer with the given scores and nothing else to say. */
export const judgement = (
  scores: Readonly<Record<string, number>>,
  more: Readonly<Record<string, unknown>> = {}
) => ({
  fidelity: { added: [], missing: [] },
  findings: [],
  scores: Object.entries(scores).map(([area, score]) => ({
    area,
    note: "",
    score,
  })),
  strengths: [],
  summary: "",
  ...more,
});
