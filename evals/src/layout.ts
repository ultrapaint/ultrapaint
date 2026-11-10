/**
 * The files the design evals read and write: the prompts beside the code, JSON and text in the
 * data directory (`EvalsConfig`'s `data`).
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { type DataDir, EVALS, EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";

export const PROMPTS = path.join(EVALS, "prompts");

/** A data file's address in the viewers (`review`, `gallery`), which serve the data directory. */
export const viewerSrc = (data: DataDir, file: string) =>
  `/${data.fromData(file)}`;

/** The pages the commands serve, in the repository beside the code: `evals/viewers/`. */
export const VIEWERS = ["decide", "gallery", "review"] as const;

/**
 * A viewer's page. It is the code's, so a data directory made afresh has it; what the page shows
 * is the data directory's.
 */
export const viewerPage = Effect.fn("viewerPage")(function* (
  name: (typeof VIEWERS)[number]
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(path.join(EVALS, "viewers", `${name}.html`));
});

/** `{{name}}` in a template filled in; a name without a value is left as it is. */
export const fillTemplate = (
  template: string,
  values: Readonly<Record<string, string>>
) =>
  template.replaceAll(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : value;
  });

/** A template from `prompts/`, with `{{name}}` filled in. */
export const prompt = Effect.fn("prompt")(function* (
  name: string,
  values: Readonly<Record<string, string>>
) {
  const fs = yield* FileSystem.FileSystem;
  const template = yield* fs.readFileString(path.join(PROMPTS, `${name}.md`));
  return fillTemplate(template, values);
});

/** A JSON file decoded with a schema, failing with the file's name. */
export const readJson = <S extends Schema.Top>(schema: S, file: string) =>
  Effect.gen(function* () {
    const { data } = yield* EvalsConfig;
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(file).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(schema))),
      Effect.mapError(
        (cause) =>
          new EvalsError({
            message: `cannot read ${data.fromData(file)}: ${cause}`,
          })
      )
    );
  });

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

/**
 * A page file of the designs, as JSON. Its nodes are walked for the few fields a step reads, not
 * decoded as the contracts' `PageDocument`: a round may measure another commit of Ultrapaint, whose
 * pages need not match this one's contracts.
 */
export const readPageFile = Effect.fn("readPageFile")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(file).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))
    ),
    Effect.mapError(
      (cause) =>
        new EvalsError({ message: `cannot read the page ${file}: ${cause}` })
    )
  );
});

/** The files of a directory, sorted; none when it is not there. */
export const listDir = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const names: string[] = (yield* fs.exists(dir))
      ? yield* fs.readDirectory(dir)
      : [];
    return names.sort();
  });
