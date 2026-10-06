/**
 * The design-system setup's pure parts (ADR 0023): how an inventory reads in a line or to an
 * agent, the mapping made from it and the decisions taken on it, what a target may be, how the
 * migration is cut into batches, and what Verify says. The service holds the state and the files.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import {
  type MappingChange,
  type MappingEntry,
  type MigrationBatch,
  mappingKey,
  targetsOf,
  USAGE_KINDS,
  type UsageInventory,
  type UsageKind,
  type UsageMapping,
} from "@ultrapaint/contracts/design-system-setup";
import type { UsageSuggestion } from "@ultrapaint/framework-api/node";

/** Values off the system a task lists, most used first. */
const BRIEF_VALUES = 80;
/** Kinds named in the card's line before the rest are counted. */
const SUMMARY_KINDS = 3;
/** Files a batch takes, so that one batch is one reviewable change. */
export const BATCH_FILES = 12;
/** Tokens a refusal lists before it stops. */
const LISTED_TOKENS = 12;
const SPACING_STEP_RE = /^spacing-\d+(\.\d+)?$/;
const NUMBER_RE = /^-?\d+$/;

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const offOf = (inventory: UsageInventory, kind: UsageKind) => {
  const totals = inventory.totals.find((t) => t.kind === kind);
  return totals ? totals.default + totals.raw : 0;
};

/** Every use off the system an inventory counts. */
export const offTotal = (inventory: UsageInventory) =>
  inventory.totals.reduce((sum, t) => sum + t.default + t.raw, 0);

/** The inventory in a line, for the step's card: the kinds most off the system. */
export const inventorySummary = (inventory: UsageInventory) => {
  const off = USAGE_KINDS.flatMap(({ kind, label }) => {
    const outside = offOf(inventory, kind);
    return outside > 0 ? [{ label: label.toLowerCase(), outside }] : [];
  }).sort((a, b) => b.outside - a.outside);
  if (off.length === 0) {
    return `${plural(inventory.files, "file")} read. Everything they use is the design system's.`;
  }
  const named = off
    .slice(0, SUMMARY_KINDS)
    .map((k) => `${k.outside} ${k.label}`)
    .join(", ");
  const rest = off.length - SUMMARY_KINDS;
  return `${plural(inventory.files, "file")} read. Most off the system: ${named}${rest > 0 ? `, and ${plural(rest, "kind")} more` : ""}.`;
};

/** The inventory as an agent is told it: the totals and the values most used off the system. */
export const inventoryBrief = (inventory: UsageInventory) => {
  const totals = USAGE_KINDS.flatMap(({ kind, label }) => {
    const t = inventory.totals.find((x) => x.kind === kind);
    return t && t.system + t.default + t.raw > 0
      ? [
          `- ${label}: ${t.system} the design system's, ${t.default} Tailwind's own, ${t.raw} written out`,
        ]
      : [];
  });
  const off = inventory.values
    .filter((v) => v.status !== "system")
    .slice(0, BRIEF_VALUES)
    .map(
      (v) =>
        `- ${v.kind} ${v.value} (${v.status === "raw" ? "written out" : "Tailwind's"}), ${v.count}× in ${plural(v.files, "file")}${v.token ? `, ${v.kind === "element" ? "the library has" : "is exactly"} ${v.token}` : ""}: ${v.examples.join(", ")}${v.locations[0] ? ` (${v.locations[0].file}:${v.locations[0].line})` : ""}`
    );
  return `The code, read against ${inventory.against === "saved" ? "the saved design system" : "the theme's tokens"} (${plural(inventory.files, "source file")}):
${totals.join("\n") || "- nothing"}
${off.length > 0 ? `Most used off the system:\n${off.join("\n")}` : "Nothing is off the system."}`;
};

/** The mapping a Map step starts from: every value off the system, the rules' decisions on them. */
export const mappingOf = (
  audit: UsageInventory,
  suggested: readonly UsageSuggestion[],
  at: number
): UsageMapping => {
  const rules = new Map(suggested.map((s) => [mappingKey(s.kind, s.value), s]));
  return {
    at,
    entries: audit.values
      .filter((v) => v.status !== "system")
      .sort((a, b) => b.count - a.count)
      .map((v): MappingEntry => {
        const rule = rules.get(mappingKey(v.kind, v.value));
        return {
          count: v.count,
          kind: v.kind,
          status: v.status === "raw" ? "raw" : "default",
          value: v.value,
          ...(v.examples[0] !== undefined && { example: v.examples[0] }),
          ...(v.locations[0] !== undefined && {
            where: `${v.locations[0].file}:${v.locations[0].line}`,
          }),
          ...(rule && { by: "rule", note: rule.note, target: rule.target }),
        };
      }),
  };
};

/** The mapping as a rewrite reads it: a target, or null for a value kept as it is. */
export const mappingTable = (mapping: UsageMapping) =>
  new Map(
    mapping.entries.flatMap((e): [string, string | null][] => {
      if (e.keep) {
        return [[mappingKey(e.kind, e.value), null]];
      }
      return e.target === undefined
        ? []
        : [[mappingKey(e.kind, e.value), e.target]];
    })
  );

export const mappingCounts = (mapping: UsageMapping) => ({
  byRule: mapping.entries.filter((e) => e.by === "rule" && e.target).length,
  decided: mapping.entries.filter((e) => e.target !== undefined).length,
  kept: mapping.entries.filter((e) => e.keep).length,
  undecided: mapping.entries.filter((e) => e.target === undefined && !e.keep)
    .length,
});

/** Why a target cannot be what a value of its kind becomes; null when it can. */
export const targetProblem = (
  kind: UsageKind,
  target: string,
  ds: DesignSystem,
  components: readonly string[]
): string | null => {
  if (kind === "spacing" && SPACING_STEP_RE.test(target)) {
    return null;
  }
  if (kind === "zIndex" && NUMBER_RE.test(target)) {
    return null;
  }
  const allowed = targetsOf(kind, ds, components);
  if (allowed.includes(target)) {
    return null;
  }
  const listed = allowed.slice(0, LISTED_TOKENS).join(", ");
  const more = allowed.length > LISTED_TOKENS ? ", …" : "";
  const what =
    kind === "element" ? "a component of the library" : `a ${kind} token`;
  const spacing =
    kind === "spacing"
      ? " A step of the scale is spacing-<n> (spacing-3)."
      : "";
  return `"${target}" is not ${what}${allowed.length > 0 ? `; there are ${listed}${more}` : ""}.${spacing}`;
};

/** The decisions taken on the mapping, with what could not be taken and why. */
export const applyChanges = (
  mapping: UsageMapping,
  changes: readonly MappingChange[],
  by: "agent" | "user",
  check: (kind: UsageKind, target: string) => string | null
) => {
  const problems: string[] = [];
  const decided = new Map<string, MappingChange>();
  const known = new Set(
    mapping.entries.map((e) => mappingKey(e.kind, e.value))
  );
  for (const change of changes) {
    const key = mappingKey(change.kind, change.value);
    if (!known.has(key)) {
      problems.push(
        `${change.kind} ${change.value} is not a value of the mapping: the task lists them.`
      );
      continue;
    }
    const problem =
      change.target === undefined ? null : check(change.kind, change.target);
    if (problem) {
      problems.push(`${change.kind} ${change.value}: ${problem}`);
      continue;
    }
    decided.set(key, change);
  }
  const entries = mapping.entries.map((entry): MappingEntry => {
    const change = decided.get(mappingKey(entry.kind, entry.value));
    if (!change) {
      return entry;
    }
    const {
      by: _by,
      keep: _keep,
      note: _note,
      target: _target,
      ...rest
    } = entry;
    const note = change.note === undefined ? {} : { note: change.note };
    if (change.target !== undefined) {
      return { ...rest, by, target: change.target, ...note };
    }
    return change.keep ? { ...rest, by, keep: true, ...note } : rest;
  });
  return { applied: decided.size, mapping: { ...mapping, entries }, problems };
};

/** Files cut into batches, a directory at a time, no batch bigger than `BATCH_FILES`. */
export const batchesOf = (
  files: readonly string[],
  dirOf: (file: string) => string
): MigrationBatch[] => {
  const byDir = new Map<string, string[]>();
  for (const file of [...files].sort()) {
    const dir = dirOf(file);
    byDir.set(dir, [...(byDir.get(dir) ?? []), file]);
  }
  const batches: MigrationBatch[] = [];
  for (const [dir, all] of [...byDir].sort(([a], [b]) => a.localeCompare(b))) {
    for (let i = 0; i < all.length; i += BATCH_FILES) {
      batches.push({
        dir,
        files: all.slice(i, i + BATCH_FILES),
        id: `batch-${batches.length + 1}`,
        status: "todo",
      });
    }
  }
  return batches;
};

/** What Verify says: the uses off the system when the mapping was made, and now. */
export const verifySummary = (
  audit: UsageInventory,
  mapping: UsageMapping | null
) => {
  const now = offTotal(audit);
  if (!mapping) {
    return `${plural(audit.files, "file")} read. ${plural(now, "use")} off the system.`;
  }
  const kept = new Set(
    mapping.entries
      .filter((e) => e.keep)
      .map((e) => mappingKey(e.kind, e.value))
  );
  const keptNow = audit.values
    .filter(
      (v) => v.status !== "system" && kept.has(mappingKey(v.kind, v.value))
    )
    .reduce((sum, v) => sum + v.count, 0);
  const before = mapping.entries.reduce((sum, e) => sum + e.count, 0);
  return `${plural(audit.files, "file")} read. Off the system: ${plural(before, "use")} when the mapping was made, ${now} now${keptNow > 0 ? `, ${keptNow} of them kept on purpose` : ""}.`;
};
