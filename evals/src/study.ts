/**
 * `study`: what the library of well-made sites (`corpus/<source>/`, pictured by the collectors)
 * says about each dimension of design, counted. Every site is looked at once by a model that
 * answers for every dimension at once (character, layout, typography, colour, spacing, imagery,
 * icons, components, content); the answers are counted per dimension and per character, and a
 * reference is written per dimension from the counts and the sites' observations.
 *
 *   studies/<model>/notes/<source>__<site>.json, studies/<model>/<dimension>[-<character>].md
 */
import path from "node:path";
import { Effect, FileSystem, Predicate, Schema } from "effect";
import { type DataDir, EvalsConfig } from "./config.ts";
import { skillDirOf } from "./judge.ts";
import {
  listDir,
  PROMPTS,
  prompt,
  readJson,
  writeJson,
  writeText,
} from "./layout.ts";
import { Models } from "./models.ts";

/** Each model's reading of the library is kept apart, so they can be compared. */
const notesOf = (data: DataDir, model: string) =>
  path.join(data.studies, model, "notes");
export const DIMENSIONS = [
  "layout",
  "typography",
  "color",
  "spacing",
  "imagery",
  "icons",
  "components",
  "content",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];
const CHARACTERS = ["technical", "humanistic", "expressive"] as const;

const IndexEntry = Schema.Struct({
  key: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  status: Schema.String,
  tags: Schema.optional(Schema.Array(Schema.String)),
  title: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
});

export interface Site {
  readonly corpus: string;
  readonly key: string;
  readonly tags: readonly string[];
  readonly title: string;
}

/** The JSON Schema a site's note is asked in. */
const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };
const strs = { items: str, type: "array" };
const group = (properties: Record<string, unknown>) => ({
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
  type: "object",
});
const siteSchema = group({
  capture: { enum: ["ok", "broken"], type: "string" },
  character: { enum: [...CHARACTERS], type: "string" },
  color: group({
    accentUse: str,
    background: str,
    gradients: bool,
    palette: num,
    textContrast: str,
  }),
  components: group({
    buttonStyle: str,
    buttons: str,
    cards: str,
    nav: str,
    radius: num,
  }),
  content: group({
    ctas: num,
    eyebrow: bool,
    headlineWords: num,
    subheadWords: num,
  }),
  genre: str,
  icons: group({ style: str, use: str }),
  imagery: group({ kinds: strs, role: str, style: str }),
  key: str,
  layout: group({
    alignment: str,
    contentWidth: num,
    hero: str,
    structure: str,
  }),
  observations: strs,
  spacing: group({ density: str, padding: num, sectionGap: num }),
  typography: group({
    accent: str,
    bodyFace: str,
    faces: strs,
    headingCase: str,
    headingFace: str,
    headingSize: num,
    headingWeight: str,
    sizes: num,
    tracking: str,
  }),
});

/** A site's note as it is decoded: `siteSchema`, field for field. */
const SiteNote = Schema.Struct({
  capture: Schema.Literals(["ok", "broken"]),
  character: Schema.Literals(CHARACTERS),
  color: Schema.Struct({
    accentUse: Schema.String,
    background: Schema.String,
    gradients: Schema.Boolean,
    palette: Schema.Number,
    textContrast: Schema.String,
  }),
  components: Schema.Struct({
    buttonStyle: Schema.String,
    buttons: Schema.String,
    cards: Schema.String,
    nav: Schema.String,
    radius: Schema.Number,
  }),
  content: Schema.Struct({
    ctas: Schema.Number,
    eyebrow: Schema.Boolean,
    headlineWords: Schema.Number,
    subheadWords: Schema.Number,
  }),
  genre: Schema.String,
  icons: Schema.Struct({ style: Schema.String, use: Schema.String }),
  imagery: Schema.Struct({
    kinds: Schema.Array(Schema.String),
    role: Schema.String,
    style: Schema.String,
  }),
  key: Schema.String,
  layout: Schema.Struct({
    alignment: Schema.String,
    contentWidth: Schema.Number,
    hero: Schema.String,
    structure: Schema.String,
  }),
  observations: Schema.Array(Schema.String),
  spacing: Schema.Struct({
    density: Schema.String,
    padding: Schema.Number,
    sectionGap: Schema.Number,
  }),
  typography: Schema.Struct({
    accent: Schema.String,
    bodyFace: Schema.String,
    faces: Schema.Array(Schema.String),
    headingCase: Schema.String,
    headingFace: Schema.String,
    headingSize: Schema.Number,
    headingWeight: Schema.String,
    sizes: Schema.Number,
    tracking: Schema.String,
  }),
});
/** The notes of a batch of sites, as the model answers them. */
export const siteNotesAnswer = {
  decode: Schema.Struct({ sites: Schema.Array(SiteNote) }),
  schema: group({ sites: { items: siteSchema, type: "array" } }),
};
/** A dimension's reference, as the model writes it. */
export const studyReferenceAnswer = {
  decode: Schema.Struct({ reference: Schema.String }),
  schema: group({ reference: str }),
};

/** Every pictured site of the sources, with its slices, in a fixed shuffled order. */
export const sitesOf = Effect.fn("sitesOf")(function* (
  sources: readonly string[]
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const sites: Site[] = [];
  for (const corpus of sources) {
    const file = path.join(data.corpus, corpus, "index.json");
    if (!(yield* fs.exists(file))) {
      continue;
    }
    for (const e of yield* readJson(Schema.Array(IndexEntry), file)) {
      const key = e.key ?? e.slug;
      if (
        e.status === "ok" &&
        key !== undefined &&
        (yield* fs.exists(path.join(data.corpus, corpus, key, "slice-2.jpg")))
      ) {
        sites.push({ corpus, key, tags: e.tags ?? [], title: e.title ?? key });
      }
    }
  }
  const order = (s: Site) =>
    [...`${s.corpus}/${s.key}`].reduce(
      (h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003,
      7
    );
  return sites.sort((a, b) => order(a) - order(b));
});

const noteFile = (data: DataDir, s: Site, model: string) =>
  path.join(notesOf(data, model), `${s.corpus}__${s.key}.json`);

/** Each site not yet looked at, a few per call, every dimension answered at once. */
export const studyAnnotate = Effect.fn("studyAnnotate")(function* (options: {
  readonly batch: number;
  readonly concurrency: number;
  readonly effort: string;
  readonly limit: number;
  readonly model: string;
  readonly sources: readonly string[];
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  // Codex is given the pictures attached; the effort is for Codex and Cursor, Claude keeps its own.
  const runsIn = models.runsIn(options.model);
  yield* fs.makeDirectory(notesOf(data, options.model), { recursive: true });
  const all = yield* sitesOf(options.sources);
  const pending: Site[] = [];
  for (const s of all) {
    if (pending.length >= options.limit) {
      break;
    }
    if (!(yield* fs.exists(noteFile(data, s, options.model)))) {
      pending.push(s);
    }
  }
  yield* Effect.log(`${pending.length} of ${all.length} sites to look at`);
  const batches: Site[][] = [];
  for (let i = 0; i < pending.length; i += options.batch) {
    batches.push(pending.slice(i, i + options.batch));
  }
  let cost = 0;
  let tokens = 0;
  yield* Effect.forEach(
    batches,
    (batch) =>
      Effect.gen(function* () {
        const images = batch.flatMap((s) =>
          ["slice-1.jpg", "slice-2.jpg"].map((f) => `${s.corpus}/${s.key}/${f}`)
        );
        const listing = batch
          .map((s, i) => {
            const pictures =
              runsIn === "codex"
                ? `attached pictures ${i * 2 + 1} (\`slice-1.jpg\`) and ${i * 2 + 2} (\`slice-2.jpg\`)`
                : `\`${s.corpus}/${s.key}/slice-1.jpg\`, \`${s.corpus}/${s.key}/slice-2.jpg\``;
            return `- key \`${s.key}\` (${s.title}; ${s.tags.slice(0, 6).join(", ")}): ${pictures}`;
          })
          .join("\n");
        const text = yield* prompt("study-annotate", { sites: listing });
        const answer = yield* models.ask({
          cwd: data.corpus,
          ...(runsIn !== "claude" && { effort: options.effort }),
          images,
          model: options.model,
          prompt: text,
          ...siteNotesAnswer,
        });
        cost += answer.costUsd;
        tokens += answer.tokens;
        const { sites } = answer.value;
        for (const note of sites) {
          const site = batch.find((s) => s.key === note.key);
          if (site) {
            yield* writeJson(noteFile(data, site, options.model), {
              ...note,
              corpus: site.corpus,
              model: options.model,
              tags: site.tags,
              title: site.title,
            });
          }
        }
        yield* Effect.log(
          `${sites.length} of ${batch.length} looked at (${tokens} tokens, $${cost.toFixed(2)} so far)`
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.logError(`a batch failed: ${String(error)}`)
        )
      ),
    { concurrency: options.concurrency }
  );
});

/** A site's note as kept: its answers, and the site's corpus, title and tags beside them. */
const Note = Schema.Record(Schema.String, Schema.Unknown);
type Note = typeof Note.Type;

/** How often each answer of a dimension's fields appears, and medians for its numbers. */
const countsOf = (notes: readonly Note[], dimension: Dimension) => {
  const fields: Record<
    string,
    Record<string, number> | { median: number; n: number }
  > = {};
  const values = new Map<string, unknown[]>();
  for (const note of notes) {
    const answers = note[dimension];
    for (const [field, value] of Object.entries(
      Predicate.isObject(answers) ? answers : {}
    )) {
      values.set(field, [...(values.get(field) ?? []), value]);
    }
  }
  for (const [field, all] of values) {
    const numbers = all.filter(Predicate.isNumber);
    if (numbers.length === all.length) {
      const sorted = numbers.filter((v) => v > 0).sort((a, b) => a - b);
      fields[field] = {
        median: sorted[Math.floor(sorted.length / 2)] ?? 0,
        n: sorted.length,
      };
      continue;
    }
    const tally: Record<string, number> = {};
    for (const v of all.flatMap((x) => (Array.isArray(x) ? x : [x]))) {
      const k = String(v).toLowerCase().slice(0, 60);
      tally[k] = (tally[k] ?? 0) + 1;
    }
    fields[field] = Object.fromEntries(
      Object.entries(tally)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
    );
  }
  return { fields, sites: notes.length };
};

/** A dimension's reference: its counts by character and the sites' notes, written up. */
export const studyBook = Effect.fn("studyBook")(function* (options: {
  readonly character: string | undefined;
  readonly dimension: Dimension;
  readonly model: string;
  /** The model whose reading of the library the reference is written from. */
  readonly notes: string;
  readonly skillsFrom: string;
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const notes: Note[] = [];
  for (const file of yield* listDir(notesOf(data, options.notes))) {
    const note = yield* readJson(
      Note,
      path.join(notesOf(data, options.notes), file)
    ).pipe(Effect.option);
    if (
      note._tag === "Some" &&
      (options.character === undefined ||
        note.value.character === options.character)
    ) {
      notes.push(note.value);
    }
  }
  if (notes.length === 0) {
    return yield* Effect.logWarning("no notes yet: study annotate first");
  }
  const name = options.character
    ? `${options.dimension}-${options.character}`
    : options.dimension;
  const work = path.join(data.studies, options.notes, "work", name);
  yield* fs.makeDirectory(work, { recursive: true });
  const byCharacter = Object.fromEntries(
    CHARACTERS.map((c) => [
      c,
      countsOf(
        notes.filter((n) => n.character === c),
        options.dimension
      ),
    ])
  );
  yield* writeJson(path.join(work, "counts.json"), {
    all: countsOf(notes, options.dimension),
    byCharacter,
  });
  yield* writeJson(
    path.join(work, "notes.json"),
    notes.map((n) => ({
      [options.dimension]: n[options.dimension],
      character: n.character,
      genre: n.genre,
      observations: n.observations,
      site: `${String(n.corpus)}/${String(n.title)}`,
    }))
  );
  yield* fs.remove(path.join(work, "skills"), { force: true, recursive: true });
  yield* fs.copy(
    yield* skillDirOf(options.skillsFrom),
    path.join(work, "skills")
  );
  const answer = yield* models.ask({
    cwd: work,
    model: options.model,
    prompt: yield* prompt("study-book", {
      dimension: options.dimension,
      principles: yield* fs.readFileString(path.join(PROMPTS, "principles.md")),
      scope: options.character
        ? `the ${notes.length} ${options.character} sites`
        : `all ${notes.length} sites`,
    }),
    ...studyReferenceAnswer,
  });
  const { reference } = answer.value;
  const out = path.join(data.studies, options.notes, `${name}.md`);
  yield* writeText(
    out,
    `<!-- From ${notes.length} sites of the library; $${answer.costUsd.toFixed(2)}. -->\n\n${reference.trim()}\n`
  );
  yield* Effect.log(`reference: ${data.fromData(out)} (${notes.length} sites)`);
});
