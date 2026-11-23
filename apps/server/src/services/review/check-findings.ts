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
  readonly route?: string | undefined;
}

/** How many places of one value off the system a finding names, the rest counted. */
const NAMED_PLACES = 5;

const SPACING_RULE = "SKILL.md › Spacing › Proximity groups";

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
        title: `“${f.below}” too close to “${f.above}”`,
        where: `“${f.above}” and “${f.below}”`,
      })
    : checkFound("touching-rows", page, {
        category: "spacing",
        fix: "Put the spacing scale's smallest step between the rows.",
        problem: `touching rows: rows of ${f.rowHeight}px, rounded or filled, with no gap between them: each row's fill meets its neighbour's.`,
        title: `Rows touching in “${f.list}”`,
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

/** A kind of value as the designer reads it: `text size`. */
const kindName = (kind: OffSystemKind) => kind.replace("-", " ");

/** A value off the system as the designer reads it: `13px spacing`, `#ff0000 color`. */
const valueName = (kind: OffSystemKind, value: string | number) =>
  `${typeof value === "number" && IN_PIXELS.has(kind) ? `${value}px` : String(value)} ${kindName(kind)}`;

/** The values off the system on every page, one finding a value, those in most places first. */
/**
 * How the findings name each page: its short name, or its whole route or file where two pages
 * share a short name (`/settings/billing` and `/account/billing`).
 */
const pageNames = (pages: readonly CheckedPage[]) => {
  const names = pages.map((page) => page.route ?? page.file);
  const shorts = new Map<string, Set<string>>();
  for (const name of names) {
    shorts.set(
      shortPage(name),
      (shorts.get(shortPage(name)) ?? new Set()).add(name)
    );
  }
  return (name: string) =>
    (shorts.get(shortPage(name))?.size ?? 0) > 1 ? name : shortPage(name);
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
      readonly places: { readonly page: string; readonly place: string }[];
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
      entry.places.push({ page: name, place: `${v.node} (\`${v.field}\`)` });
      byValue.set(key, entry);
    }
  }
  return [...byValue.values()]
    .sort((a, b) => b.places.length - a.places.length)
    .map(({ kind, pages: on, places, value }) => {
      const name = valueName(kind, value);
      const count = `${places.length} ${places.length === 1 ? "place" : "places"}`;
      // Across pages, each place names its page, so two nodes of one name stay apart.
      const named = places
        .slice(0, NAMED_PLACES)
        .map((p) =>
          on.size > 1 ? `${p.place} on ${pageName(p.page)}` : p.place
        )
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
        title: `${name} off the system`,
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
    ...mergeFound(rendered).map((f) =>
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
