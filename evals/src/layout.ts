/**
 * Where the design evals keep things. The code and its prompts are here, in Ultrapaint's
 * repository (`evals/`); what they read and write is in the data directory, kept out of git:
 * `ULTRAPAINT_EVALS_DATA`, else `~/Code/ultrapaint-data`. Ultrapaint itself is run as its command
 * and reached through its wire contracts, never imported otherwise.
 */
import os from "node:os";
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { LabError } from "./errors.ts";

/** The evals' own directory in the repository: the code and the prompts. */
const EVALS = path.resolve(import.meta.dirname, "..");
/**
 * The Ultrapaint checkout whose command, skills and tools a round measures: the one the evals are
 * in, or `ULTRAPAINT_CHECKOUT` to measure another commit (a worktree of it).
 */
export const CHECKOUT = path.resolve(
  process.env.ULTRAPAINT_CHECKOUT ?? path.join(EVALS, "..")
);
/** The references, the hosts, the rounds and the studies: everything the evals read and write. */
export const DATA = path.resolve(
  process.env.ULTRAPAINT_EVALS_DATA ??
    path.join(os.homedir(), "Code", "ultrapaint-data")
);
/** The projects the agents design in, one directory each, made with `ultrapaint new`. */
export const HOSTS = path.join(DATA, "hosts");
/** One directory per reference: `reference.json`, its capture and its brief. */
export const REFERENCES = path.join(DATA, "references");
/** One directory per round: what was generated, how it was judged, the report. */
export const RUNS = path.join(DATA, "runs");
/** Skill files to try in a round instead of, or on top of, the shipped ones. */
export const CANDIDATES = path.join(DATA, "candidates");
export const PROMPTS = path.join(EVALS, "prompts");
/** Scratch: the servers' configurations, designs directories and logs. */
export const WORK = path.join(DATA, ".work");

export const hostDir = (host: string) => path.join(HOSTS, host);
export const referenceDir = (id: string) => path.join(REFERENCES, id);
export const captureDir = (id: string) => path.join(REFERENCES, id, "capture");
export const briefFile = (id: string) => path.join(REFERENCES, id, "brief.md");
export const runDir = (round: string, ref: string, run: number) =>
  path.join(RUNS, round, ref, `run-${run}`);

/** A path as the reports show it: from the data directory. */
export const fromData = (file: string) => path.relative(DATA, file);

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
        new LabError({ message: `cannot read ${fromData(file)}: ${cause}` })
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
