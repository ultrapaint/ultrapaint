/**
 * The checks' findings for the designer (ADR 0081): what the editor measured on a page it drew
 * for the review (groups set too close, filled rows touching) and the values its document sets by
 * hand where the design system has a token, grouped by kind ("10 hand-set spacing values"). Each
 * is a finding marked as a check's, with what it measured and the element it names, sent to the
 * designer beside the reviewers' and never shown to them. A check's finding is minor and never
 * holds back approval.
 *
 * The checks read what the turns changed (ADR 0156): the values of the nodes they changed, and
 * every block of a page they changed, a page they made whole. A check's finding the designer
 * declined in the thread holds back what the checks measure again in the places it names, while
 * each reads the same.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Category, CheckKind } from "@ultrapaint/contracts/review";
import type { RenderedFinding } from "@ultrapaint/contracts/screenshots";
import type { CheckPlace, RoundFinding } from "@ultrapaint/contracts/threads";
import {
  changedNodeIds,
  diffTrees,
  isEmptyDiff,
} from "@ultrapaint/design-document/diff";
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

/**
 * The kinds of check whose findings the designer is sent: those the person rated real at 80% or
 * more (ADR 0081 §3). Groups set too close (`groups-apart`) left (ADR 0081, "As built"); the
 * editor still measures it.
 */
export const SENT_CHECKS: ReadonlySet<CheckKind> = new Set([
  "touching-rows",
  "off-system",
]);

/** How many places of one kind of value off the system a finding names, the rest counted. */
const NAMED_PLACES = 5;

/** How many values of one kind a finding's problem names, the rest counted. */
const NAMED_VALUES = 5;

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
  places: readonly CheckPlace[],
  finding: Omit<Found["finding"], "rule" | "severity"> & {
    readonly rule?: string;
  }
): Found => ({
  check,
  finding: { rule: "", ...finding, severity: "minor" },
  page,
  places,
  reviewer: CHECK_REVIEWER,
});

/**
 * Where a rendered check measured: the labels of its blocks and what it measured, for want of
 * the nodes they draw, which the frame does not name (ADR 0156).
 */
const renderedPlace = (file: string, f: RenderedFinding): CheckPlace =>
  f.kind === "groups-apart"
    ? {
        fields: `${f.between}px between, ${f.within}px within`,
        node: `“${f.above}” / “${f.below}”`,
        page: file,
      }
    : { fields: `rows of ${f.rowHeight}px`, node: `“${f.list}”`, page: file };

/** A rendered check's finding, as the designer is told it. */
const renderedFound = (
  page: string,
  file: string,
  f: RenderedFinding
): Found =>
  f.kind === "groups-apart"
    ? checkFound("groups-apart", page, [renderedPlace(file, f)], {
        category: "spacing",
        fix: `Set at least ${Math.ceil(f.ratio * f.within)}px between the groups (${f.ratio}× the ${f.within}px within), a step of the spacing scale.`,
        problem: `groups: ${f.between}px between “${f.above}” and “${f.below}”, ${f.within}px between the lines below: under ${f.ratio}×, they read as one group.`,
        rule: SPACING_RULE,
        title: `“${shortened(f.below, LABEL_CHARS)}” too close to “${shortened(f.above, LABEL_CHARS)}”`,
        where: `“${f.above}” and “${f.below}”`,
      })
    : checkFound("touching-rows", page, [renderedPlace(file, f)], {
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

/** Several values of a kind, as the designer reads them: `text sizes`, `spacing values`. */
const PLURAL_KIND_NAME: Readonly<Record<OffSystemKind, string>> = {
  color: "colours",
  font: "fonts",
  "line-height": "line heights",
  radius: "radii",
  shadow: "shadows",
  spacing: "spacing values",
  "text-size": "text sizes",
  tracking: "tracking values",
  weight: "weights",
};

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

/** One value off the system and its places. */
interface ValueEntry {
  readonly places: Place[];
  readonly value: string | number;
}

/** One kind's values off the system across the pages, the nodes they are on and their pages. */
interface KindEntry {
  readonly kind: OffSystemKind;
  readonly nodes: Map<string, CheckPlace>;
  readonly pages: Set<string>;
  readonly values: Map<string, ValueEntry>;
}

/** Each value's places, the most first, then each place in turn. */
const placesOf = (values: readonly ValueEntry[]) =>
  values.flatMap((v) => v.places);

/**
 * The finding of one kind's values off the system: titled by the kind, the value as it reads
 * when there is one, or how many, and the first element (the others said, not counted); its
 * problem names each value whole, its `where` each place.
 */
const kindFound = (
  entry: KindEntry,
  pageName: (name: string) => string
): Found => {
  const { kind, nodes, pages: onPages } = entry;
  const values = [...entry.values.values()].sort(
    (a, b) => b.places.length - a.places.length
  );
  const places = placesOf(values);
  /** The kind's one value, when it has one. */
  const single = values.length === 1 ? values[0] : undefined;
  const [first] = places;
  const head =
    single === undefined
      ? `${places.length} hand-set ${PLURAL_KIND_NAME[kind]}`
      : `Hand-set ${kindName(kind)} ${shortValue(setAs(kind, single.value))}${layerOf(single.places)}`;
  const others = nodes.size > 1 ? " and others" : "";
  const room = TITLE_CHARS - head.length - " on ".length - others.length;
  const title =
    first === undefined
      ? head
      : `${head} on ${shortened(first.node, Math.min(NODE_CHARS.most, Math.max(NODE_CHARS.least, room)))}${others}`;
  const count = (n: number) => `${n} ${n === 1 ? "place" : "places"}`;
  const problem =
    single === undefined
      ? `off the system: ${places.length} ${PLURAL_KIND_NAME[kind]} set by hand where the design system has a token: ${values
          .slice(0, NAMED_VALUES)
          .map(
            (v) =>
              `${setAs(kind, v.value)}${layerOf(v.places)} (${count(v.places.length)})`
          )
          .join(", ")}${
          values.length > NAMED_VALUES
            ? ` and ${values.length - NAMED_VALUES} more`
            : ""
        }.`
      : `off the system: ${valueName(kind, single.value)}${layerOf(single.places)}, ${count(single.places.length)}, set by hand where the design system has a token.`;
  // Across pages, each place names its page, so two nodes of one name stay apart.
  const named = places
    .slice(0, NAMED_PLACES)
    .map((p) =>
      onPages.size > 1 ? `${p.place} on ${pageName(p.page)}` : p.place
    )
    .join(", ");
  const more =
    places.length > NAMED_PLACES
      ? ` and ${places.length - NAMED_PLACES} more`
      : "";
  const [page = ""] = onPages;
  return checkFound("off-system", page, [...nodes.values()], {
    category: CATEGORY_OF[kind],
    fix:
      kind === "spacing"
        ? "Use a step of the design system's spacing scale."
        : `Use the design system's ${kindName(kind)} token.`,
    problem,
    title,
    where: `${named}${more}${onPages.size > 1 ? `, on ${onPages.size} pages` : ""}`,
  });
};

/** The values off the system, one finding a kind across the pages, the kind with most places first. */
const offSystemFound = (
  values: readonly {
    readonly page: CheckedPage;
    readonly place: CheckPlace;
    readonly value: OffSystemValue;
  }[],
  pageName: (name: string) => string
): readonly Found[] => {
  const byKind = new Map<OffSystemKind, KindEntry>();
  for (const { page, place, value: v } of values) {
    const name = page.route ?? page.file;
    const entry = byKind.get(v.kind) ?? {
      kind: v.kind,
      nodes: new Map<string, CheckPlace>(),
      pages: new Set<string>(),
      values: new Map<string, ValueEntry>(),
    };
    entry.pages.add(name);
    entry.nodes.set(`${place.page}|${place.node}`, place);
    // One key for one value however it is written: `13` and `"13px"` are one spacing.
    const key = valueName(v.kind, v.value);
    const value = entry.values.get(key) ?? { places: [], value: v.value };
    value.places.push({
      layer: v.layer,
      node: v.node,
      page: name,
      place: `${v.node} (\`${v.field}\`)`,
    });
    entry.values.set(key, value);
    byKind.set(v.kind, entry);
  }
  const placeCount = (e: KindEntry) =>
    [...e.values.values()].reduce((n, v) => n + v.places.length, 0);
  return [...byKind.values()]
    .sort((a, b) => placeCount(b) - placeCount(a))
    .map((entry) => kindFound(entry, pageName));
};

/** Whether two findings share a title as `mergeFound` reads it. */
const sameTitle = (a: Found, b: Found) =>
  a.finding.title.trim().toLowerCase() === b.finding.title.trim().toLowerCase();

/** Whether a place reads as one a decline names. */
const samePlace = (a: CheckPlace, b: CheckPlace) =>
  a.page === b.page && a.node === b.node && a.fields === b.fields;

/**
 * The check's finding the designer declined that holds back what a check measured at a place
 * (ADR 0156): one of the same check that names the place as it reads now.
 */
const declineHolding = (
  declined: readonly RoundFinding[],
  check: CheckKind,
  place: CheckPlace
) =>
  declined.find(
    (d) =>
      d.check === check && (d.places ?? []).some((p) => samePlace(p, place))
  );

/** What the checks found on the pages: what to send, and the declines that held the rest back. */
export interface Checked {
  /** Each decline that held back something the checks measured again, marked as carried. */
  readonly carried: readonly RoundFinding[];
  readonly found: readonly Found[];
}

/**
 * Every check's finding of the kinds the designer is sent on the pages (ADR 0081, `sent`): what
 * the editor measured on each, a problem two pages share once, then the values off the system,
 * one finding a kind across the pages. What a check's finding the designer declined before still
 * names, as it read then, is held back, and the decline carried (ADR 0156).
 */
export const checksOf = (
  pages: readonly CheckedPage[],
  declined: readonly RoundFinding[] = [],
  sent: ReadonlySet<CheckKind> = SENT_CHECKS
): Checked => {
  const holding = new Set<RoundFinding>();
  /**
   * Whether what a check measured at a place is not sent: a kind the designer is not sent, or a
   * place a decline holds back, the decline then counted as carried.
   */
  const isLeftOut = (check: CheckKind, place: CheckPlace) => {
    if (!sent.has(check)) {
      return true;
    }
    const by = declineHolding(declined, check, place);
    if (by !== undefined) {
      holding.add(by);
    }
    return by !== undefined;
  };
  const rendered = pages.flatMap((page) =>
    (page.checks?.rendered ?? []).flatMap((f) =>
      isLeftOut(f.kind, renderedPlace(page.file, f))
        ? []
        : [renderedFound(page.route ?? page.file, page.file, f)]
    )
  );
  const offSystem = pages.flatMap((page) =>
    (page.checks?.offSystem ?? []).flatMap((value) => {
      const place = { fields: value.fields, node: value.id, page: page.file };
      return isLeftOut("off-system", place) ? [] : [{ page, place, value }];
    })
  );
  const onPages = new Set(rendered.map((f) => f.page)).size;
  const pageName = pageNames(pages);
  const found = [
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
    ...offSystemFound(offSystem, pageName),
  ];
  return {
    carried: declined
      .filter((d) => holding.has(d))
      .map((d) => ({ ...d, carried: true })),
    found,
  };
};

/**
 * What the checks read on a page the turns changed (ADR 0156): the values of the nodes they
 * changed, and every block the editor measured, the frame naming no nodes; nothing on a page
 * they left as it was. A page they made, or one with no before, is read whole.
 */
export const checksOnChanges = (
  checks: PageChecks,
  before: DesignNode | null | undefined,
  after: DesignNode
): PageChecks => {
  if (before === null || before === undefined) {
    return checks;
  }
  const diff = diffTrees(before, after);
  if (isEmptyDiff(diff)) {
    return { offSystem: [], rendered: [] };
  }
  const changed = changedNodeIds(diff);
  return {
    offSystem: checks.offSystem.filter((v) => changed.has(v.id)),
    rendered: checks.rendered,
  };
};
