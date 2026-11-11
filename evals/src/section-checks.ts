/**
 * What the lab's checks measured on a gap's section (ADR 0061), kept beside its `section.json` as
 * `checks.json`, for `recall --inputs checks` to show a reviewer as facts.
 *
 * `measure --section <name>` writes it: the page drawn at the section's commit, one measurement
 * per theme, each replacing the theme's last. A section the checks could not run on says why
 * (`notRun`), and a reviewer is told so rather than told nothing was found.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import { readJson, writeJson } from "./layout.ts";

/** A section's checks: `checks.json` beside its `section.json`. */
export const CHECKS_FILE = "checks.json";

/** Where a finding is, in CSS pixels from the measured root's top left corner. */
const Box = Schema.Struct({
  height: Schema.Number,
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});

const Measurement = Schema.Struct({
  axe: Schema.optional(
    Schema.Array(
      Schema.Struct({
        certain: Schema.Boolean,
        detail: Schema.String,
        label: Schema.String,
        rule: Schema.String,
      })
    )
  ),
  checks: Schema.Array(
    Schema.Struct({
      box: Schema.optional(Box),
      check: Schema.String,
      detail: Schema.String,
      label: Schema.String,
      on: Schema.Literals(["hover", "rest"]),
    })
  ),
  dividers: Schema.Array(
    Schema.Struct({
      bar: Schema.String,
      box: Schema.optional(Box),
      off: Schema.Number,
    })
  ) /** The spacing scale's step the off-scale check used; 0 when it was left out. */,
  grid: Schema.Number,
  /** How many times the gap within a group the gap between groups had to be. */
  ratio: Schema.Number,
  /** The part of the page measured: a CSS selector. */
  root: Schema.String,
  /** The root's box in the window (1600×1000), where the measurement put it. */
  rootBox: Schema.optional(Box),
  /** The root drawn at 2× in the page the layout was read in, beside `checks.json`. */
  shot: Schema.optional(Schema.String),
  spacing: Schema.Array(
    Schema.Struct({
      above: Schema.String,
      aboveBox: Schema.optional(Box),
      below: Schema.String,
      belowBox: Schema.optional(Box),
      between: Schema.Number,
      within: Schema.Number,
    })
  ),
  theme: Schema.Literals(["dark", "light"]),
});
export type Measurement = typeof Measurement.Type;

export const SectionChecks = Schema.Struct({
  /** The commit the page was drawn at: the section's. */
  commit: Schema.String,
  measured: Schema.Array(Measurement),
  /** Why the checks could not run on this section, when they could not. */
  notRun: Schema.optional(Schema.String),
});
export type SectionChecks = typeof SectionChecks.Type;

/** A section's checks with one theme's measurement replaced, the themes in order. */
export const withMeasurement = (
  checks: SectionChecks | undefined,
  commit: string,
  measurement: Measurement
): SectionChecks => ({
  commit,
  measured: [
    ...(checks?.commit === commit ? checks.measured : []).filter(
      (m) => m.theme !== measurement.theme
    ),
    measurement,
  ].sort((a, b) => a.theme.localeCompare(b.theme)),
});

/** At most this many facts are listed, and this many places for one fact, the rest counted. */
const SHOWN_FACTS = 40;
const SHOWN_PLACES = 8;

const GAP_RE = /^(rowGap|columnGap) /;

/** A fact and the element it is about, when it names one. */
interface Atom {
  readonly fact: string;
  readonly place?: string | undefined;
}

/**
 * A measurement's facts in the words `measure` prints them, a check's finding apart from the
 * element it names so one finding on many elements is one fact. A gap set on both axes (`gap-2`)
 * is one gap, not a row gap and a column gap.
 */
const atomsOf = (m: Measurement): readonly Atom[] => {
  const checks = m.checks.flatMap((f) => {
    const axis = (["rowGap", "columnGap"] as const).find((a) =>
      f.detail.startsWith(`${a} `)
    );
    if (axis === undefined) {
      return [f];
    }
    const other = axis === "rowGap" ? "columnGap" : "rowGap";
    const twin = m.checks.some(
      (g) =>
        g.label === f.label &&
        g.check === f.check &&
        g.detail === f.detail.replace(axis, other)
    );
    if (!twin) {
      return [f];
    }
    return axis === "rowGap"
      ? [{ ...f, detail: f.detail.replace(GAP_RE, "gap ") }]
      : [];
  });
  return [
    ...m.spacing.map((f) => ({
      fact: `groups: ${f.between}px between “${f.above}” and “${f.below}”, ${f.within}px between the lines below: under ${m.ratio}×`,
    })),
    ...m.dividers.map((f) => ({
      fact: `divider: ${f.off}px off its bar's line, in “${f.bar}”`,
    })),
    ...checks.map((f) => ({
      fact: `${f.check}${f.on === "hover" ? " (on hover)" : ""}: ${f.detail}`,
      place: f.label,
    })),
    ...(m.axe ?? []).map((f) => ({
      fact: `axe ${f.rule}${f.certain ? "" : " (to confirm)"}: ${f.detail}`,
      place: f.label,
    })),
  ];
};

/**
 * What the checks measured, as facts for a reviewer: each finding once with the elements it was
 * found on, the theme named where only one theme had it, what the checks held the page to, and
 * that a clean measurement is not a good design.
 */
export const checkFacts = (checks: SectionChecks): string => {
  if (checks.notRun !== undefined || checks.measured.length === 0) {
    return `The checks could not run on this section: ${checks.notRun ?? "nothing was measured"}.`;
  }
  const all = checks.measured.map((m) => m.theme);
  // fact → the element it names ("" for none) → the themes it was measured in.
  const facts = new Map<string, Map<string, Set<string>>>();
  for (const m of checks.measured) {
    for (const atom of atomsOf(m)) {
      const places = facts.get(atom.fact) ?? new Map<string, Set<string>>();
      const themes = places.get(atom.place ?? "") ?? new Set<string>();
      themes.add(m.theme);
      places.set(atom.place ?? "", themes);
      facts.set(atom.fact, places);
    }
  }
  const only = (themes: ReadonlySet<string>) =>
    themes.size === all.length || all.length === 1
      ? ""
      : ` (${[...themes].join(" and ")} only)`;
  const lines = [...facts].map(([fact, places]) => {
    const named = [...places].filter(([place]) => place !== "");
    if (named.length === 0) {
      return `- ${fact}${only(places.get("") ?? new Set(all))}`;
    }
    const shown = named
      .slice(0, SHOWN_PLACES)
      .map(([place, themes]) => `“${place}”${only(themes)}`);
    const more =
      named.length > SHOWN_PLACES
        ? `, and ${named.length - SHOWN_PLACES} more`
        : "";
    return `- ${fact}: ${shown.join(", ")}${more}`;
  });
  const [first] = checks.measured;
  const held = [
    `groups at least ${first?.ratio}× as far apart as the lines inside them`,
    ...(first && first.grid > 0
      ? [`every gap and padding on a ${first.grid}px scale`]
      : []),
    "dividers on their bar's line, contrast, control edges and fills, surface tones, touching rows, truncation, targets, controls shown only on hover",
  ].join("; ");
  const where = `the page the section is in, within \`${first?.root}\`, drawn at its commit in the ${all.join(" and ")} theme${all.length > 1 ? "s" : ""}`;
  if (lines.length === 0) {
    return `The checks measured ${where} and found nothing: ${held}. A clean measurement is not a good design.`;
  }
  return [
    `The checks measured ${where}, held to: ${held}. What they found, ${lines.length} in all; what lies outside this section is not yours to review, and a clean measurement is not a good design:`,
    ...lines.slice(0, SHOWN_FACTS),
    ...(lines.length > SHOWN_FACTS
      ? [`- and ${lines.length - SHOWN_FACTS} more.`]
      : []),
  ].join("\n");
};

/** A section's checks, failing when it has none, as `recall --inputs checks` needs them. */
export const readSectionChecks = Effect.fn("readSectionChecks")(function* (
  id: string
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(data.sections, id, CHECKS_FILE);
  if (!(yield* fs.exists(file))) {
    return yield* new EvalsError({
      message: `the section ${id} has no ${CHECKS_FILE}: run \`pnpm evals measure <url> --section ${id}\` on its commit first`,
    });
  }
  return yield* readJson(SectionChecks, file);
});

/** The picture of a section's measured root in a theme, beside its `checks.json`. */
export const shotFile = (theme: "dark" | "light") => `checks-${theme}@2x.png`;

/**
 * Writes one theme's measurement into a section's `checks.json`, at the section's commit, with
 * the picture of the root taken with it.
 */
export const recordSectionChecks = Effect.fn("recordSectionChecks")(function* (
  id: string,
  measurement: Measurement,
  shot?: Uint8Array
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const dir = path.join(data.sections, id);
  const { commit } = yield* readJson(
    Schema.Struct({ commit: Schema.String }),
    path.join(dir, "section.json")
  );
  if (shot) {
    yield* fs.writeFile(path.join(dir, shotFile(measurement.theme)), shot);
  }
  const file = path.join(dir, CHECKS_FILE);
  const before = (yield* fs.exists(file))
    ? yield* readJson(SectionChecks, file)
    : undefined;
  yield* writeJson(
    file,
    withMeasurement(before, commit, {
      ...measurement,
      ...(shot && { shot: shotFile(measurement.theme) }),
    })
  );
});
