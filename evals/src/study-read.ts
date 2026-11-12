/**
 * `study read`: every page and app screen of the lab's sources read once with the study's
 * questions (`prompts/study-read.md`, fifth version, 12 November; ADR 0082): what it is for, how
 * it is seen section by section (each boxed on its picture), its system as values, its words, its
 * moves and weak points placed by section, the tells, its craft. One model call per page, every
 * picture of it read: up to four tiles spread down the desktop page, the phone's first screen,
 * and what the capture recorded of its motion.
 *
 * The questions are asked once and kept: a note records the questions' version, the model, the
 * pictures and when, so a source added later is read the same way and joins the counts.
 *
 *   studies/<model>-questions-5/pictures/<source>__<key>/, studies/<model>-questions-5/notes/<source>__<key>.json
 */
import path from "node:path";
import { Effect, FileSystem, Predicate, Schema } from "effect";
import { Browser } from "./browser.ts";
import { EvalsConfig } from "./config.ts";
import { listDir, prompt, readJson, writeJson } from "./layout.ts";
import { Models } from "./models.ts";

export const QUESTIONS = 5;
/** Tiles kept of a desktop page: the first, the last and those evenly between. */
const TILES = 4;

/** One page or screen to read, from a source. */
export interface Page {
  /** The desktop picture, whole page or one screen. */
  readonly desktop: string;
  /** Its file name in the study: `<source>__<key>`. */
  readonly id: string;
  readonly kind: "app-screen" | "public-page";
  readonly mobile?: string;
  readonly motion?: string;
  /** How the pictures relate to CSS px, for the model. */
  readonly scale: string;
  readonly source: string;
  /** Its width in CSS px: the picture is scaled to it. */
  readonly width: number;
}

const PUBLIC_SCALE =
  "Sizes are CSS px at the picture's width (a 1440px desktop; the phone's first screen is 390px wide drawn at 2×).";
const SHOT_SCALE =
  "This is a presentation shot of an app screen, as its designer published it: estimate sizes in CSS px as the app would run in a desktop browser.";

const IndexEntry = Schema.Struct({
  key: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  status: Schema.String,
});
const CatalogScreen = Schema.Struct({
  image: Schema.String,
  width: Schema.optional(Schema.Number),
});
const Catalog = Schema.Struct({
  marketing: Schema.optional(Schema.Array(CatalogScreen)),
  product: Schema.optional(Schema.Array(CatalogScreen)),
});
const ShotEntry = Schema.Struct({ file: Schema.String });

/** A fixed order that mixes a source's pages, the same on every run. */
const order = (id: string) =>
  [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7);

/** CSS px of a capture taken at 2× when it is that wide. */
const cssWidth = (width: number | undefined) => {
  if (width === undefined) {
    return 1440;
  }
  return width >= 2000 ? width / 2 : width;
};

/** A Screenrove pack's product screens as app screens, its marketing pages as public pages. */
const packPages = Effect.fnUntraced(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const pages: Page[] = [];
  for (const pack of yield* listDir(dir)) {
    // The packs sit beside a README and their zips.
    if ((yield* fs.stat(path.join(dir, pack))).type !== "Directory") {
      continue;
    }
    const file = path.join(dir, pack, "catalog.json");
    const catalog = (yield* fs.exists(file))
      ? yield* readJson(Catalog, file)
      : {};
    const screens = [
      ...(catalog.product ?? []).map((s) => ["app-screen", s] as const),
      ...(catalog.marketing ?? []).map((s) => ["public-page", s] as const),
    ];
    for (const [kind, screen] of screens) {
      const width = cssWidth(screen.width);
      pages.push({
        desktop: path.join(dir, pack, "captures", screen.image),
        id: `screenrove__${path.parse(screen.image).name}`,
        kind,
        scale:
          kind === "app-screen"
            ? `Sizes are CSS px: the screen is a desktop browser window ${width}px wide, drawn at 1×.`
            : PUBLIC_SCALE,
        source: "screenrove",
        width,
      });
    }
  }
  return pages;
});

/** The shots of a gallery's sample on disk, as app screens. */
const shotPages = Effect.fnUntraced(function* (dir: string, source: string) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(dir, "index.json");
  const pages: Page[] = [];
  for (const shot of (yield* fs.exists(file))
    ? yield* readJson(Schema.Array(ShotEntry), file)
    : []) {
    const desktop = path.join(data.root, shot.file);
    if (yield* fs.exists(desktop)) {
      pages.push({
        desktop,
        id: `${source}__${path.parse(shot.file).name}`,
        kind: "app-screen",
        scale: SHOT_SCALE,
        source,
        width: 1600,
      });
    }
  }
  return pages;
});

/** A source's captured sites (`<key>/desktop.jpg`, a phone's and the motion beside it). */
const sitePages = Effect.fnUntraced(function* (dir: string, source: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(dir, "index.json");
  const pages: Page[] = [];
  for (const e of (yield* fs.exists(file))
    ? yield* readJson(Schema.Array(IndexEntry), file)
    : []) {
    const key = e.key ?? e.slug;
    if (e.status !== "ok" || key === undefined) {
      continue;
    }
    const at = path.join(dir, key);
    if (!(yield* fs.exists(path.join(at, "desktop.jpg")))) {
      continue;
    }
    const mobile = path.join(at, "mobile.jpg");
    const motion = path.join(at, "motion.json");
    pages.push({
      desktop: path.join(at, "desktop.jpg"),
      id: `${source}__${key}`,
      kind: "public-page",
      ...((yield* fs.exists(mobile)) && { mobile }),
      ...((yield* fs.exists(motion)) && { motion }),
      scale: PUBLIC_SCALE,
      source,
      width: 1440,
    });
  }
  return pages;
});

/**
 * The pages of each source, in a fixed mixed order. A captured site (`corpus/<source>/<key>/`,
 * with `desktop.jpg`) is a public page; a Screenrove pack gives its product screens as app
 * screens and its marketing pages as public pages; `untitled-ui` gives its shots as app screens.
 */
export const pagesOf = Effect.fn("pagesOf")(function* (
  sources: readonly string[]
) {
  const { data } = yield* EvalsConfig;
  const pages: Page[] = [];
  for (const source of sources) {
    const dir = path.join(data.corpus, source);
    if (source === "screenrove") {
      pages.push(...(yield* packPages(dir)));
    } else if (source === "untitled-ui") {
      pages.push(...(yield* shotPages(dir, source)));
    } else {
      pages.push(...(yield* sitePages(dir, source)));
    }
  }
  return pages.sort((a, b) => order(a.id) - order(b.id));
});

/**
 * At most `n` pages, taken in turn from each source, so a sample is spread over the sources;
 * every page when `n` is undefined.
 */
export const spread = (pages: readonly Page[], n: number | undefined) => {
  if (n === undefined) {
    return pages;
  }
  const bySource = new Map<string, Page[]>();
  for (const p of pages) {
    bySource.set(p.source, [...(bySource.get(p.source) ?? []), p]);
  }
  const queues = [...bySource.values()];
  const taken: Page[] = [];
  for (
    let i = 0;
    taken.length < n && queues.some((q) => i < q.length);
    i += 1
  ) {
    for (const q of queues) {
      const page = q[i];
      if (page !== undefined && taken.length < n) {
        taken.push(page);
      }
    }
  }
  return taken;
};

/** The tiles kept of `count`: the first, the last and those evenly between, at most `TILES`. */
export const spreadTiles = (count: number) =>
  count <= TILES
    ? [...new Array(count).keys()]
    : [
        ...new Set(
          [...new Array(TILES).keys()].map((i) =>
            Math.round((i * (count - 1)) / (TILES - 1))
          )
        ),
      ];

const Animation = Schema.Struct({
  kind: Schema.optional(Schema.String),
  props: Schema.optional(Schema.Array(Schema.String)),
  when: Schema.optional(Schema.String),
});
const Motion = Schema.Struct({
  animations: Schema.optional(Schema.Array(Animation)),
  page: Schema.optional(
    Schema.Struct({
      gsap: Schema.optional(Schema.Unknown),
      hover: Schema.optional(Schema.Array(Schema.Unknown)),
      libraries: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
    })
  ),
});

/** What a capture recorded of a page's motion, in a line. */
export const motionOf = (motion: typeof Motion.Type) => {
  const kinds = new Map<string, number>();
  for (const a of motion.animations ?? []) {
    const k = `${a.kind ?? "animation"} on ${a.when ?? "load"} (${(a.props ?? []).slice(0, 3).join(", ")})`;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  const libraries = Object.entries(motion.page?.libraries ?? {})
    .filter(([, on]) => on)
    .map(([name]) => name);
  if (Predicate.isNotNullish(motion.page?.gsap)) {
    libraries.push("gsap");
  }
  const parts = [...kinds]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => `${n}× ${k}`);
  return `${parts.length > 0 ? parts.join("; ") : "no animations recorded"}. Hover styles: ${motion.page?.hover?.length ?? 0}. Scroll and motion libraries: ${libraries.join(", ") || "none"}.`;
};

const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };
const strs = { items: str, type: "array" };
const obj = (properties: Record<string, unknown>) => ({
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
  type: "object",
});
const box = obj({ height: num, width: num, x: num, y: num });
const placed = { dimension: str, section: num };

/** The JSON Schema a note is asked in: `prompts/study-read.md`, field for field. */
export const noteSchema = obj({
  app: {
    anyOf: [
      { type: "null" },
      obj({
        dataDisplay: str,
        formLayout: str,
        primaryAction: str,
        rowHeight: num,
        rowsVisible: num,
        shell: str,
        staging: {
          enum: [
            "none",
            "backdrop",
            "device-frame",
            "cropped-window",
            "collage",
          ],
          type: "string",
        },
        states: str,
        tableStyle: str,
      }),
    ],
  },
  brief: obj({ audience: str, job: str, mustShow: str, product: str }),
  capture: { enum: ["ok", "obstructed", "broken"], type: "string" },
  captureFaults: strs,
  color: obj({
    accents: { items: obj({ hex: str, marks: str }), type: "array" },
    background: str,
    border: str,
    borderStrength: str,
    colorsFromImagery: bool,
    gradients: bool,
    mutedText: str,
    neutrals: str,
    neutralsToAccent: str,
    surface: str,
    text: str,
    theme: { enum: ["light", "dark", "mixed"], type: "string" },
  }),
  components: obj({
    brandMark: str,
    buttonHeight: num,
    buttonStyle: str,
    buttons: str,
    cards: str,
    inputs: str,
    nav: str,
  }),
  craft: { enum: [1, 2, 3], type: "number" },
  craftWhy: str,
  dials: obj({
    accent: str,
    density: str,
    imagery: str,
    shape: str,
    temperature: str,
    tone: str,
    typeVoice: str,
  }),
  domain: { enum: ["technical", "humanistic", "culture"], type: "string" },
  expression: {
    enum: ["restrained", "balanced", "expressive"],
    type: "string",
  },
  genre: str,
  hierarchy: obj({ first: str, focalDevice: str, second: str, third: str }),
  icons: obj({ size: num, style: str, use: str }),
  imagery: obj({ kinds: strs, role: str, subjects: strs, treatment: str }),
  layout: obj({
    alignment: str,
    columns: num,
    contentWidth: num,
    gutter: num,
    hero: str,
    structure: str,
  }),
  mobile: obj({ changes: str, mobileHeadline: num, mobileNav: str }),
  mood: strs,
  moodHow: str,
  motion: obj({ kinds: strs, level: str }),
  moves: {
    items: obj({
      box,
      name: str,
      picture: str,
      what: str,
      why: str,
      ...placed,
    }),
    type: "array",
  },
  observations: strs,
  pageKind: str,
  sections: {
    items: obj({
      alignment: str,
      box,
      form: str,
      ground: str,
      kind: str,
      note: str,
      picture: str,
    }),
    type: "array",
  },
  spacing: obj({ cardPadding: num, density: str, gap: num, sectionGap: num }),
  surfaces: obj({
    elevation: num,
    radius: obj({ large: num, small: num }),
    setApartBy: strs,
  }),
  tells: obj({
    borderAndShadow: bool,
    eyebrow: bool,
    glow: bool,
    gradientText: bool,
    iconTiles: bool,
    numberedSections: bool,
    sideStripe: bool,
    stockPhrases: bool,
  }),
  type: obj({
    accent: str,
    bodyFace: str,
    bodyLineHeight: num,
    faceNames: strs,
    headingCase: str,
    headingFace: str,
    measure: num,
    sizes: obj({ body: num, display: num, heading: num, small: num }),
    tracking: str,
    weights: strs,
  }),
  weaknesses: { items: obj({ what: str, ...placed }), type: "array" },
  words: obj({
    ctas: num,
    ctaVerbs: str,
    eyebrow: bool,
    headlineForm: str,
    headlineWords: num,
    voice: str,
  }),
});

/** A note as the model answers it: the schema above holds its shape. */
const noteAnswer = {
  decode: Schema.Record(Schema.String, Schema.Unknown),
  schema: noteSchema,
};

const studyDir = (root: string, model: string) =>
  path.join(root, `${model}-questions-${QUESTIONS}`);

/** A page's pictures as the model reads them, cut once and kept beside its notes. */
const picturesOf = Effect.fn("picturesOf")(function* (page: Page, at: string) {
  const fs = yield* FileSystem.FileSystem;
  const browser = yield* Browser;
  const done = (yield* listDir(at)).filter((f) => f.endsWith(".jpg"));
  if (done.length > 0) {
    // As they were cut: the desktop parts, then the phone's screen.
    return [
      ...done.filter((f) => f.startsWith("page-")),
      ...done.filter((f) => !f.startsWith("page-")),
    ].map((f) => path.join(at, f));
  }
  yield* fs.makeDirectory(at, { recursive: true });
  const tiles = yield* browser.cut(
    yield* fs.readFile(page.desktop),
    { height: 900, name: "desktop", width: page.width },
    true
  );
  const kept: string[] = [];
  for (const [i, t] of spreadTiles(tiles.length).entries()) {
    const tile = tiles[t];
    if (tile !== undefined) {
      const file = path.join(at, `page-${i + 1}.jpg`);
      yield* fs.writeFile(file, tile);
      kept.push(file);
    }
  }
  if (page.mobile !== undefined) {
    const [first] = yield* browser.cut(
      yield* fs.readFile(page.mobile),
      { height: 1688, name: "mobile", width: 780 },
      false
    );
    if (first !== undefined) {
      const file = path.join(at, "mobile-1.jpg");
      yield* fs.writeFile(file, first);
      kept.push(file);
    }
  }
  return kept;
});

/** Each page of the sources not yet read with these questions, one call each. */
export const studyRead = Effect.fn("studyRead")(function* (options: {
  readonly concurrency: number;
  readonly effort: string;
  /** At most this many pages this time; the next run reads on from there. */
  readonly limit: number | undefined;
  readonly model: string;
  /** At most this many public pages, spread over the sources; every app screen. */
  readonly sample: number | undefined;
  readonly sources: readonly string[];
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const dir = studyDir(data.studies, options.model);
  const notes = path.join(dir, "notes");
  yield* fs.makeDirectory(notes, { recursive: true });
  const all = yield* pagesOf(options.sources);
  const chosen = [
    ...spread(
      all.filter((p) => p.kind === "public-page"),
      options.sample
    ),
    ...all.filter((p) => p.kind === "app-screen"),
  ];
  const pending: Page[] = [];
  for (const page of chosen) {
    if (pending.length >= (options.limit ?? Number.POSITIVE_INFINITY)) {
      break;
    }
    if (!(yield* fs.exists(path.join(notes, `${page.id}.json`)))) {
      pending.push(page);
    }
  }
  yield* Effect.log(
    `${pending.length} of ${chosen.length} pages to read (${all.length} in the sources)`
  );
  let cost = 0;
  let done = 0;
  const runsIn = models.runsIn(options.model);
  yield* Effect.forEach(
    pending,
    (page) =>
      Effect.gen(function* () {
        const pictures = yield* picturesOf(
          page,
          path.join(dir, "pictures", page.id)
        );
        const motion =
          page.motion === undefined
            ? "not recorded"
            : yield* readJson(Motion, page.motion).pipe(
                Effect.map(motionOf),
                Effect.orElseSucceed(() => "not recorded")
              );
        const listing = pictures
          .map((file) => {
            const name = path.basename(file);
            return name.startsWith("mobile")
              ? `- \`${data.fromData(file)}\`: the phone's first screen`
              : `- \`${data.fromData(file)}\`: the desktop ${page.kind === "app-screen" ? "screen" : "page"}, ${name.replace(".jpg", "").replace("page-", "part ")} of ${pictures.filter((f) => path.basename(f).startsWith("page")).length}`;
          })
          .join("\n");
        const answer = yield* models.ask({
          cwd: data.root,
          ...(runsIn !== "claude" && { effort: options.effort }),
          images: pictures.map((f) => data.fromData(f)),
          model: options.model,
          prompt: yield* prompt("study-read", {
            kind: page.kind === "app-screen" ? "app screen" : "public web page",
            motion,
            pictureNote: `${page.scale} Long pages are shown in up to four parts spread down the page: the gaps between them are skipped on purpose, never a capture fault.`,
            pictures: listing,
          }),
          ...noteAnswer,
        });
        cost += answer.costUsd;
        done += 1;
        yield* writeJson(path.join(notes, `${page.id}.json`), {
          id: page.id,
          kind: page.kind,
          model: options.model,
          pictures: pictures.map((f) => data.fromData(f)),
          questions: QUESTIONS,
          source: page.source,
          ...answer.value,
        });
        yield* Effect.log(
          `${page.id} read (${done} of ${pending.length}, $${cost.toFixed(2)} so far)`
        );
      }).pipe(
        // A page that could not be read is left for the next run.
        Effect.catch((error) =>
          Effect.logError(`${page.id}: not read: ${String(error)}`)
        )
      ),
    { concurrency: options.concurrency }
  );
});
