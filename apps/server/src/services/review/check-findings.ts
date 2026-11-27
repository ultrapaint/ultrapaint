/**
 * The checks' findings for the designer (ADR 0081): what the editor measured on a page it drew
 * for the review (groups set too close, filled rows touching) and the values its document sets by
 * hand where the design system has a token, grouped by value ("13px spacing, 9 places"). Each is
 * a finding marked as a check's, with what it measured and the element it names, sent to the
 * designer beside the reviewers' and never shown to them. A check's finding is minor and never
 * holds back approval.
 */
import type { Category, CheckKind } from "@ultrapaint/contracts/review";
import type { RenderedFinding } from "@ultrapaint/contracts/screenshots";
import type {
  OffSystemKind,
  OffSystemValue,
} from "@ultrapaint/design-document/off-system";
import { type Found, mergeFound, shortPage } from "./review-rounds.ts";

/** Who found a check's finding, as the round keeps it (`RoundFinding.reviewer`). */
export const CHECK_REVIEWER = "check";

/** What the checks measured on one page; nothing when the editor could not measure it. */
export interface PageChecks {
  readonly offSystem: readonly OffSystemValue[];
  readonly rendered: readonly RenderedFinding[];
}

/** A page under review, with what the checks measured on it. */
export interface CheckedPage {
  readonly checks?: PageChecks | undefined;
  readonly file: string;
  /** What the canvas calls it (`Page.name`): how its findings name it. */
  readonly name?: string | undefined;
  readonly route?: string | undefined;
}

/** How many places of one value off the system a finding names, the rest counted. */
const NAMED_PLACES = 5;

const SPACING_RULE = "SKILL.md › Spacing › Proximity groups";

/**
 * How long a title is, about: a value and a label are cut to their own lengths, and the element
 * takes what is left, a word or so at least.
 */
const TITLE_CHARS = 60;
const VALUE_CHARS = 24;
const LABEL_CHARS = 26;
const NODE_CHARS = { least: 8, most: 20 };

const TRAILING_ELLIPSIS = /…$/;
const TRAILING_PUNCTUATION = /[\s,.;:—–-]+$/;

/** A text cut at a word with an ellipsis past `max` characters: `Choose the plan that…`. */
const shortened = (text: string, max: number) => {
  const whole = text.trim().replace(/\s+/g, " ");
  if (whole.length <= max) {
    return whole;
  }
  const bare = whole.replace(TRAILING_ELLIPSIS, "");
  // One past the limit: a word ending at it is whole.
  const space = bare.slice(0, max + 1).lastIndexOf(" ");
  return `${(space > 0 ? bare.slice(0, space) : bare.slice(0, max)).replace(TRAILING_PUNCTUATION, "")}…`;
};

/** A CSS function: `color-mix(in oklab, …)` reads as `color-mix(…)` in a title. */
const CSS_FUNCTION = /^[a-z-]+\(/i;

/** A value as a title reads it: whole when short, else a function's name or its first words. */
const shortValue = (value: string) => {
  const whole = value.trim().replace(/\s+/g, " ");
  return whole.length > VALUE_CHARS && CSS_FUNCTION.test(whole)
    ? `${whole.slice(0, whole.indexOf("("))}(…)`
    : shortened(whole, VALUE_CHARS);
};

const checkFound = (
  check: CheckKind,
  page: string,
  finding: Omit<Found["finding"], "rule" | "severity"> & {
    readonly rule?: string;
  }
): Found => ({
  check,
  finding: { rule: "", ...finding, severity: "minor" },
  page,
  reviewer: CHECK_REVIEWER,
});

/** A rendered check's finding, as the designer is told it. */
const renderedFound = (page: string, f: RenderedFinding): Found =>
  f.kind === "groups-apart"
    ? checkFound("groups-apart", page, {
        category: "spacing",
        fix: `Set at least ${Math.ceil(f.ratio * f.within)}px between the groups (${f.ratio}× the ${f.within}px within), a step of the spacing scale.`,
        problem: `groups: ${f.between}px between “${f.above}” and “${f.below}”, ${f.within}px between the lines below: under ${f.ratio}×, they read as one group.`,
        rule: SPACING_RULE,
        title: `“${shortened(f.below, LABEL_CHARS)}” too close to “${shortened(f.above, LABEL_CHARS)}”`,
        where: `“${f.above}” and “${f.below}”`,
      })
    : checkFound("touching-rows", page, {
        category: "spacing",
        fix: "Put the spacing scale's smallest step between the rows.",
        problem: `touching rows: rows of ${f.rowHeight}px, rounded or filled, with no gap between them: each row's fill meets its neighbour's.`,
        title: `Rows touching in “${shortened(f.list, LABEL_CHARS)}”`,
        where: `the rows of “${f.list}”`,
      });

/** The category whose rules a value off the system breaks. */
const CATEGORY_OF: Readonly<Record<OffSystemKind, Category>> = {
  color: "color",
  font: "typography",
  "line-height": "typography",
  radius: "borders",
  shadow: "elevation",
  spacing: "spacing",
  "text-size": "typography",
  tracking: "typography",
  weight: "typography",
};

/** The kinds whose bare numbers are pixels. */
const IN_PIXELS: ReadonlySet<OffSystemKind> = new Set([
  "radius",
  "spacing",
  "text-size",
]);

/** A kind of value as the designer reads it: `text size`, `colour`. */
const kindName = (kind: OffSystemKind) =>
  kind === "color" ? "colour" : kind.replace("-", " ");

/** A value as it is set: `13px` for a spacing of 13. */
const setAs = (kind: OffSystemKind, value: string | number) =>
  typeof value === "number" && IN_PIXELS.has(kind)
    ? `${value}px`
    : String(value);

/** A value off the system as the designer reads it: `13px spacing`, `#ff0000 colour`. */
const valueName = (kind: OffSystemKind, value: string | number) =>
  `${setAs(kind, value)} ${kindName(kind)}`;

/** One place a value off the system is set: its element, its page, and its fill layer if any. */
interface Place {
  readonly layer: OffSystemValue["layer"];
  readonly node: string;
  readonly page: string;
  /** The element and its field, as `where` names it: ``Title (`padding.top`)``. */
  readonly place: string;
}

/** The fill layer a value is, as a finding says it. */
const IN_LAYER: Readonly<Record<NonNullable<Place["layer"]>, string>> = {
  colour: " as a fill layer",
  gradient: " in a gradient",
};

/** The fill layer every place of a value has it in, as a finding says it; else nothing. */
const layerOf = (places: readonly Place[]) => {
  const layer = places[0]?.layer;
  return layer !== undefined && places.every((p) => p.layer === layer)
    ? IN_LAYER[layer]
    : "";
};

/**
 * How the findings name each page: what the canvas calls it, else its route's last segment (or
 * its file's), else its whole route or file, the first that no other page shares (two states of
 * one page share a name; `/settings/billing` and `/account/billing` a last segment). The home
 * page, whose last segment is none, goes by its name or `/`.
 */
const pageNames = (pages: readonly CheckedPage[]) => {
  const candidates = pages.map((page) => {
    const key = page.route ?? page.file;
    const names = [page.name, shortPage(key), page.route, page.file].filter(
      (name): name is string => name !== undefined && name.trim() !== ""
    );
    return { key, names };
  });
  const nameOf = new Map(
    candidates.map(({ key, names }) => {
      const others = candidates
        .filter((other) => other.key !== key)
        .flatMap((other) => other.names);
      return [key, names.find((name) => !others.includes(name)) ?? key];
    })
  );
  return (key: string) => nameOf.get(key) ?? (shortPage(key) || key);
};

const offSystemFound = (
  pages: readonly CheckedPage[],
  pageName: (name: string) => string
): readonly Found[] => {
  const byValue = new Map<
    string,
    {
      readonly kind: OffSystemKind;
      readonly pages: Set<string>;
      readonly places: Place[];
      readonly value: string | number;
    }
  >();
  for (const page of pages) {
    const name = page.route ?? page.file;
    for (const v of page.checks?.offSystem ?? []) {
      // One key for one value however it is written: `13` and `"13px"` are one spacing.
      const key = valueName(v.kind, v.value);
      const entry = byValue.get(key) ?? {
        kind: v.kind,
        pages: new Set<string>(),
        places: [],
        value: v.value,
      };
      entry.pages.add(name);
      entry.places.push({
        layer: v.layer,
        node: v.node,
        page: name,
        place: `${v.node} (\`${v.field}\`)`,
      });
      byValue.set(key, entry);
    }
  }
  const values = [...byValue.values()].sort(
    (a, b) => b.places.length - a.places.length
  );
  /**
   * A title: the kind, the value as it reads (or whole), its fill layer, and its first element,
   * the others said but not counted, so the title stays as it was while the places change.
   */
  const titleOf = (entry: (typeof values)[number], whole: boolean) => {
    const { kind, places, value } = entry;
    const set = setAs(kind, value);
    const head = `Hand-set ${kindName(kind)} ${whole ? set : shortValue(set)}${layerOf(places)}`;
    const [first] = places;
    if (first === undefined) {
      return head;
    }
    const others = places.length > 1 ? " and others" : "";
    const room = TITLE_CHARS - head.length - " on ".length - others.length;
    const node = shortened(
      first.node,
      Math.min(NODE_CHARS.most, Math.max(NODE_CHARS.least, room))
    );
    return `${head} on ${node}${others}`;
  };
  // Two values that read alike are each titled by their whole value, so neither hides the other.
  const shortTitles = values.map((entry) => titleOf(entry, false));
  return values.map((entry, i) => {
    const { kind, pages: on, places, value } = entry;
    const title =
      shortTitles.filter((t) => t === shortTitles[i]).length > 1
        ? titleOf(entry, true)
        : (shortTitles[i] ?? "");
    const name = `${valueName(kind, value)}${layerOf(places)}`;
    const count = `${places.length} ${places.length === 1 ? "place" : "places"}`;
    // Across pages, each place names its page, so two nodes of one name stay apart.
    const named = places
      .slice(0, NAMED_PLACES)
      .map((p) => (on.size > 1 ? `${p.place} on ${pageName(p.page)}` : p.place))
      .join(", ");
    const more =
      places.length > NAMED_PLACES
        ? ` and ${places.length - NAMED_PLACES} more`
        : "";
    const [first = ""] = on;
    return checkFound("off-system", first, {
      category: CATEGORY_OF[kind],
      fix:
        kind === "spacing"
          ? "Use a step of the design system's spacing scale."
          : `Use the design system's ${kindName(kind)} token.`,
      problem: `off the system: ${name}, ${count}, set by hand where the design system has a token.`,
      title,
      where: `${named}${more}${on.size > 1 ? `, on ${on.size} pages` : ""}`,
    });
  });
};

/** Whether two findings share a title as `mergeFound` reads it. */
const sameTitle = (a: Found, b: Found) =>
  a.finding.title.trim().toLowerCase() === b.finding.title.trim().toLowerCase();

/**
 * Every check's finding on the pages (ADR 0081): what the editor measured on each, a problem two
 * pages share once, then the values off the system, grouped by value across the pages.
 */
export const checkFindings = (
  pages: readonly CheckedPage[]
): readonly Found[] => {
  const rendered = pages.flatMap((page) =>
    (page.checks?.rendered ?? []).map((f) =>
      renderedFound(page.route ?? page.file, f)
    )
  );
  const onPages = new Set(rendered.map((f) => f.page)).size;
  const pageName = pageNames(pages);
  return [
    ...mergeFound(rendered, pageName).map((f) =>
      // A problem on one page of several names it; one two pages share names them already.
      onPages > 1 && rendered.filter((r) => sameTitle(r, f)).length === 1
        ? {
            ...f,
            finding: {
              ...f.finding,
              where: `${f.finding.where} on ${pageName(f.page)}`,
            },
          }
        : f
    ),
    ...offSystemFound(pages, pageName),
  ];
};
