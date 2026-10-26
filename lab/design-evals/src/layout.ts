/**
 * Where the design evals keep things. Everything is under `lab/design-evals`; nothing the tool
 * ships reads from here, and nothing here is imported by the tool except its wire contracts.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { LabError } from "./errors.ts";

export const LAB = path.resolve(import.meta.dirname, "..");
export const REPO = path.resolve(LAB, "../..");
/** One directory per reference: `reference.json`, its capture and its brief. */
export const REFERENCES = path.join(LAB, "references");
/** One directory per round: what was generated, how it was judged, the report. */
export const RUNS = path.join(LAB, "runs");
/** Skill files to try in a round instead of, or on top of, the shipped ones. */
export const CANDIDATES = path.join(LAB, "candidates");
export const PROMPTS = path.join(LAB, "prompts");
/** Scratch: the servers' configurations, designs directories and logs. Ignored by git. */
export const WORK = path.join(LAB, ".work");

export const referenceDir = (id: string) => path.join(REFERENCES, id);
export const captureDir = (id: string) => path.join(REFERENCES, id, "capture");
export const briefFile = (id: string) => path.join(REFERENCES, id, "brief.md");
export const runDir = (round: string, ref: string, run: number) =>
  path.join(RUNS, round, ref, `run-${run}`);

/** A path as the reports show it: from the lab directory. */
export const fromLab = (file: string) => path.relative(LAB, file);

/** A template from `prompts/`, with `{{name}}` filled in. */
export const prompt = Effect.fn("prompt")(function* (
  name: string,
  values: Readonly<Record<string, string>>
) {
  const fs = yield* FileSystem.FileSystem;
  const template = yield* fs.readFileString(path.join(PROMPTS, `${name}.md`));
  return template.replaceAll(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : value;
  });
});

/** A JSON file decoded with a schema, failing with the file's name. */
export const readJson = <S extends Schema.Top>(schema: S, file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(file);
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
      text
    );
  }).pipe(
    Effect.mapError(
      (cause) =>
        new LabError({ message: `cannot read ${fromLab(file)}: ${cause}` })
    )
  );

export const writeJson = (file: string, value: unknown) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, `${JSON.stringify(value, null, 2)}\n`);
  });

export const writeText = (file: string, text: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, text);
  });

/** The files of a directory, sorted; none when it is not there. */
export const listDir = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(dir))) {
      return [] as string[];
    }
    return (yield* fs.readDirectory(dir)).sort();
  });
