/**
 * `patterns`: how a product designed very well builds its interface, counted. Every picture of
 * Untitled UI on Dribbble (`gallery/untitled-ui.json`) is looked at once by a model that answers
 * the same questions of each (how groups are told apart, how much descriptive text and where, the
 * spacing, the actions, the type, the icons), and the answers are counted per kind of piece
 * (dialogs, settings pages, tables, menus…). A model then writes the counts up as a pattern book,
 * set against the skills the agents are taught and the person's principles.
 *
 *   patterns/pictures/   the pictures, downloaded (not kept in git)
 *   patterns/notes/      one file of answers per picture
 *   patterns/counts.json, patterns/book.md
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";

import { type DataDir, EvalsConfig } from "./config.ts";
import { fetchPicture } from "./fetch-picture.ts";
import {
  listDir,
  PROMPTS,
  prompt,
  readJson,
  writeJson,
  writeText,
} from "./layout.ts";
import { Models } from "./models.ts";

export const CORPUS_NAMES = [
  "landing",
  "landing-opus",
  "untitled-ui",
  "untitled-ui-opus",
] as const;
export type CorpusName = (typeof CORPUS_NAMES)[number];

/**
 * The corpora studied: each a list of shots and their pictures (URLs, or files on this machine),
 * the product they show, and the directory its study is kept in, both in the data directory.
 */
const CORPORA: Record<
  CorpusName,
  { readonly dir: string; readonly product: string; readonly shots: string }
> = {
  landing: {
    dir: "patterns-landing",
    product:
      "a set of well-made SaaS landing pages, each cut into slices of its height",
    shots: path.join("corpus", "landing", "tiles.json"),
  },
  /** The same pictures looked at again by Opus 5.5 (`src/api-patterns.mjs`), for the books. */
  "landing-opus": {
    dir: path.join("studies", "opus-5.5-patterns", "landing"),
    product:
      "a set of well-made SaaS landing pages, each cut into slices of its height",
    shots: path.join("corpus", "landing", "tiles.json"),
  },
  "untitled-ui": {
    dir: "patterns",
    product: "Untitled UI",
    shots: path.join("gallery", "untitled-ui.json"),
  },
  "untitled-ui-opus": {
    dir: path.join("studies", "opus-5.5-patterns", "untitled-ui"),
    product: "Untitled UI",
    shots: path.join("gallery", "untitled-ui.json"),
  },
};

/** Where a corpus's study is kept. */
const placesOf = (data: DataDir, corpus: CorpusName) => {
  const { product } = CORPORA[corpus];
  const dir = path.join(data.root, CORPORA[corpus].dir);
  return {
    CORPUS: path.join(data.root, CORPORA[corpus].shots),
    NOTES: path.join(dir, "notes"),
    PICTURES: path.join(dir, "pictures"),
    product,
    STUDY: dir,
  };
};

const CorpusShot = Schema.Struct({
  href: Schema.String,
  images: Schema.Array(Schema.String),
  title: Schema.String,
});

const SHOWS = [
  "screen",
  "section",
  "dialog",
  "menu",
  "component",
  "set",
  "skip",
] as const;
const GROUPING = ["cards", "dividers", "space", "mixed"] as const;
const PLACEMENT = [
  "header",
  "footer-right",
  "footer-full-width",
  "inline",
  "none",
] as const;

const Piece = Schema.Struct({
  actions: Schema.Struct({
    placement: Schema.Literals(PLACEMENT),
    primary: Schema.Number,
    secondary: Schema.Number,
    tertiary: Schema.Number,
  }),
  choices: Schema.Struct({
    count: Schema.Number,
    withDescription: Schema.Number,
  }),
  color: Schema.Struct({ accentUses: Schema.String }),
  fields: Schema.Struct({
    count: Schema.Number,
    placeholderOnly: Schema.Number,
    withHelperText: Schema.Number,
    withLabel: Schema.Number,
  }),
  file: Schema.String,
  grouping: Schema.Literals(GROUPING),
  groupingNote: Schema.String,
  headers: Schema.Array(
    Schema.Struct({
      actions: Schema.Number,
      descriptionWords: Schema.Number,
      level: Schema.Literals(["page", "section", "card", "dialog"]),
      words: Schema.Number,
    })
  ),
  icons: Schema.Struct({
    buttons: Schema.Boolean,
    decorative: Schema.Boolean,
    fieldLeading: Schema.Boolean,
    headers: Schema.Boolean,
    labels: Schema.Boolean,
    listRows: Schema.Boolean,
    navigation: Schema.Boolean,
  }),
  kind: Schema.String,
  listRows: Schema.Struct({
    count: Schema.Number,
    linesPerRow: Schema.Number,
    withIcon: Schema.Number,
  }),
  nesting: Schema.Number,
  observations: Schema.Array(Schema.String),
  shows: Schema.Literals(SHOWS),
  spacing: Schema.Struct({
    betweenGroups: Schema.Number,
    containerPadding: Schema.Number,
    withinGroup: Schema.Number,
  }),
  type: Schema.Struct({ sizes: Schema.Number, weights: Schema.Number }),
});
type Piece = typeof Piece.Type;

/** A JSON Schema of the same, for the model's answer. */
const pieceSchema = (() => {
  const n = { type: "number" };
  const b = { type: "boolean" };
  const s = { type: "string" };
  const object = (properties: Record<string, object>) => ({
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
    type: "object",
  });
  return object({
    actions: object({
      placement: { enum: PLACEMENT, type: "string" },
      primary: n,
      secondary: n,
      tertiary: n,
    }),
    choices: object({ count: n, withDescription: n }),
    color: object({ accentUses: s }),
    fields: object({
      count: n,
      placeholderOnly: n,
      withHelperText: n,
      withLabel: n,
    }),
    file: s,
    grouping: { enum: GROUPING, type: "string" },
    groupingNote: s,
    headers: {
      items: object({
        actions: n,
        descriptionWords: n,
        level: { enum: ["page", "section", "card", "dialog"], type: "string" },
        words: n,
      }),
      type: "array",
    },
    icons: object({
      buttons: b,
      decorative: b,
      fieldLeading: b,
      headers: b,
      labels: b,
      listRows: b,
      navigation: b,
    }),
    kind: s,
    listRows: object({ count: n, linesPerRow: n, withIcon: n }),
    nesting: n,
    observations: { items: s, type: "array" },
    shows: { enum: SHOWS, type: "string" },
    spacing: object({ betweenGroups: n, containerPadding: n, withinGroup: n }),
    type: object({ sizes: n, weights: n }),
  });
})();

const idOf = (url: string) =>
  createHash("sha1").update(url).digest("hex").slice(0, 12);

/** Every picture of the corpus, with the shot it is from. */
/**
 * Every picture of the corpus, in the order it is looked at: each shot's main picture first, the
 * shots in a fixed shuffled order, then each shot's second picture, and so on. A sample of the
 * first N is spread over N shots, and a larger one later goes on down the same list.
 */
const corpusPictures = Effect.fn("corpusPictures")(function* (
  corpus: CorpusName
) {
  const { data } = yield* EvalsConfig;
  const { CORPUS } = placesOf(data, corpus);
  const shots = [...(yield* readJson(Schema.Array(CorpusShot), CORPUS))].sort(
    (a, b) => idOf(a.href).localeCompare(idOf(b.href))
  );
  const deepest = Math.max(0, ...shots.map((s) => s.images.length));
  const ordered: {
    readonly file: string;
    readonly href: string;
    readonly image: string;
    readonly position: number;
    readonly title: string;
  }[] = [];
  for (let position = 0; position < deepest; position += 1) {
    for (const shot of shots) {
      const image = shot.images[position];
      if (image) {
        ordered.push({
          file: `${idOf(image)}.jpg`,
          href: shot.href,
          image,
          position: position + 1,
          title: shot.title,
        });
      }
    }
  }
  return ordered;
});

/** Every picture, with whether it has been looked at: what a later, larger sample goes on from. */
const writeIndex = Effect.fn("writeIndex")(function* (corpus: CorpusName) {
  const { data } = yield* EvalsConfig;
  const { NOTES, STUDY } = placesOf(data, corpus);
  const all = yield* corpusPictures(corpus);
  const noted = new Set(yield* listDir(NOTES));
  yield* writeJson(
    path.join(STUDY, "index.json"),
    all.map((p, order) => ({
      file: p.file,
      image: p.image,
      noted: noted.has(p.file.replace(".jpg", ".json")),
      order: order + 1,
      position: p.position,
      shot: p.href,
      title: p.title,
    }))
  );
  return { all: all.length, noted: noted.size };
});

const download = Effect.fn("download")(function* (url: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(file)) {
    return;
  }
  // A picture already on this machine: a file of the lab's own corpus.
  if (path.isAbsolute(url)) {
    return yield* fs.copyFile(url, file);
  }
  const { bytes } = yield* fetchPicture(`${url}?resize=2000x1500`);
  yield* fs.writeFile(file, bytes);
});

/** The pieces of a batch of pictures, as the model answers them. */
export const piecesAnswer = {
  decode: Schema.Struct({ pieces: Schema.Array(Piece) }),
  schema: {
    additionalProperties: false,
    properties: { pieces: { items: pieceSchema, type: "array" } },
    required: ["pieces"],
    type: "object",
  },
};

/** Each picture not yet looked at: downloaded, then answered for, a batch per call. */
export const annotate = Effect.fn("annotate")(function* (options: {
  readonly batch: number;
  readonly corpus: CorpusName;
  readonly concurrency: number;
  readonly limit: number;
  readonly model: string;
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const { NOTES, STUDY, PICTURES, product } = placesOf(data, options.corpus);
  yield* fs.makeDirectory(PICTURES, { recursive: true });
  yield* fs.makeDirectory(NOTES, { recursive: true });
  const all = yield* corpusPictures(options.corpus);
  const done = new Set(yield* listDir(NOTES));
  const pending = all
    .filter((p) => !done.has(p.file.replace(".jpg", ".json")))
    .slice(0, options.limit);
  yield* Effect.log(
    `${pending.length} of ${all.length} pictures to look at (${done.size} looked at before)`
  );
  const batches: (typeof pending)[] = [];
  for (let i = 0; i < pending.length; i += options.batch) {
    batches.push(pending.slice(i, i + options.batch));
  }
  let cost = 0;
  yield* Effect.forEach(
    batches,
    (batch) =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          batch,
          (p) => download(p.image, path.join(PICTURES, p.file)),
          { concurrency: 4 }
        );
        const answer = yield* models.ask({
          cwd: PICTURES,
          model: options.model,
          prompt: yield* prompt("patterns-annotate", {
            files: batch.map((p) => `- ${p.file} (${p.title})`).join("\n"),
            product,
          }),
          ...piecesAnswer,
        });
        const { pieces } = answer.value;
        cost += answer.costUsd;
        for (const piece of pieces) {
          const picture = batch.find((p) => p.file === piece.file);
          if (picture) {
            yield* writeJson(
              path.join(NOTES, picture.file.replace(".jpg", ".json")),
              { ...piece, href: picture.href, title: picture.title }
            );
          }
        }
        yield* Effect.log(
          `${pieces.length} of ${batch.length} looked at ($${answer.costUsd.toFixed(2)}, $${cost.toFixed(2)} so far)`
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.logError(`a batch failed: ${String(error)}`)
        )
      ),
    { concurrency: options.concurrency }
  );
  const index = yield* writeIndex(options.corpus);
  yield* Effect.log(
    `${index.noted} of ${index.all} pictures looked at; the list is ${data.fromData(path.join(STUDY, "index.json"))}`
  );
});

/** A kind of piece, from the model's free words: what the counts are grouped by. */
const KINDS: readonly (readonly [string, RegExp])[] = [
  ["dialog", /dialog|modal|confirm|alert/],
  ["menu", /menu|dropdown|command|palette|popover|switcher/],
  [
    "settings",
    /setting|preference|account|security|billing|notification setting/,
  ],
  ["navigation", /nav|sidebar|header|footer|tab bar/],
  ["table", /table|list|grid|directory/],
  ["form", /form|sign|login|password|onboarding|compose|upload|input|field/],
  ["dashboard", /dashboard|chart|metric|analytics|stat/],
  ["picker", /picker|calendar|date|time/],
  ["empty state", /empty|no result|not found/],
  ["marketing", /pricing|landing|hero|testimonial|feature|faq|cta|blog|about/],
  ["profile", /profile|card|member|team/],
];
const kindOf = (piece: Piece) =>
  KINDS.find(([, re]) => re.test(piece.kind.toLowerCase()))?.[0] ?? "other";

const share = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((100 * part) / whole);
const median = (values: readonly number[]) => {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.floor(sorted.length / 2)] ?? 0);
};

/** What a group of pieces does, as shares (%) and medians. */
const countsOf = (pieces: readonly Piece[]) => {
  const headers = pieces.flatMap((p) => p.headers);
  const sectionHeaders = headers.filter((h) => h.level !== "page");
  const fields = pieces.reduce((n, p) => n + p.fields.count, 0);
  const choices = pieces.reduce((n, p) => n + p.choices.count, 0);
  const tally = <K extends string>(of: (p: Piece) => K) => {
    const out: Record<string, number> = {};
    for (const p of pieces) {
      out[of(p)] = (out[of(p)] ?? 0) + 1;
    }
    return Object.fromEntries(
      Object.entries(out).map(([k, v]) => [k, share(v, pieces.length)])
    );
  };
  const icon = (k: keyof Piece["icons"]) =>
    share(pieces.filter((p) => p.icons[k]).length, pieces.length);
  return {
    actionsPlacement: tally((p) => p.actions.placement),
    choicesWithDescription: share(
      pieces.reduce((n, p) => n + p.choices.withDescription, 0),
      choices
    ),
    fieldsPlaceholderOnly: share(
      pieces.reduce((n, p) => n + p.fields.placeholderOnly, 0),
      fields
    ),
    fieldsWithHelperText: share(
      pieces.reduce((n, p) => n + p.fields.withHelperText, 0),
      fields
    ),
    fieldsWithLabel: share(
      pieces.reduce((n, p) => n + p.fields.withLabel, 0),
      fields
    ),
    grouping: tally((p) => p.grouping),
    headerDescriptionWords: median(
      sectionHeaders.map((h) => h.descriptionWords)
    ),
    headersWithDescription: share(
      sectionHeaders.filter((h) => h.descriptionWords > 0).length,
      sectionHeaders.length
    ),
    headerTitleWords: median(headers.map((h) => h.words)),
    icons: {
      buttons: icon("buttons"),
      decorative: icon("decorative"),
      fieldLeading: icon("fieldLeading"),
      headers: icon("headers"),
      labels: icon("labels"),
      listRows: icon("listRows"),
      navigation: icon("navigation"),
    },
    nesting: median(pieces.map((p) => p.nesting)),
    pieces: pieces.length,
    primaryButtons: median(pieces.map((p) => p.actions.primary)),
    spacing: {
      betweenGroups: median(pieces.map((p) => p.spacing.betweenGroups)),
      containerPadding: median(pieces.map((p) => p.spacing.containerPadding)),
      withinGroup: median(pieces.map((p) => p.spacing.withinGroup)),
    },
    typeSizes: median(pieces.map((p) => p.type.sizes)),
    typeWeights: median(pieces.map((p) => p.type.weights)),
  };
};

/** The pattern book: the notes counted per kind, then written up against the skills. */
export const book = Effect.fn("book")(function* (options: {
  readonly corpus: CorpusName;
  readonly model: string;
  readonly skillsFrom: string;
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const { NOTES, STUDY, product } = placesOf(data, options.corpus);
  const pieces: Piece[] = [];
  for (const file of yield* listDir(NOTES)) {
    const piece = yield* readJson(Piece, path.join(NOTES, file)).pipe(
      Effect.option
    );
    if (piece._tag === "Some" && piece.value.shows !== "skip") {
      pieces.push(piece.value);
    }
  }
  if (pieces.length === 0) {
    return yield* Effect.logWarning("no pieces looked at yet: annotate first");
  }
  const byKind = new Map<string, Piece[]>();
  for (const p of pieces) {
    byKind.set(kindOf(p), [...(byKind.get(kindOf(p)) ?? []), p]);
  }
  const counts = {
    all: countsOf(pieces),
    byKind: Object.fromEntries(
      [...byKind.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([kind, of]) => [kind, countsOf(of)])
    ),
  };
  yield* writeJson(path.join(STUDY, "counts.json"), counts);
  yield* writeJson(
    path.join(STUDY, "notes.json"),
    Object.fromEntries(
      [...byKind.entries()].map(([kind, of]) => [
        kind,
        of.map((p) => ({
          grouping: p.groupingNote,
          kind: p.kind,
          observations: p.observations,
        })),
      ])
    )
  );
  // The skills as a round recorded them, or a folder of them, beside the counts, for the book to
  // set them against.
  const skills = path.isAbsolute(options.skillsFrom)
    ? options.skillsFrom
    : path.join(data.runs, options.skillsFrom, "skills");
  yield* fs.remove(path.join(STUDY, "skills"), {
    force: true,
    recursive: true,
  });
  yield* fs.copy(skills, path.join(STUDY, "skills"));
  // No schema: an enforced answer format made the study's notes terse, so the book comes as text.
  const answer = yield* models.write({
    cwd: STUDY,
    model: options.model,
    prompt: yield* prompt("patterns-book", {
      principles: yield* fs.readFileString(path.join(PROMPTS, "principles.md")),
      product,
    }),
  });
  const { text } = answer;
  yield* writeText(
    path.join(STUDY, "book.md"),
    `<!-- From ${pieces.length} pieces of ${product}; $${answer.costUsd.toFixed(2)}. -->\n\n${text.trim()}\n`
  );
  yield* Effect.log(
    `pattern book: ${data.fromData(path.join(STUDY, "book.md"))} (${pieces.length} pieces)`
  );
});
