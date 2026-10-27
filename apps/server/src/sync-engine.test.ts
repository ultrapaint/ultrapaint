import { type Agreed, agreedOn } from "@ultrapaint/contracts/agreement";
import { baselineKey } from "@ultrapaint/contracts/sync";
import { tokenKindOf } from "@ultrapaint/contracts/token-table";
import type { SourceToken } from "@ultrapaint/contracts/tokens";
import { describe, expect, it } from "vitest";
import {
  agreementAfter,
  changesOf,
  compareSide,
  matchEntries,
  type Side,
  type SideToken,
  settledKeys,
} from "./services/sync-engine.ts";

const design = (name: string, value: string, dark?: string): SourceToken => ({
  kind: tokenKindOf(name),
  name,
  own: true,
  value,
  ...(dark !== undefined && { values: { dark } }),
});

const sideToken = (name: string, value: string): SideToken => ({
  kind: tokenKindOf(name),
  name,
  values: { "": value },
  variable: `Side/${name}`,
});

/**
 * A side that is no side of the product's: its tokens matched to the design's of their name,
 * except those it says, and what the two agreed kept as two values, as Figma's baseline is.
 */
const fakeSide = (
  tokens: readonly SideToken[],
  agreed: Readonly<Record<string, Agreed>>,
  options: {
    readonly ignored?: readonly string[];
    readonly unmatched?: readonly string[];
    readonly waits?: boolean;
  } = {}
): Side => ({
  agreed: (name, theme) =>
    agreed[baselineKey(name, theme || undefined)] ?? null,
  matches: new Map(
    tokens
      .filter((t) => !options.unmatched?.includes(t.name))
      .map((t) => [
        t.variable,
        {
          by: "rule" as const,
          to: options.ignored?.includes(t.name) ? null : t.name,
        },
      ])
  ),
  tokens,
  ...(options.waits && { waitsFor: () => true }),
});

const both = (value: string): Agreed => ({ design: value, source: value });

describe("the sync engine, with a side of its own", () => {
  const ours = [
    design("color-same", "#000"),
    design("color-here", "#111"),
    design("color-there", "#2b7fff"),
    design("color-both", "#333"),
    design("color-unsettled", "#444"),
    design("color-design-only", "#555"),
    design("color-kept", "#666"),
    design("color-removed", "#999"),
    design("radius-card", "0.75rem"),
  ];
  const theirs = [
    sideToken("color-same", "#000"),
    sideToken("color-here", "#aaa"),
    sideToken("color-there", "#222"),
    sideToken("color-both", "#bbb"),
    sideToken("color-unsettled", "#ccc"),
    sideToken("color-new", "#ddd"),
    sideToken("color-kept", "#eee"),
    sideToken("color-gone", "#f00"),
    sideToken("color-left-out", "#0f0"),
    sideToken("color-open", "#00f"),
    sideToken("radius-card", "16px"),
  ];
  const agreed: Record<string, Agreed> = {
    "color-both": both("#300"),
    "color-gone": both("#f00"),
    "color-here": both("#111"),
    // The user kept the design's last time: Figma still has its own.
    "color-kept": { design: "#666", source: "#eee" },
    "color-removed": both("#999"),
    "color-there": both("#222"),
    "radius-card": both("0.75rem"),
  };
  const side = fakeSide(theirs, agreed, {
    ignored: ["color-left-out"],
    unmatched: ["color-open"],
    waits: true,
  });
  const diffs = compareSide(side, ours);
  const outcomes = Object.fromEntries(diffs.map((d) => [d.name, d.outcome]));

  it("says what every value comes to, against what the two agreed", () => {
    expect(outcomes).toEqual({
      // Changed on both sides since they agreed, or never agreed and different.
      "color-both": "conflict",
      // Only the design system has it, and the side waits for it.
      "color-design-only": "source-behind",
      // The design system took it out after they agreed, and the side did not change it.
      "color-gone": "source-behind",
      // Changed on the side alone.
      "color-here": "to-design",
      // A difference the user settled last time stays settled.
      "color-kept": "source-behind",
      "color-left-out": "ignored",
      // New on the side, nothing agreed.
      "color-new": "to-design",
      "color-open": "unmatched",
      // The side took it out: it gets the design's back.
      "color-removed": "source-behind",
      "color-same": "same",
      "color-there": "source-behind",
      "color-unsettled": "conflict",
      // 16px is not the 0.75rem they agreed on.
      "radius-card": "to-design",
    });
    expect(diffs.find((d) => d.name === "color-here")).toMatchObject({
      base: "#111",
      by: "rule",
      design: "#111",
      source: "#aaa",
      variable: "Side/color-here",
    });
  });

  it("lists a side's own values only, unless it waits for the design system's", () => {
    const own = compareSide(fakeSide(theirs, agreed), ours);
    expect(own.map((d) => d.name)).not.toContain("color-design-only");
    expect(own.map((d) => d.name)).not.toContain("color-removed");
    expect(own.map((d) => d.variable)).toEqual(theirs.map((t) => t.variable));
  });

  it("compares theme by theme", () => {
    const themed = compareSide(
      fakeSide(
        [
          {
            ...sideToken("color-ink", "#000"),
            values: { "": "#000", dark: "#eee" },
          },
        ],
        { "color-ink@dark": both("#fff") },
        { waits: true }
      ),
      [design("color-ink", "#000", "#fff"), design("color-paper", "#fff")]
    );
    expect(themed.map((d) => [d.name, d.theme, d.outcome])).toEqual([
      ["color-ink", undefined, "same"],
      ["color-ink", "dark", "to-design"],
      ["color-paper", undefined, "source-behind"],
    ]);
  });

  it("comes to the changes the user's picks make, each way, one way when asked", () => {
    const picks = [
      { name: "color-both", take: "source" as const },
      { name: "color-unsettled", take: "design" as const },
    ];
    const { toDesign, toSource } = changesOf(diffs, picks);
    expect(toDesign).toEqual([
      { name: "color-both", value: "#bbb" },
      { name: "color-here", value: "#aaa" },
      { name: "color-new", value: "#ddd" },
      // In the design system's units.
      { name: "radius-card", value: "1rem" },
    ]);
    expect(toSource).toEqual([
      { name: "color-design-only", value: "#555" },
      { name: "color-gone", remove: true },
      { name: "color-kept", value: "#666" },
      { name: "color-removed", value: "#999" },
      { name: "color-there", value: "#2b7fff" },
      { name: "color-unsettled", value: "#444" },
    ]);
    expect(changesOf(diffs, picks, "import").toSource).toEqual([]);
    expect(changesOf(diffs, picks, "export").toDesign).toEqual([]);
  });

  it("takes the first of two of a side's tokens matched to one", () => {
    const twice: Side = {
      agreed: () => null,
      matches: new Map([
        ["A", { by: "user", to: "color-new" }],
        ["B", { by: "user", to: "color-new" }],
      ]),
      tokens: [
        { ...sideToken("color-a", "#111"), variable: "A" },
        { ...sideToken("color-b", "#222"), variable: "B" },
      ],
    };
    expect(changesOf(compareSide(twice, []), []).toDesign).toEqual([
      { name: "color-new", value: "#111" },
    ]);
  });

  it("moves the baseline forward: what they share, a settled difference, an open conflict as it was", () => {
    const picks = [{ name: "color-both", take: "source" as const }];
    const { toDesign } = changesOf(diffs, picks);
    const settled = settledKeys(diffs, picks);
    expect(settled.has("color-unsettled")).toBe(false);
    expect(settled.has("color-open")).toBe(false);
    expect(settled.has("color-there")).toBe(true);
    // The design system takes the changes; the side, never written, stays as it is.
    const now = new Map(ours.map((t) => [t.name, t.value]));
    for (const change of toDesign) {
      now.set(change.name, change.value ?? "");
    }
    const designNow = Object.fromEntries(now);
    const sourceNow = Object.fromEntries(
      diffs.flatMap((d) =>
        d.source !== undefined &&
        d.outcome !== "unmatched" &&
        d.outcome !== "ignored"
          ? [[d.name, d.source] as const]
          : []
      )
    );
    const next = agreementAfter({
      design: designNow,
      keys: diffs
        .filter((d) => d.outcome !== "unmatched" && d.outcome !== "ignored")
        .map((d) => d.name),
      previous: (key) => agreed[key] ?? null,
      settled,
      source: sourceNow,
    });
    expect(next["color-both"]).toEqual({ design: "#bbb", source: "#bbb" });
    expect(next["color-there"]).toEqual({ design: "#2b7fff", source: "#222" });
    expect(next["color-unsettled"]).toBeUndefined();
    expect(next["color-gone"]).toEqual({ source: "#f00" });

    // Compared again, nothing is asked twice: what was taken is the same, what was settled
    // stays behind, and the conflict nobody picked is still the user's.
    const again = compareSide(
      fakeSide(theirs, next, {
        ignored: ["color-left-out"],
        unmatched: ["color-open"],
      }),
      Object.entries(designNow).map(([name, value]) => design(name, value))
    );
    expect(
      Object.fromEntries(
        again
          .filter((d) => d.outcome !== "same")
          .map((d) => [d.name, d.outcome])
      )
    ).toEqual({
      "color-gone": "source-behind",
      "color-kept": "source-behind",
      "color-left-out": "ignored",
      "color-open": "unmatched",
      "color-there": "source-behind",
      "color-unsettled": "conflict",
    });
  });

  it("keeps one value where a baseline has room for one: what both hold, or what was agreed", () => {
    const next = agreementAfter({
      design: { "color-a": "#111", "color-b": "#222", "color-c": "#333" },
      previous: (key) =>
        agreedOn({ "color-b": "#200", "color-x": "#999" }[key]),
      source: { "color-a": "#111", "color-b": "#2b2b2b", "color-d": "#444" },
    });
    expect(next).toEqual({
      "color-a": { design: "#111", source: "#111" },
      "color-b": { design: "#200", source: "#200" },
    });
  });

  it("checks the matches it is given against the side's tokens", () => {
    const { problems, set } = matchEntries(
      theirs,
      [
        { to: "color-accent", variable: "Side/color-open" },
        { to: "radius-accent", variable: "Side/color-new" },
        { variable: "Side/color-here" },
        { to: "color-x", variable: "Side/nothing" },
      ],
      "user",
      "a token of the side"
    );
    expect([...set].map(([variable, { match }]) => [variable, match])).toEqual([
      ["Side/color-open", { by: "user", to: "color-accent" }],
      ["Side/color-here", undefined],
    ]);
    expect(problems).toEqual([
      "Side/color-new is a color token and radius-accent names a radius one",
      "Side/nothing is not a token of the side",
    ]);
  });
});
