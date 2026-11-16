/**
 * `study ground`: what the pages `study read` read have in common, counted (ADR 0082, the common
 * ground). Each note is laid flat into its fields (`type.sizes.body`, `components.buttons`,
 * `imagery.kinds[]=photography`, `sections.has=hero`); a field with few values is counted as the
 * share of pages giving each, a number as its median and middle half. The pages are grouped: every
 * page, each kind of page, then each kind of page by expression and by the skill's character
 * (technical, humanistic, expressive: the note's domain, its "culture" the skill's expressive), a
 * group kept when it has enough pages to say something. The well-made pages (craft 3) are counted beside every page: the common
 * ground is what they share.
 *
 * What a person or a model reads to write the skill's references from, never the references
 * themselves: no company, library or person is named here, since faces, hexes and free text are
 * left out.
 *
 *   studies/<model>-questions-5/ground.json, studies/<model>-questions-5/ground.md
 */
import path from "node:path";
import { Effect, Predicate, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { listDir, readJson, writeJson, writeText } from "./layout.ts";
import { studyDir } from "./study-read.ts";

/** The parts of a note that hold the page's system; the rest is free text or the page's facts. */
const PARTS = [
  "dials",
  "layout",
  "type",
  "color",
  "surfaces",
  "spacing",
  "imagery",
  "icons",
  "components",
  "words",
  "tells",
  "mobile",
  "motion",
] as const;
/** Fields that name or describe rather than choose: a face's name, a colour's hex, free text. */
const LEFT_OUT = new Set([
  // Hexes, or a word where none was seen: counted as words they would read as 100% none.
  "color.background",
  "color.border",
  "color.mutedText",
  "color.surface",
  "color.text",
  "type.faceNames",
  "type.weights",
  "imagery.subjects",
  "imagery.treatment",
  "icons.use",
  "components.inputs",
  "words.voice",
  "words.ctaVerbs",
  "mobile.changes",
]);
/** A field with more values than this is free text, left out. */
const MAX_VALUES = 14;
/** Pages a group needs, and well-made pages it needs for its own column. */
const MIN_PAGES = 30;
const MIN_KIND_EXPRESSION = 20;
/** A value shown when at least this share of the group gives it. */
const SHOWN_SHARE = 0.05;
/** A list's value kept in a group's counts when this share of its pages has it. */
const MIN_PRESENT = 0.02;

export type Value = string | number | boolean;

/** One page as the counts see it. */
export interface Flat {
  /** The skill's character: technical, humanistic or expressive. */
  readonly character: string;
  readonly craft: number;
  readonly expression: string;
  readonly fields: ReadonlyMap<string, Value>;
  readonly pageKind: string;
  /** Values of a list: present or not, one field per value. */
  readonly present: ReadonlySet<string>;
}

/** The note's domain as the skill names the character (`references/character.md`). */
const CHARACTER: Readonly<Record<string, string>> = {
  culture: "expressive",
  humanistic: "humanistic",
  technical: "technical",
};

const isHex = (v: unknown) => typeof v === "string" && v.startsWith("#");

const walk = (
  value: unknown,
  at: string,
  fields: Map<string, Value>,
  present: Set<string>
) => {
  if (LEFT_OUT.has(at) || value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    if (value.every(Predicate.isString)) {
      for (const v of value) {
        if (!isHex(v)) {
          present.add(`${at}[]=${v}`);
        }
      }
    } else {
      fields.set(`${at}.count`, value.length);
    }
    return;
  }
  if (Predicate.isObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      walk(v, `${at}.${key}`, fields, present);
    }
    return;
  }
  if (
    !isHex(value) &&
    (typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean")
  ) {
    fields.set(at, value);
  }
};

/** A note laid flat; undefined when it is not a page read whole (a broken capture). */
export const flatten = (
  note: Readonly<Record<string, unknown>>
): Flat | undefined => {
  if (note.capture === "broken") {
    return;
  }
  const fields = new Map<string, Value>();
  const present = new Set<string>();
  for (const part of PARTS) {
    walk(note[part], part, fields, present);
  }
  const sections = Array.isArray(note.sections) ? note.sections : [];
  fields.set("sections.count", sections.length);
  for (const s of sections) {
    if (Predicate.isObject(s) && Predicate.isString(s.kind)) {
      present.add(`sections.has=${s.kind}`);
    }
  }
  return {
    character: CHARACTER[String(note.domain)] ?? "unknown",
    craft: typeof note.craft === "number" ? note.craft : 0,
    expression: Predicate.isString(note.expression)
      ? note.expression
      : "unknown",
    fields,
    pageKind: Predicate.isString(note.pageKind) ? note.pageKind : "unknown",
    present,
  };
};

const quantile = (sorted: readonly number[], q: number) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (i - lo);
};

/** A field counted over some pages. */
export type Counted =
  | {
      readonly kind: "number";
      readonly median: number;
      readonly n: number;
      readonly p25: number;
      readonly p75: number;
    }
  | {
      readonly kind: "values";
      readonly n: number;
      /** Each value's share of the pages that gave the field, most given first. */
      readonly shares: readonly (readonly [string, number])[];
    };

const round2 = (n: number) => Math.round(n * 100) / 100;

const countField = (
  pages: readonly Flat[],
  field: string
): Counted | undefined => {
  const values = pages.flatMap((p) => {
    const v = p.fields.get(field);
    return v === undefined ? [] : [v];
  });
  if (values.length === 0) {
    return;
  }
  if (values.every((v) => typeof v === "number")) {
    const sorted = [...(values as number[])].sort((a, b) => a - b);
    return {
      kind: "number",
      median: round2(quantile(sorted, 0.5)),
      n: sorted.length,
      p25: round2(quantile(sorted, 0.25)),
      p75: round2(quantile(sorted, 0.75)),
    };
  }
  const counts = new Map<string, number>();
  for (const v of values) {
    counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  }
  return {
    kind: "values",
    n: values.length,
    shares: [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([v, c]) => [v, round2(c / values.length)] as const),
  };
};

/** Share of the pages with a list's value (`imagery.kinds[]=photography`, `sections.has=hero`). */
const countPresent = (pages: readonly Flat[], field: string) =>
  pages.length === 0
    ? 0
    : round2(pages.filter((p) => p.present.has(field)).length / pages.length);

/** The fields worth counting: numbers, and values that come in few kinds. */
export const fieldsOf = (pages: readonly Flat[]) => {
  const seen = new Map<string, Set<string>>();
  for (const p of pages) {
    for (const [field, v] of p.fields) {
      const set = seen.get(field) ?? new Set<string>();
      set.add(typeof v === "number" ? "#number" : String(v));
      seen.set(field, set);
    }
  }
  const fields = [...seen]
    .filter(([, vs]) => vs.has("#number") || vs.size <= MAX_VALUES)
    .map(([field]) => field)
    .sort();
  // Every list value: each group keeps those common enough in it (`groupOf`).
  const present = [...new Set(pages.flatMap((p) => [...p.present]))].sort();
  return { fields, present };
};

/** One group of pages, counted over every page and over the well-made ones. */
export interface Group {
  readonly fields: Readonly<
    Record<string, { readonly all: Counted; readonly wellMade?: Counted }>
  >;
  readonly name: string;
  readonly pages: number;
  readonly present: Readonly<
    Record<string, { readonly all: number; readonly wellMade?: number }>
  >;
  readonly wellMade: number;
}

const groupOf = (
  name: string,
  pages: readonly Flat[],
  counted: ReturnType<typeof fieldsOf>
): Group => {
  const good = pages.filter((p) => p.craft >= 3);
  const withGood = good.length >= MIN_KIND_EXPRESSION / 2;
  const fields: Record<string, { all: Counted; wellMade?: Counted }> = {};
  for (const field of counted.fields) {
    const all = countField(pages, field);
    if (all) {
      const wellMade = withGood ? countField(good, field) : undefined;
      fields[field] = { all, ...(wellMade && { wellMade }) };
    }
  }
  const present: Record<string, { all: number; wellMade?: number }> = {};
  for (const field of counted.present) {
    const all = countPresent(pages, field);
    const wellMade = withGood ? countPresent(good, field) : undefined;
    // Kept when common enough in this group, however rare across every page.
    if (Math.max(all, wellMade ?? 0) >= MIN_PRESENT) {
      present[field] = { all, ...(wellMade !== undefined && { wellMade }) };
    }
  }
  return { fields, name, pages: pages.length, present, wellMade: good.length };
};

/** Every page, each kind of page, each kind by expression and by character: the groups with enough pages. */
export const groundOf = (pages: readonly Flat[]): readonly Group[] => {
  const counted = fieldsOf(pages);
  const by = (key: (p: Flat) => string) => {
    const map = new Map<string, Flat[]>();
    for (const p of pages) {
      const k = key(p);
      const bucket = map.get(k);
      if (bucket) {
        bucket.push(p);
      } else {
        map.set(k, [p]);
      }
    }
    return [...map].sort((a, b) => b[1].length - a[1].length);
  };
  return [
    groupOf("every page", pages, counted),
    ...by((p) => p.pageKind)
      .filter(([, ps]) => ps.length >= MIN_PAGES)
      .map(([kind, ps]) => groupOf(kind, ps, counted)),
    ...by((p) => `${p.pageKind} · ${p.expression}`)
      .filter(([, ps]) => ps.length >= MIN_KIND_EXPRESSION)
      .map(([kind, ps]) => groupOf(kind, ps, counted)),
    ...by((p) => `${p.pageKind} · ${p.character} character`)
      .filter(([, ps]) => ps.length >= MIN_KIND_EXPRESSION)
      .map(([kind, ps]) => groupOf(kind, ps, counted)),
  ];
};

const pct = (share: number) => `${Math.round(share * 100)}%`;

const cellOf = (c: Counted | undefined) => {
  if (c === undefined) {
    return "";
  }
  if (c.kind === "number") {
    return `${c.median} (${c.p25}–${c.p75})`;
  }
  // A yes or no: the share of yes.
  if (c.shares.every(([v]) => v === "true" || v === "false")) {
    return `yes ${pct(c.shares.find(([v]) => v === "true")?.[1] ?? 0)}`;
  }
  return c.shares
    .filter(([, s]) => s >= SHOWN_SHARE)
    .slice(0, 5)
    .map(([v, s]) => `${v} ${pct(s)}`)
    .join(", ");
};

/** The groups as tables: field, well-made pages, every page. */
export const groundText = (groups: readonly Group[]) =>
  [
    "# The common ground",
    "",
    "What the pages read by `pnpm evals study read` share, by group: a field with few values as the share of pages giving each (values under 5% left out), a number as its median and middle half, a list's value as the share of pages that have it. **Well made** is the pages rated craft 3. Written by `pnpm evals study ground`.",
    "",
    ...groups.flatMap((g) => [
      `## ${g.name}`,
      "",
      `${g.pages} pages, ${g.wellMade} well made.`,
      "",
      "| Field | Well made | Every page |",
      "| --- | --- | --- |",
      ...Object.entries(g.fields).map(
        ([f, c]) => `| ${f} | ${cellOf(c.wellMade)} | ${cellOf(c.all)} |`
      ),
      ...Object.entries(g.present)
        .filter(([, s]) => Math.max(s.all, s.wellMade ?? 0) >= SHOWN_SHARE)
        .map(
          ([f, s]) =>
            `| ${f} | ${s.wellMade === undefined ? "" : pct(s.wellMade)} | ${pct(s.all)} |`
        ),
      "",
    ]),
  ].join("\n");

const Note = Schema.Record(Schema.String, Schema.Unknown);

export const studyGround = Effect.fn("studyGround")(function* (options: {
  readonly model: string;
}) {
  const { data } = yield* EvalsConfig;
  const dir = studyDir(data.studies, options.model);
  const notes = path.join(dir, "notes");
  const pages: Flat[] = [];
  for (const file of yield* listDir(notes)) {
    if (file.endsWith(".json")) {
      const flat = flatten(yield* readJson(Note, path.join(notes, file)));
      if (flat) {
        pages.push(flat);
      }
    }
  }
  const groups = groundOf(pages);
  yield* writeJson(path.join(dir, "ground.json"), groups);
  yield* writeText(path.join(dir, "ground.md"), groundText(groups));
  yield* Effect.log(
    `${pages.length} pages in ${groups.length} groups: ${data.fromData(path.join(dir, "ground.md"))}`
  );
});
