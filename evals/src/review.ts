/**
 * `review`: a person's eye on what rounds made, one card at a time in the browser, swiped left or
 * right with a comment when there is something to say. The judge is a model; what a person likes
 * is the measure it stands in for. Seven kinds of card:
 *
 * - `component`: a component of a design system made from pictures (track A), as each run drew
 *   it, beside the product's own. Which is closest?
 * - `layout`: two designs (or one) blurred and grey, so only their arrangement shows.
 * - `section`: one part of the screen (the sidebar, the key figures, the table) in two designs,
 *   beside the same part of the reference: one thing to look at, a quick answer.
 * - `screen`: a design beside its reference, rated from 1 (bad) to 5 (as good as the reference).
 * - `pair`: the same reference designed in two rounds (two hosts, two sets of skills), sides
 *   hidden and shuffled. Which is better?
 * - `finding`: what the judge found wrong. A real problem or not? The judge is checked by it.
 * - `text`: a text the agent wrote that the brief did not have, in its place. Needed or noise?
 *
 * Verdicts go in `runs/<round>/review.json` as they are given, so a review can stop and go on;
 * `report` reads them: they overrule the judge, and the comments go to the synthesis.
 *
 * The page is `evals/viewers/review.html`; the pictures a card shows are files of the data
 * directory, served at their path from it.
 */
import { createServer } from "node:http";
import path from "node:path";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Schema, Semaphore } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { ADDED_TEXT_FILE, AddedTextEntry } from "./added-text.ts";
import { foldName } from "./capture.ts";
import { type DataDir, EvalsConfig } from "./config.ts";
import { RoundInfo } from "./generate.ts";
import { type Judgement, readJudgement, roundRuns } from "./judge.ts";
import {
  listDir,
  readJson,
  viewerPage,
  viewerSrc,
  writeJson,
} from "./layout.ts";
import {
  challengeCards,
  componentCards,
  isExtractRound,
  sectionPickCards,
} from "./picks.ts";
import { readReferenceSections, readRunSections, slugOf } from "./sections.ts";

export const KINDS = [
  "component",
  "layout",
  "section",
  "screen",
  "pair",
  "finding",
  "text",
] as const;
export type Kind = (typeof KINDS)[number];
/**
 * `left` is no (not a problem, noise) or the left design; `right` is yes; `rated` is a score
 * given on a scale, for a card that asks how good a design is.
 */
export const CHOICES = ["left", "right", "skip", "rated", "picked"] as const;
/** What each point of a rating means, 1 to 5: the judge's scale, in a word each. */
export const SCALE = ["Bad", "Weak", "OK", "Good", "Great"] as const;
export const REVIEW_FILE = "review.json";
/** The pick of a card where none of the options was good. */
export const NONE = "none";

export const Verdict = Schema.Struct({
  at: Schema.String,
  choice: Schema.Literals(CHOICES),
  comment: Schema.optional(Schema.String),
  kind: Schema.Literals(KINDS),
  /** The option picked as the best of several, or `none` when none was good. */
  pick: Schema.optional(Schema.String),
  reference: Schema.String,
  run: Schema.String,
  /** 1 to 5, for a card rated on a scale. */
  score: Schema.optional(Schema.Number),
  /** For a pair, the round each side showed: `left` won when the choice is `left`. */
  sides: Schema.optional(Schema.Array(Schema.String)),
  /** The finding's number or the text's index; empty for a screen or a pair. */
  subject: Schema.String,
});
export type Verdict = typeof Verdict.Type;

/**
 * A screen's score, 1 to 5: as rated, or, for a verdict given when screens were a yes or a no,
 * 4 for a yes and 2 for a no.
 */
export const scoreOf = (v: Verdict) => {
  if (v.score !== undefined) {
    return v.score;
  }
  if (v.choice === "right") {
    return 4;
  }
  return v.choice === "left" ? 2 : undefined;
};
export const Review = Schema.Record(Schema.String, Verdict);
export type Review = typeof Review.Type;

const VerdictInput = Schema.Struct({
  choice: Schema.Literals(CHOICES),
  comment: Schema.optional(Schema.String),
  id: Schema.String,
  pick: Schema.optional(Schema.String),
  score: Schema.optional(Schema.Number),
});

interface Picture {
  readonly label: string;
  /** A box to mark on the picture, in fractions of it: where a text is on the page. */
  readonly mark?: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  };
  readonly src: string;
}

export interface Card {
  readonly id: string;
  readonly kind: Kind;
  /** What to answer, and what each side means. */
  readonly left: string;
  /** How the viewer shows its pictures: blurred and grey for a layout, fitted for a section. */
  readonly lens?: "layout" | "section";
  /** Lines under the pictures: the judge's claim, for a finding or a text. */
  readonly lines: readonly string[];
  /**
   * For a card that asks which of several is best: each option, labelled A, B, C… in a shuffled
   * order, its id kept for the verdict.
   */
  readonly options?: readonly {
    readonly id: string;
    readonly label: string;
    readonly pictures: readonly Picture[];
  }[];
  /** The design; for a pair, the left one. */
  readonly pictures: readonly Picture[];
  readonly question: string;
  /** A text, shown large, for a text card. */
  readonly quote?: string;
  readonly reference: string;
  readonly referencePictures: readonly Picture[];
  readonly right: string;
  /** The right design of a pair. */
  readonly rightPictures?: readonly Picture[];
  /** The round its verdict is kept in. */
  readonly round: string;
  readonly run: string;
  /** For a card answered on a scale rather than yes or no: what each point means. */
  readonly scale?: readonly string[];
  readonly sides?: readonly string[];
  readonly subject: string;
  readonly title: string;
}

const DESKTOP_TILE = /^desktop-\d+\.jpg$/;
/**
 * Data rather than words, for judgements made before the judge said which: a digit (a number,
 * a date, an amount), an email or a handle, or two capitalised words alone (a person's name).
 */
const LOOKS_LIKE_DATA = /\d|@|^[A-Z][a-z]+ [A-Z][a-z]+$/;

/** A run's design: the whole page in tiles, or its first window when it has no tiles. */
const designPictures = Effect.fn("designPictures")(function* (dir: string) {
  const { data } = yield* EvalsConfig;
  const shots = path.join(dir, "shots");
  const files = (yield* listDir(shots)).filter((f) => f.startsWith("desktop"));
  const tiles = files.filter((f) => !f.includes("fold"));
  return (tiles.length > 0 ? tiles : files).map((f, index) => ({
    label: tiles.length > 0 ? `page ${index + 1}` : "first window",
    src: viewerSrc(data, path.join(shots, f)),
  }));
});

const referencePicturesOf = Effect.fn("referencePicturesOf")(function* (
  reference: string
) {
  const { data } = yield* EvalsConfig;
  const dir = data.captureDir(reference);
  const files = yield* listDir(dir);
  const tiles = files.filter((f) => DESKTOP_TILE.test(f));
  const chosen = tiles.length > 0 ? tiles : [foldName("desktop")];
  return chosen
    .filter((f) => files.includes(f))
    .map((f) => ({
      label: "reference",
      src: viewerSrc(data, path.join(dir, f)),
    }));
});

/**
 * Where a text is: the whole page with the text's place marked, when it was found on it; its
 * node's own picture otherwise.
 */
const textPictures = (
  data: DataDir,
  r: RoundRun,
  a: AddedTextEntry
): readonly Picture[] => {
  if (a.mark) {
    const marked = viewerSrc(data, path.join(r.dir, a.mark.picture));
    return r.pictures.map((p) =>
      p.src === marked ? { ...p, label: "in the screen", mark: a.mark?.box } : p
    );
  }
  return a.picture
    ? [
        {
          label: "in its place",
          src: viewerSrc(data, path.join(r.dir, a.picture)),
        },
      ]
    : r.pictures;
};

/** A stable coin for a card: which side of a pair its first round goes. */
const flip = (id: string) =>
  [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7) % 2 === 1;

interface RoundRun {
  readonly added: readonly AddedTextEntry[];
  readonly dir: string;
  readonly judgement: Judgement | undefined;
  readonly pictures: readonly Picture[];
  readonly reference: string;
  readonly round: string;
  readonly run: string;
  /** Its sections' crops, by the reference's section names. */
  readonly sections: ReadonlyMap<string, string>;
}

const loadRound = Effect.fn("loadRound")(function* (round: string) {
  const fs = yield* FileSystem.FileSystem;
  const runs: RoundRun[] = [];
  for (const run of yield* roundRuns(round)) {
    const judgement = yield* readJudgement(run.dir).pipe(Effect.option);
    const addedFile = path.join(run.dir, ADDED_TEXT_FILE);
    const added = (yield* fs.exists(addedFile))
      ? yield* readJson(Schema.Array(AddedTextEntry), addedFile)
      : [];
    runs.push({
      added,
      dir: run.dir,
      judgement: judgement._tag === "Some" ? judgement.value : undefined,
      pictures: yield* designPictures(run.dir),
      reference: run.reference,
      round,
      run: path.basename(run.dir),
      sections: yield* readRunSections(run.dir),
    });
  }
  return runs;
});

interface LensContext {
  readonly base: (r: RoundRun) => {
    readonly reference: string;
    readonly referencePictures: readonly Picture[];
    readonly round: string;
    readonly run: string;
  };
  readonly data: DataDir;
  readonly hosts: ReadonlyMap<string, string>;
  readonly referenceSections: ReadonlyMap<
    string,
    readonly { readonly crop: string; readonly name: string }[]
  >;
}

/**
 * The narrow cards of one design, or of two side by side when `other` is given: its layout alone,
 * and each section the reference has that the designs have too.
 */
const lensCardsOf = (
  { base, data, hosts, referenceSections }: LensContext,
  one: RoundRun,
  other: RoundRun | undefined,
  idOf: (what: string) => string
): { readonly layout: Card; readonly sections: readonly Card[] } => {
  const sided = (id: string) =>
    other && flip(id) ? ([other, one] as const) : ([one, other] as const);
  const choices = other
    ? { left: "Left is better", right: "Right is better" }
    : { left: "No", right: "Yes" };
  const title = other
    ? one.reference
    : `${one.reference} · ${hosts.get(one.round) ?? one.round}`;
  const layoutId = idOf("layout");
  const [x, y] = sided(layoutId);
  const layout: Card = {
    ...base(one),
    ...choices,
    id: layoutId,
    kind: "layout",
    lens: "layout",
    lines: [
      "Blurred on purpose: only the arrangement, the size and the weight of the blocks. Press and hold (or Space) to see it sharp.",
    ],
    pictures: x.pictures,
    question: other
      ? "Layout only: which is better?"
      : "Layout only: how good is it?",
    ...(!other && { scale: SCALE }),
    ...(y && { rightPictures: y.pictures, sides: [x.round, y.round] }),
    subject: "",
    title,
  };
  const sections = (referenceSections.get(one.reference) ?? []).flatMap(
    (section): Card[] => {
      if (
        !one.sections.has(section.name) ||
        (other && !other.sections.has(section.name))
      ) {
        return [];
      }
      const id = idOf(`section/${slugOf(section.name)}`);
      const [p, q] = sided(id);
      const crop = (r: RoundRun) => [
        {
          label: section.name,
          src: viewerSrc(data, r.sections.get(section.name) ?? ""),
        },
      ];
      return [
        {
          ...base(one),
          ...choices,
          id,
          kind: "section",
          lens: "section",
          lines: [],
          pictures: crop(p),
          question: other
            ? `${section.name}: which is better?`
            : `${section.name}: how good is it?`,
          ...(!other && { scale: SCALE }),
          referencePictures: [
            { label: section.name, src: viewerSrc(data, section.crop) },
          ],
          ...(q && { rightPictures: crop(q), sides: [p.round, q.round] }),
          subject: section.name,
          title,
        },
      ];
    }
  );
  return { layout, sections };
};

/** Each round as a card names it: with the host it was designed in. */
const hostsOf = Effect.fn("hostsOf")(function* (rounds: readonly string[]) {
  const { data } = yield* EvalsConfig;
  const hosts = new Map<string, string>();
  for (const round of rounds) {
    const info = yield* readJson(
      RoundInfo,
      path.join(data.runs, round, "round.json")
    ).pipe(Effect.option);
    hosts.set(
      round,
      info._tag === "Some" ? `${round} (${info.value.host ?? "?"})` : round
    );
  }
  return hosts;
});

/** Each reference's sections and their crops, by reference. */
const sectionsOf = Effect.fn("sectionsOf")(function* (
  references: readonly string[]
) {
  const found = new Map<
    string,
    readonly { readonly crop: string; readonly name: string }[]
  >();
  for (const reference of references) {
    const marked = yield* readReferenceSections(reference);
    found.set(
      reference,
      marked.map((m) => ({ crop: m.crop, name: m.section.name }))
    );
  }
  return found;
});

/** Each reference's latest round among the rounds, by their order. */
const latestRounds = (
  rounds: readonly string[],
  runs: readonly { readonly reference: string; readonly round: string }[]
) => {
  const latest = new Map<string, string>();
  for (const r of runs) {
    const was = latest.get(r.reference);
    if (was === undefined || rounds.indexOf(r.round) > rounds.indexOf(was)) {
      latest.set(r.reference, r.round);
    }
  }
  return latest;
};

/**
 * Every card of the rounds: sections, the judge's findings, the words agents added, then layouts
 * and whole designs.
 */
export const buildCards = Effect.fn("buildCards")(function* (
  all: readonly string[]
) {
  const { data } = yield* EvalsConfig;
  // Track A's rounds have their own cards: components, best of several.
  const extracted = yield* Effect.filter(all, isExtractRound);
  // Two extraction rounds or more: the last one's components against the ones picked before.
  const lastExtract = extracted.at(-1);
  const beforeExtract = extracted.at(-2);
  const components =
    lastExtract !== undefined && beforeExtract !== undefined
      ? yield* componentCards(lastExtract, SCALE, {
          round: beforeExtract,
          verdicts: yield* readReview(beforeExtract),
        })
      : (yield* Effect.forEach(extracted, (round) =>
          componentCards(round, SCALE)
        )).flat();
  const rounds = all.filter((r) => !extracted.includes(r));
  const loaded = (yield* Effect.forEach(rounds, loadRound)).flat();
  const hosts = yield* hostsOf(rounds);
  const references = [...new Set(loaded.map((r) => r.reference))];
  const referencePictures = new Map<string, readonly Picture[]>();
  for (const reference of references) {
    referencePictures.set(reference, yield* referencePicturesOf(reference));
  }
  const pictured = loaded.filter((r) => r.pictures.length > 0);
  const base = (r: RoundRun) => ({
    reference: r.reference,
    referencePictures: referencePictures.get(r.reference) ?? [],
    round: r.round,
    run: r.run,
  });

  const referenceSections = yield* sectionsOf(references);

  const layouts: Card[] = [];
  const parts: Card[] = [];
  const pairs: Card[] = [];
  const context: LensContext = { base, data, hosts, referenceSections };
  const lensCards = (
    one: RoundRun,
    other: RoundRun | undefined,
    idOf: (what: string) => string
  ) => {
    const made = lensCardsOf(context, one, other, idOf);
    layouts.push(made.layout);
    parts.push(...made.sections);
  };
  // One round of several runs a reference: its sections, best of the runs; whole screens are
  // too much to judge at once.
  const severalRuns = rounds.length === 1 && hasSeveralRuns(pictured);
  if (rounds.length === 1 && !severalRuns) {
    for (const r of pictured) {
      lensCards(
        r,
        undefined,
        (what) => `${what}/${r.round}/${r.reference}/${r.run}`
      );
    }
  }
  // Two rounds or more: each reference's latest round is a candidate, its sections set against
  // the ones picked for that reference in the rounds before it.
  const reviews = yield* Effect.forEach(rounds, (round) =>
    Effect.map(readReview(round), (verdicts) => ({ round, verdicts }))
  );
  const order = (round: string) => rounds.indexOf(round);
  const latest = latestRounds(rounds, pictured);
  const sectionRun = (r: RoundRun) => ({ ...base(r), sections: r.sections });
  const challenge =
    rounds.length >= 2
      ? [...new Set(latest.values())].flatMap((candidate) => {
          const at = order(candidate);
          const own = new Set(
            [...latest]
              .filter(([, round]) => round === candidate)
              .map(([ref]) => ref)
          );
          const of = (r: RoundRun) => own.has(r.reference);
          return at === 0
            ? []
            : challengeCards(
                data,
                pictured
                  .filter((r) => of(r) && r.round === candidate)
                  .map(sectionRun),
                pictured
                  .filter((r) => of(r) && order(r.round) < at)
                  .map(sectionRun),
                reviews.slice(0, at),
                referenceSections
              );
        })
      : [];
  const picks = severalRuns
    ? sectionPickCards(
        data,
        pictured.map((r) => ({ ...base(r), sections: r.sections })),
        referenceSections
      )
    : challenge;

  for (const { a, b, left, right } of challenge.length > 0
    ? []
    : matchedRuns(rounds, pictured)) {
    lensCards(
      left,
      right,
      (what) => `${what}/${left.reference}/${left.run}/${a}/${b}`
    );
    const id = `pair/${left.reference}/${left.run}/${a}/${b}`;
    const [x, y] = flip(id) ? [right, left] : [left, right];
    pairs.push({
      ...base(left),
      id,
      kind: "pair",
      left: "Left is better",
      lines: [],
      pictures: x.pictures,
      question: "Which design is better?",
      right: "Right is better",
      rightPictures: y.pictures,
      sides: [x.round, y.round],
      subject: "",
      title: left.reference,
    });
  }

  const screens: Card[] = pictured.map((r) => ({
    ...base(r),
    id: `screen/${r.round}/${r.reference}/${r.run}`,
    kind: "screen",
    left: "No",
    lines: [],
    pictures: r.pictures,
    question: "How good is this design?",
    right: "Yes",
    scale: SCALE,
    subject: "",
    title: `${r.reference} · ${r.run} · ${hosts.get(r.round) ?? r.round}`,
  }));

  const findings: Card[] = pictured.flatMap((r) =>
    (r.judgement?.findings ?? []).flatMap((f, index) =>
      f.impact === "low"
        ? []
        : [
            {
              ...base(r),
              id: `finding/${r.round}/${r.reference}/${r.run}/${index + 1}`,
              kind: "finding" as const,
              left: "Not a problem",
              lines: [
                `${f.level ?? "–"} · ${f.skill} · ${f.coverage} · ${f.impact}`,
                `Design: ${f.generated}`,
                `Reference: ${f.reference}`,
              ],
              pictures: r.pictures,
              question: "Is this a real problem?",
              quote: f.title,
              right: "Real problem",
              subject: String(index + 1),
              title: `${r.reference} · ${r.run} · ${hosts.get(r.round) ?? r.round}`,
            },
          ]
    )
  );

  const verdictOf = (r: RoundRun, index: number) =>
    r.judgement?.addedText?.find((a) => a.index === index);
  // Only the interface's own words are asked about: whether a prototype needs its made-up data
  // (names, emails, numbers, rows) is not a question of less is more.
  const isCopy = (r: RoundRun, a: AddedTextEntry) => {
    const judged = verdictOf(r, a.index);
    if (judged?.role) {
      return judged.role === "copy";
    }
    return judged?.verdict !== "invented" && !LOOKS_LIKE_DATA.test(a.text);
  };
  const texts: Card[] = pictured
    .flatMap((r) =>
      r.added
        .filter((a) => isCopy(r, a))
        .map((a) => ({ a, r, verdict: verdictOf(r, a.index) }))
    )
    // What the judge called noise first: those a person confirms or overrules first.
    .sort(
      (x, y) =>
        Number(x.verdict?.verdict === "needed") -
        Number(y.verdict?.verdict === "needed")
    )
    .map(({ a, r, verdict }) => ({
      ...base(r),
      id: `text/${r.round}/${r.reference}/${r.run}/${a.index}`,
      kind: "text" as const,
      left: "Noise, remove it",
      lines: verdict ? [`The judge: ${verdict.verdict}, ${verdict.why}`] : [],
      pictures: textPictures(data, r, a),
      question: "Does the screen need this text?",
      quote: a.text,
      right: "Needed",
      subject: String(a.index),
      title: `${r.reference} · ${r.run} · ${hosts.get(r.round) ?? r.round}`,
    }));

  // Sections first: one part at a time is where a person decides fastest and best; the judge's
  // findings next, then the words agents added; whole screens last.
  return [
    ...components,
    ...picks,
    ...parts,
    ...findings,
    ...texts,
    ...(severalRuns || challenge.length > 0
      ? []
      : [...layouts, ...pairs, ...screens]),
  ];
});

/** The verdicts of a round, none when it has not been reviewed. */
export const readReview = Effect.fn("readReview")(function* (round: string) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(data.runs, round, REVIEW_FILE);
  return (yield* fs.exists(file)) ? yield* readJson(Review, file) : {};
});

/**
 * Whether an answer fits its card: a card on a scale is rated 1 to 5, one of several options is
 * picked (or none), any other is answered left or right; every card can be skipped.
 */
const fitting = (card: Card, input: typeof VerdictInput.Type) => {
  const rated =
    input.choice === "rated" &&
    input.score !== undefined &&
    Number.isInteger(input.score) &&
    input.score >= 1 &&
    input.score <= SCALE.length;
  const picked =
    input.choice === "picked" &&
    (input.pick === NONE ||
      (card.options ?? []).some((o) => o.id === input.pick));
  if (input.choice === "skip") {
    return { fits: true, picked, rated };
  }
  if (card.scale) {
    return { fits: rated, picked, rated };
  }
  if (card.options) {
    return { fits: picked, picked, rated };
  }
  return {
    fits: input.choice === "left" || input.choice === "right",
    picked,
    rated,
  };
};

/** The same run of the same reference in two rounds, for every two rounds. */
const matchedRuns = (rounds: readonly string[], runs: readonly RoundRun[]) =>
  rounds.flatMap((a, i) =>
    rounds.slice(i + 1).flatMap((b) =>
      runs
        .filter((r) => r.round === a)
        .flatMap((left) => {
          const right = runs.find(
            (r) =>
              r.round === b &&
              r.reference === left.reference &&
              r.run === left.run
          );
          return right ? [{ a, b, left, right }] : [];
        })
    )
  );

/** Whether a round has a reference designed more than once, to be picked from. */
const hasSeveralRuns = (runs: readonly { readonly reference: string }[]) =>
  runs.some((r) => runs.filter((o) => o.reference === r.reference).length > 1);

export const review = Effect.fn("review")(function* (
  rounds: readonly string[],
  options: { readonly host: string; readonly port: number }
) {
  const { data } = yield* EvalsConfig;
  const cards = yield* buildCards(rounds);
  if (cards.length === 0) {
    return yield* Effect.logWarning(
      `nothing to review in ${rounds.join(", ")}`
    );
  }
  const byId = new Map(cards.map((c) => [c.id, c]));
  const lock = yield* Semaphore.make(1);
  const page = yield* viewerPage("review");

  const session = Effect.gen(function* () {
    const verdicts: Record<string, Verdict> = {};
    for (const round of rounds) {
      Object.assign(verdicts, yield* readReview(round));
    }
    return HttpServerResponse.jsonUnsafe({ cards, rounds, verdicts });
  });

  const save = Effect.gen(function* () {
    const input = yield* HttpServerRequest.schemaBodyJson(VerdictInput);
    const card = byId.get(input.id);
    if (!card) {
      return HttpServerResponse.jsonUnsafe(
        { message: `no card ${input.id}` },
        { status: 404 }
      );
    }
    const { fits, picked, rated } = fitting(card, input);
    if (!fits) {
      return HttpServerResponse.jsonUnsafe(
        {
          message: card.scale
            ? "this card is rated from 1 to 5"
            : "this card is answered left, right, or by picking one",
        },
        { status: 400 }
      );
    }
    const verdict: Verdict = {
      at: new Date().toISOString(),
      choice: input.choice,
      ...(rated && { score: input.score }),
      ...(picked && { pick: input.pick }),
      ...(input.comment?.trim() && { comment: input.comment.trim() }),
      kind: card.kind,
      reference: card.reference,
      run: card.run,
      ...(card.sides && { sides: card.sides }),
      subject: card.subject,
    };
    // One write at a time: two quick swipes would otherwise each read the file before the other
    // wrote it, and one verdict would be lost.
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* readReview(card.round);
        yield* writeJson(path.join(data.runs, card.round, REVIEW_FILE), {
          ...current,
          [card.id]: verdict,
        });
      })
    );
    return HttpServerResponse.jsonUnsafe({ ok: true });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { message: String(error) },
          { status: 400 }
        )
      )
    )
  );

  const routes = Layer.mergeAll(
    HttpRouter.add("GET", "/api/session", session),
    HttpRouter.add("POST", "/api/verdict", save),
    HttpRouter.add("GET", "/", Effect.succeed(HttpServerResponse.html(page))),
    HttpStaticServer.layer({ root: data.root })
  );
  yield* Effect.log(
    `${cards.length} cards: open http://${options.host}:${options.port}/ (Ctrl-C to stop; verdicts are saved as you go)`
  );
  return yield* Layer.launch(
    HttpRouter.serve(routes, { disableLogger: true }).pipe(
      Layer.provide(
        NodeHttpServer.layer(createServer, {
          host: options.host,
          port: options.port,
        })
      )
    )
  );
});
