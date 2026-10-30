/**
 * What the application's code uses, value by value, for the design-system setup (ADR 0023): the
 * colours, spacing, type sizes and weights, radii, shadows and layers of its Tailwind classes,
 * inline styles and stylesheets. Read by fixed rules and synchronous: the server lists and reads the files.
 *
 * Classes are found as Tailwind finds them, in every string of a file, so `cn()`, `cva()` and
 * constants count as well as `className`. Whether a value is the design system's is decided
 * afterwards, in `summarise`, against the design system the setup holds.
 */
import type {
  UsageInventory,
  UsageKind,
  UsageLocation,
  UsageStatus,
  UsageTotals,
  UsageValue,
} from "@ultrapaint/contracts/design-system-setup";
import { USAGE_KINDS } from "@ultrapaint/contracts/design-system-setup";
import type {
  UsageOccurrence,
  UsageReader,
} from "@ultrapaint/framework-api/node";
import { type Classified, classify, knownOf } from "./usage-classify.ts";
import { includes, scanFile } from "./usage-files.ts";

// biome-ignore lint/performance/noBarrelFile: the scan's exports stay where callers import them; its parts live beside it.
export {
  type ClassParts,
  readClass,
  splitClass,
} from "./usage-class.ts";
export {
  type Classified,
  classify,
  type Known,
  knownOf,
} from "./usage-classify.ts";

const PER_GROUP = 60;
const LOCATIONS = 8;
const EXAMPLES = 5;
const STATUS_ORDER: Record<UsageStatus, number> = {
  default: 1,
  raw: 0,
  system: 2,
};

interface Group {
  count: number;
  readonly examples: Set<string>;
  readonly files: Set<string>;
  readonly locations: UsageLocation[];
  readonly value: Classified;
}

const recommend = (
  ownColors: number,
  colors: UsageTotals | undefined
): UsageInventory["recommendation"] => {
  const total = colors ? colors.system + colors.default + colors.raw : 0;
  const off = colors ? colors.default + colors.raw : 0;
  const share = total > 0 ? Math.round((off / total) * 100) : 0;
  if (ownColors < 3) {
    return {
      mode: "propose",
      reason: `The theme declares ${ownColors === 0 ? "no colour tokens" : `${ownColors} colour token${ownColors === 1 ? "" : "s"}`} of its own, so the code's colours are Tailwind's palette and values written out.`,
    };
  }
  if (share > 50) {
    return {
      mode: "propose",
      reason: `${share}% of the colours the code uses are not the theme's.`,
    };
  }
  return {
    mode: "adopt",
    reason: `The theme declares ${ownColors} colours of its own${total > 0 ? `, and ${100 - share}% of the colours in the code are among them` : ""}.`,
  };
};

/** One use counted into its value's group, and into its kind's totals. */
const count = (
  groups: Map<string, Group>,
  totals: Map<UsageKind, UsageTotals>,
  value: Classified,
  use: UsageOccurrence,
  file: string
) => {
  const key = `${value.kind}|${value.status}|${value.value}`;
  const group = groups.get(key) ?? {
    count: 0,
    examples: new Set<string>(),
    files: new Set<string>(),
    locations: [],
    value,
  };
  group.count += 1;
  group.files.add(file);
  if (group.examples.size < EXAMPLES) {
    group.examples.add(use.raw);
  }
  if (group.locations.length < LOCATIONS) {
    group.locations.push({ file, line: use.line });
  }
  groups.set(key, group);
  const total = totals.get(value.kind);
  if (total) {
    totals.set(value.kind, {
      ...total,
      [value.status]: total[value.status] + 1,
    });
  }
};

const summarise: UsageReader["summarise"] = (files, ctx, at) => {
  const known = knownOf(ctx.designSystem, ctx.ownTokens);
  const groups = new Map<string, Group>();
  const totals = new Map<UsageKind, UsageTotals>(
    USAGE_KINDS.map(({ kind }) => [
      kind,
      { default: 0, kind, raw: 0, system: 0 },
    ])
  );
  for (const { file, uses } of files) {
    for (const use of uses) {
      for (const value of classify(use, known)) {
        count(groups, totals, value, use, file);
      }
    }
  }
  const sorted = [...groups.values()].sort(
    (a, b) =>
      STATUS_ORDER[a.value.status] - STATUS_ORDER[b.value.status] ||
      b.count - a.count ||
      a.value.value.localeCompare(b.value.value)
  );
  const taken = new Map<string, number>();
  const values: UsageValue[] = [];
  for (const group of sorted) {
    const key = `${group.value.kind}|${group.value.status}`;
    const n = taken.get(key) ?? 0;
    if (n >= (ctx.perGroup ?? PER_GROUP)) {
      continue;
    }
    taken.set(key, n + 1);
    values.push({
      count: group.count,
      examples: [...group.examples],
      files: group.files.size,
      kind: group.value.kind,
      locations: group.locations,
      status: group.value.status,
      value: group.value.value,
      ...(group.value.token !== undefined && { token: group.value.token }),
    });
  }
  const ownColors =
    ctx.ownTokens === null
      ? known.colors.size
      : ctx.ownTokens.filter((name) => name.startsWith("color-")).length;
  return {
    against: ctx.ownTokens === null ? "saved" : "theme",
    at,
    files: files.length,
    ownColors,
    recommendation: recommend(ownColors, totals.get("color")),
    totals: [...totals.values()],
    values,
  };
};

export const scanning: Pick<
  UsageReader,
  "includes" | "scanFile" | "summarise"
> = { includes, scanFile, summarise };
