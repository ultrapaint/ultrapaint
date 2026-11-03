/**
 * The best of several: cards that show the same thing from every run of a round (a component
 * of an extracted design system, or a section of a composed screen) beside the reference's,
 * and ask which is best. The options are labelled A, B, C… in an order shuffled per card, so a
 * run's place says nothing; the verdict keeps the run that was picked.
 */
import path from "node:path";
import { Effect, FileSystem } from "effect";
import { type DataDir, EvalsConfig } from "./config.ts";
import { COMPONENTS, COMPONENTS_DIR } from "./extract.ts";
import { listDir, viewerSrc } from "./layout.ts";
import type { Card } from "./review.ts";
import { slugOf } from "./sections.ts";

const LETTERS = "ABCDEFGH";

/** A stable shuffle of a card's options, by its id. */
const shuffled = <A>(id: string, items: readonly A[]) =>
  items
    .map((item, index) => ({
      item,
      key: [...`${id}#${index}`].reduce(
        (h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003,
        7
      ),
    }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);

const lettered = (
  id: string,
  options: readonly { readonly id: string; readonly src: string }[]
) =>
  shuffled(id, options).map((o, index) => ({
    id: o.id,
    label: LETTERS[index] ?? String(index + 1),
    pictures: [{ label: LETTERS[index] ?? "", src: o.src }],
  }));

/** Whether a round is track A's: a design system extracted per family. */
export const isExtractRound = Effect.fn("isExtractRound")(function* (
  round: string
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(data.runs, round, "round.json");
  return (
    (yield* fs.exists(file)) &&
    (yield* fs.readFileString(file)).includes('"track": "extract"')
  );
});

/**
 * Track A's cards: each component of each family, from every run beside the product's own; with
 * one run only, it is rated against the product's rather than picked.
 */
/** The run picked before for a component, or all of that round's when none was good enough. */
const pickedBefore = Effect.fn("pickedBefore")(function* (
  before: Before,
  family: string,
  slug: string
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const pick =
    before.verdicts[`component/${before.round}/${family}/${slug}`]?.pick;
  const runs =
    pick === undefined || pick === NONE_PICKED
      ? (yield* listDir(path.join(data.runs, before.round, family))).filter(
          (r) => r.startsWith("run-")
        )
      : [pick];
  const found: { id: string; src: string }[] = [];
  for (const run of runs) {
    const crop = path.join(
      data.runs,
      before.round,
      family,
      run,
      COMPONENTS_DIR,
      `${slug}.png`
    );
    if (yield* fs.exists(crop)) {
      found.push({ id: `${before.round}/${run}`, src: viewerSrc(data, crop) });
    }
  }
  return found;
});

/** One component's card: the crops of every run that drew it, beside the product's. */
const componentCard = Effect.fn("componentCard")(function* (
  where: {
    readonly family: string;
    readonly round: string;
    readonly runs: readonly string[];
  },
  component: (typeof COMPONENTS)[number],
  scale: readonly string[],
  /** An earlier round, whose pick for this component the round's runs are set against. */
  before?: Before
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const { family, round, runs } = where;
  const slug = slugOf(component.name);
  const crop = (r: string, run: string) =>
    path.join(data.runs, r, family, run, COMPONENTS_DIR, `${slug}.png`);
  const options: { id: string; src: string }[] = [];
  for (const run of runs) {
    if (yield* fs.exists(crop(round, run))) {
      options.push({
        id: before ? `${round}/${run}` : run,
        src: viewerSrc(data, crop(round, run)),
      });
    }
  }
  if (before && options.length > 0) {
    options.push(...(yield* pickedBefore(before, family, slug)));
  }
  const [first] = options;
  if (!first) {
    return;
  }
  const reference = path.join(
    data.familyDir(family),
    COMPONENTS_DIR,
    `${slug}.jpg`
  );
  const shown = yield* fs.exists(reference);
  const id = `component/${round}/${family}/${slug}`;
  const one = options.length === 1;
  const card: Card = {
    id,
    kind: "component",
    left: "No",
    lens: "section",
    lines: shown
      ? []
      : [
          "The product's screens do not show this one: judge it by the rest of the system.",
        ],
    pictures: one ? [{ label: component.name, src: first.src }] : [],
    question: one
      ? `${component.name}: how close is it to the product's?`
      : `${component.name}: which is closest to the product's?`,
    reference: family,
    referencePictures: shown
      ? [{ label: component.name, src: viewerSrc(data, reference) }]
      : [],
    right: "Yes",
    round,
    run: one ? first.id : "",
    subject: component.name,
    title: `${family} · ${component.states}`,
    ...(one ? { scale } : { options: lettered(id, options) }),
  };
  return card;
});

/** An earlier round and its verdicts. */
export interface Before {
  readonly round: string;
  readonly verdicts: Readonly<
    Record<string, { readonly pick?: string | undefined }>
  >;
}

export const componentCards = Effect.fn("componentCards")(function* (
  round: string,
  scale: readonly string[],
  before?: Before
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const cards: Card[] = [];
  for (const family of yield* listDir(path.join(data.runs, round))) {
    // Beside the families' directories: round.json.
    const info = yield* fs.stat(path.join(data.runs, round, family));
    if (info.type !== "Directory") {
      continue;
    }
    const runs = (yield* listDir(path.join(data.runs, round, family))).filter(
      (r) => r.startsWith("run-")
    );
    for (const component of runs.length > 0 ? COMPONENTS : []) {
      const card = yield* componentCard(
        { family, round, runs },
        component,
        scale,
        before
      );
      if (card) {
        cards.push(card);
      }
    }
  }
  return cards;
});

/** A run of a composition round, as the section cards need it. */
export interface SectionRun {
  readonly reference: string;
  readonly referencePictures: readonly {
    readonly label: string;
    readonly src: string;
  }[];
  readonly round: string;
  readonly run: string;
  readonly sections: ReadonlyMap<string, string>;
}

/** Track B's cards: each section of each reference, from every run of the round. */
export const sectionPickCards = (
  data: DataDir,
  runs: readonly SectionRun[],
  referenceSections: ReadonlyMap<
    string,
    readonly { readonly crop: string; readonly name: string }[]
  >
): Card[] =>
  [...new Set(runs.map((r) => r.reference))].flatMap((reference) => {
    const ofReference = runs.filter((r) => r.reference === reference);
    const round = ofReference[0]?.round ?? "";
    return (referenceSections.get(reference) ?? []).flatMap(
      (section): Card[] => {
        const options = ofReference.flatMap((r) => {
          const crop = r.sections.get(section.name);
          return crop ? [{ id: r.run, src: viewerSrc(data, crop) }] : [];
        });
        if (options.length < 2) {
          return [];
        }
        const id = `section/${round}/${reference}/${slugOf(section.name)}`;
        return [
          {
            id,
            kind: "section",
            left: "No",
            lens: "section",
            lines: [],
            options: lettered(id, options),
            pictures: [],
            question: `${section.name}: which is best?`,
            reference,
            referencePictures: [
              { label: section.name, src: viewerSrc(data, section.crop) },
            ],
            right: "Yes",
            round,
            run: "",
            subject: section.name,
            title: reference,
          },
        ];
      }
    );
  });

/**
 * A candidate round against the rounds before it: each section of each reference, the candidate's
 * runs beside the one the person last picked for that section (all of the latest earlier round's
 * runs when they picked none), blind. Whether the candidate beats what was liked best is the
 * question. A pick names its run (`run-2`) or, made on such a card itself, its round too.
 */
export const challengeCards = (
  data: DataDir,
  candidate: readonly SectionRun[],
  before: readonly SectionRun[],
  /** The earlier rounds, oldest first, each with its verdicts. */
  reviews: readonly {
    readonly round: string;
    readonly verdicts: Readonly<
      Record<string, { readonly pick?: string | undefined }>
    >;
  }[],
  referenceSections: ReadonlyMap<
    string,
    readonly { readonly crop: string; readonly name: string }[]
  >
): Card[] =>
  [...new Set(candidate.map((r) => r.reference))].flatMap((reference) => {
    const ofReference = candidate.filter((r) => r.reference === reference);
    const round = ofReference[0]?.round ?? "";
    const earlier = before.filter((r) => r.reference === reference);
    return (referenceSections.get(reference) ?? []).flatMap(
      (section): Card[] => {
        const slug = slugOf(section.name);
        const last = [...reviews]
          .reverse()
          .map((review) => ({
            pick: review.verdicts[
              `section/${review.round}/${reference}/${slug}`
            ]?.pick,
            round: review.round,
          }))
          .find((v) => v.pick !== undefined);
        const liked = likedOf(last);
        const latest = reviews.at(-1)?.round;
        const rivals = earlier.filter((r) =>
          liked === undefined
            ? r.round === (last?.round ?? latest)
            : `${r.round}/${r.run}` === liked
        );
        const options = [...ofReference, ...rivals].flatMap((r) => {
          const crop = r.sections.get(section.name);
          return crop
            ? [{ id: `${r.round}/${r.run}`, src: viewerSrc(data, crop) }]
            : [];
        });
        if (
          options.length < 2 ||
          !ofReference.some((r) => r.sections.has(section.name))
        ) {
          return [];
        }
        const id = `section/${round}/${reference}/${slug}`;
        return [
          {
            id,
            kind: "section",
            left: "No",
            lens: "section",
            lines: [],
            options: lettered(id, options),
            pictures: [],
            question: `${section.name}: which is best?`,
            reference,
            referencePictures: [
              { label: section.name, src: viewerSrc(data, section.crop) },
            ],
            right: "Yes",
            round,
            run: "",
            subject: section.name,
            title: reference,
          },
        ];
      }
    );
  });

/** The section last picked, as `round/run`, or none when none was good enough or none was picked. */
const likedOf = (
  last:
    | { readonly pick?: string | undefined; readonly round: string }
    | undefined
) => {
  if (last?.pick === undefined || last.pick === NONE_PICKED) {
    return;
  }
  return last.pick.includes("/") ? last.pick : `${last.round}/${last.pick}`;
};

/** The pick that says no option was good enough (the viewer's `NONE`). */
const NONE_PICKED = "none";
