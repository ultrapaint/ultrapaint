/**
 * `sections`: a screen in parts, for a person to compare one part at a time rather than a whole
 * screen at once. A model names a reference's sections once (the sidebar, the page's header, the
 * key figures, the table…) and marks them on its picture (`references/<id>/sections.json`); then,
 * in each run of a round, it finds the same sections in the agent's design (`sections.json` in
 * the run). Each is cut out into `sections/<slug>.jpg` beside the file, for the review's cards.
 *
 * The boxes come from a model's eye, so they are approximate; a crop is a little wider than its
 * box, and good enough to compare a sidebar with a sidebar.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { ADDED_TEXT_FILE, AddedTextEntry } from "./added-text.ts";
import { Browser } from "./browser.ts";
import { EvalsConfig } from "./config.ts";
import { roundRuns } from "./judge.ts";
import { listDir, prompt, readJson, writeJson } from "./layout.ts";
import { Models } from "./models.ts";
import { loadReference } from "./reference.ts";

const Box = Schema.Struct({
  height: Schema.Number,
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});

export const ReferenceSection = Schema.Struct({
  box: Box,
  name: Schema.String,
  picture: Schema.String,
  what: Schema.String,
});
export type ReferenceSection = typeof ReferenceSection.Type;

export const DesignSection = Schema.Struct({
  box: Box,
  missing: Schema.Boolean,
  name: Schema.String,
  picture: Schema.String,
});

const ReferenceSections = Schema.Struct({
  sections: Schema.Array(ReferenceSection),
});
const DesignSections = Schema.Struct({ sections: Schema.Array(DesignSection) });

export const SECTIONS_FILE = "sections.json";
export const SECTIONS_DIR = "sections";

/** `Revenue chart` → `revenue-chart`: the crop's file name. */
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const string = { type: "string" };
const boxSchema = {
  additionalProperties: false,
  properties: {
    height: { type: "number" },
    width: { type: "number" },
    x: { type: "number" },
    y: { type: "number" },
  },
  required: ["x", "y", "width", "height"],
  type: "object",
};
const sectionsSchema = (item: object) => ({
  additionalProperties: false,
  properties: { sections: { items: item, type: "array" } },
  required: ["sections"],
  type: "object",
});
const referenceSchema = sectionsSchema({
  additionalProperties: false,
  properties: { box: boxSchema, name: string, picture: string, what: string },
  required: ["name", "what", "picture", "box"],
  type: "object",
});
const designSchema = (names: readonly string[]) =>
  sectionsSchema({
    additionalProperties: false,
    properties: {
      box: boxSchema,
      missing: { type: "boolean" },
      name: { enum: names, type: "string" },
      picture: string,
    },
    required: ["name", "missing", "picture", "box"],
    type: "object",
  });

/** A reference's sections, as the model marks them. */
export const referenceSectionsAnswer = {
  decode: ReferenceSections,
  schema: referenceSchema,
};
/** The reference's sections found in a design, as the model marks them. */
export const designSectionsAnswer = (names: readonly string[]) => ({
  decode: DesignSections,
  schema: designSchema(names),
});

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Each section cut out of its picture, into `sections/<slug>.jpg` beside them. */
const cutOut = Effect.fn("cutOut")(function* (
  dir: string,
  parts: readonly {
    readonly box: typeof Box.Type;
    readonly name: string;
    readonly picture: string;
  }[]
) {
  const fs = yield* FileSystem.FileSystem;
  const browser = yield* Browser;
  yield* fs.makeDirectory(path.join(dir, SECTIONS_DIR), { recursive: true });
  for (const section of parts) {
    const file = path.join(dir, section.picture);
    if (!(yield* fs.exists(file)) || section.box.width <= 0) {
      continue;
    }
    const bytes = yield* fs.readFile(file);
    const crop = yield* browser.crop(
      bytes,
      MIME[path.extname(file)] ?? "image/jpeg",
      section.box
    );
    yield* fs.writeFile(
      path.join(dir, SECTIONS_DIR, `${slugOf(section.name)}.jpg`),
      crop
    );
  }
});

const PICTURE = /\.(jpg|png|webp)$/;
const PAGE_TILE = /^desktop-\d+\.jpg$/;

const pictureList = (files: readonly string[]) =>
  files
    .filter((f) => PICTURE.test(f))
    .map((f) => `- ${f}`)
    .join("\n");

/** A reference's sections, named and marked once, and kept. */
export const referenceSections = Effect.fn("referenceSections")(function* (
  id: string,
  options: { readonly force: boolean; readonly model: string }
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const file = path.join(data.referenceDir(id), SECTIONS_FILE);
  if ((yield* fs.exists(file)) && !options.force) {
    return (yield* readJson(ReferenceSections, file)).sections;
  }
  const reference = yield* loadReference(id);
  const capture = data.captureDir(id);
  const answer = yield* models.ask({
    cwd: capture,
    model: options.model,
    prompt: yield* prompt("sections-reference", {
      files: pictureList(
        (yield* listDir(capture)).filter((f) => f.startsWith("desktop-fold"))
      ).concat(
        `\n${pictureList((yield* listDir(capture)).filter((f) => f.startsWith("zoom-")))}`
      ),
      kind: reference.kind,
      name: reference.name,
    }),
    ...referenceSectionsAnswer,
  });
  const found = answer.value;
  yield* writeJson(file, found);
  yield* cutOut(capture, found.sections);
  yield* Effect.log(
    `${id}: ${found.sections.map((s) => s.name).join(", ")} ($${answer.costUsd.toFixed(2)})`
  );
  return found.sections;
});

/** The reference's sections found in one run's design. */
export const runSections = Effect.fn("runSections")(function* (
  dir: string,
  marked: readonly ReferenceSection[],
  model: string
) {
  const { data } = yield* EvalsConfig;
  const models = yield* Models;
  const shots = path.join(dir, "shots");
  const files = (yield* listDir(shots)).filter((f) => f.startsWith("desktop"));
  if (files.length === 0) {
    return;
  }
  const answer = yield* models.ask({
    cwd: shots,
    model,
    prompt: yield* prompt("sections-design", {
      files: pictureList(files),
      sections: marked.map((s) => `- ${s.name}: ${s.what}`).join("\n"),
    }),
    ...designSectionsAnswer(marked.map((s) => s.name)),
  });
  const found = answer.value;
  yield* writeJson(path.join(dir, SECTIONS_FILE), found);
  yield* cutOut(
    shots,
    found.sections.filter((s) => !s.missing)
  );
  yield* Effect.log(
    `${data.fromData(dir)}: ${found.sections.filter((s) => !s.missing).length} of ${marked.length} sections found ($${answer.costUsd.toFixed(2)})`
  );
});

/** A mean grey difference past which a part is taken as not found on its page. */
const NOT_FOUND = 45;

/**
 * Where each text a run added is on its page: its node's picture found in the page's pictures,
 * so a person sees it in place on the whole screen rather than cut out alone.
 */
const markAddedText = Effect.fn("markAddedText")(function* (dir: string) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const browser = yield* Browser;
  const file = path.join(dir, ADDED_TEXT_FILE);
  if (!(yield* fs.exists(file))) {
    return;
  }
  const entries = yield* readJson(Schema.Array(AddedTextEntry), file);
  if (entries.every((e) => e.mark !== undefined || e.picture === undefined)) {
    return;
  }
  const tiles = (yield* listDir(path.join(dir, "shots"))).filter((f) =>
    PAGE_TILE.test(f)
  );
  if (tiles.length === 0) {
    return;
  }
  const pictures = yield* Effect.forEach(tiles, (f) =>
    fs.readFile(path.join(dir, "shots", f))
  );
  const found = new Map<string, AddedTextEntry["mark"]>();
  for (const picture of new Set(entries.flatMap((e) => e.picture ?? []))) {
    const where = yield* browser.locate(
      yield* fs.readFile(path.join(dir, picture)),
      pictures
    );
    const tile = where ? tiles[where.index] : undefined;
    if (where && tile && where.score < NOT_FOUND) {
      found.set(picture, { box: where.box, picture: path.join("shots", tile) });
    }
  }
  yield* writeJson(
    file,
    entries.map((e) => {
      const mark = e.picture ? found.get(e.picture) : undefined;
      return mark ? { ...e, mark } : e;
    })
  );
  yield* Effect.log(
    `${data.fromData(dir)}: ${found.size} of ${new Set(entries.flatMap((e) => e.picture ?? [])).size} added texts found on the page`
  );
});

export const sections = Effect.fn("sections")(function* (
  rounds: readonly string[],
  options: {
    readonly concurrency: number;
    readonly force: boolean;
    readonly model: string;
  }
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const runs = (yield* Effect.forEach(rounds, roundRuns)).flat();
  const references = [...new Set(runs.map((r) => r.reference))];
  const marked = new Map<string, readonly ReferenceSection[]>();
  yield* Effect.forEach(
    references,
    (id) =>
      referenceSections(id, options).pipe(
        Effect.tap((found) => Effect.sync(() => marked.set(id, found))),
        Effect.catch((error) =>
          Effect.logError(`${id}: no sections: ${String(error)}`)
        )
      ),
    { concurrency: options.concurrency }
  );
  const pending = options.force
    ? runs
    : yield* Effect.filter(runs, (run) =>
        Effect.map(
          fs.exists(path.join(run.dir, SECTIONS_FILE)),
          (done) => !done
        )
      );
  yield* Effect.forEach(
    runs,
    (run) =>
      markAddedText(run.dir).pipe(
        Effect.catch((error) =>
          Effect.logError(
            `${data.fromData(run.dir)}: added texts not found: ${String(error)}`
          )
        )
      ),
    { concurrency: options.concurrency }
  );
  yield* Effect.forEach(
    pending,
    (run) => {
      const found = marked.get(run.reference);
      return found
        ? runSections(run.dir, found, options.model).pipe(
            Effect.catch((error) =>
              Effect.logError(
                `${data.fromData(run.dir)}: no sections: ${String(error)}`
              )
            )
          )
        : Effect.void;
    },
    { concurrency: options.concurrency }
  );
});

/** A run's sections, by name, with their crops; none when they were not found. */
export const readRunSections = Effect.fn("readRunSections")(function* (
  dir: string
) {
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(dir, SECTIONS_FILE);
  if (!(yield* fs.exists(file))) {
    return new Map<string, string>();
  }
  const found = yield* readJson(DesignSections, file);
  const crops = new Map<string, string>();
  for (const s of found.sections) {
    const crop = path.join(dir, "shots", SECTIONS_DIR, `${slugOf(s.name)}.jpg`);
    if (!s.missing && (yield* fs.exists(crop))) {
      crops.set(s.name, crop);
    }
  }
  return crops;
});

/** A reference's sections with their crops; none when they were not marked. */
export const readReferenceSections = Effect.fn("readReferenceSections")(
  function* (id: string) {
    const { data } = yield* EvalsConfig;
    const fs = yield* FileSystem.FileSystem;
    const file = path.join(data.referenceDir(id), SECTIONS_FILE);
    const found: typeof ReferenceSections.Type = (yield* fs.exists(file))
      ? yield* readJson(ReferenceSections, file)
      : { sections: [] };
    return found.sections.map((section) => ({
      crop: path.join(
        data.captureDir(id),
        SECTIONS_DIR,
        `${slugOf(section.name)}.jpg`
      ),
      section,
    }));
  }
);
