import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import { emptySetup } from "@ultrapaint/contracts/design-system-setup";
import {
  emptyDrift,
  type SyncBaseline,
  type SyncFacts,
} from "@ultrapaint/contracts/sync";
import {
  tokenKindOf,
  withTokenChanges,
} from "@ultrapaint/contracts/token-table";
import type { SourceToken } from "@ultrapaint/contracts/tokens";
import { describe, expect, it } from "vitest";
import {
  changesOf,
  matchProblem,
  namedDiffs,
  type SideToken,
  settledKeys,
} from "./services/sync-engine.ts";
import {
  caseOf,
  codeCounts,
  driftOf,
  planOf,
  summaryOf,
} from "./services/sync-plan.ts";
import {
  codeDirection,
  compareCode,
  compareDocument,
  compareFigma,
  designTokensOf,
  documentSideTokens,
  figmaBaselineAfter,
  figmaSide,
  matchFigma,
} from "./services/sync-readings.ts";

/** What a comparison takes into the design system once the user has picked. */
const tokenChanges = (
  ...args: Parameters<typeof changesOf>
): readonly unknown[] => changesOf(...args).toDesign;

/** What a code comparison comes to each way, as the code side writes it. */
const codeChanges = (...args: Parameters<typeof changesOf>) => {
  const { toDesign, toSource } = changesOf(...args);
  return { toCode: toSource, toDesign };
};

const facts: SyncFacts = {
  app: true,
  designSystem: false,
  libraryDirs: ["front/src/components"],
  styleSystem: "tailwind-v4",
  stylesheets: 1,
  tokens: 8,
};

const token = (name: string, own = true): SourceToken => ({
  kind: "color",
  name,
  own,
  value: "#000",
});

const ds: DesignSystem = {
  colors: [
    {
      name: "Semantic",
      tokens: [
        { name: "color-primary", value: "#000" },
        { name: "color-old", value: "#111" },
      ],
    },
  ],
  omitted: ["color-internal"],
  radius: [],
  shadows: [],
  spacing: { base: "0.25rem" },
  typography: { fonts: [], sizes: [], styles: [], weights: [] },
  version: 1,
};

describe("the sync's case", () => {
  it("is told from what the project has", () => {
    expect(caseOf({ ...facts, app: false })).toBe("scratch");
    expect(caseOf(facts)).toBe("code");
    expect(caseOf({ ...facts, figma: { id: "f", name: "App" } })).toBe(
      "figma-code"
    );
    expect(
      caseOf({ ...facts, app: false, figma: { id: "f", name: "App" } })
    ).toBe("figma");
    expect(caseOf({ ...facts, designSystem: true })).toBe("maintain");
  });
});

describe("drift between the design system and the code", () => {
  it("names what one side has and the other does not, leaving out what is omitted", () => {
    const drift = driftOf(
      ds,
      [
        token("color-primary"),
        token("color-new"),
        token("color-internal"),
        token("color-red-500", false),
      ],
      true
    );
    expect(drift).toEqual({
      // A token the code does not declare waits for an export (ADR 0028), it is not gone.
      tokensGone: [],
      tokensUndescribed: ["color-new"],
    });
  });

  it("says nothing is gone when the stylesheets could not be read", () => {
    expect(driftOf(ds, [], false).tokensGone).toEqual([]);
    expect(driftOf(null, [token("x")], true)).toEqual(emptyDrift);
  });
});

describe("the plan", () => {
  it("asks for nothing about components: the canvas draws the editor's system components", () => {
    const steps = planOf({
      drift: emptyDrift,
      facts: { ...facts, libraryDirs: [] },
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(steps.map((s) => s.kind)).not.toContain("settings");
  });

  it("goes through the setup for code, Figma's tokens first when there is a file", () => {
    const code = planOf({
      drift: emptyDrift,
      facts,
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(code.map((s) => s.kind)).toEqual([
      "inventory",
      "define",
      "map",
      "migrate",
      "verify",
    ]);
    expect(code.filter((s) => s.optional).map((s) => s.kind)).toEqual([
      "map",
      "migrate",
      "verify",
    ]);
    const figma = planOf({
      drift: emptyDrift,
      facts: { ...facts, figma: { id: "f", name: "App" } },
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(figma[0]).toMatchObject({
      kind: "figma-tokens",
      state: "attention",
    });
    expect(figma.at(-1)?.kind).toBe("import-frames");
  });

  it("keeps a design system in sync: describe what drifted, and Figma when there is a file", () => {
    const steps = planOf({
      drift: { ...emptyDrift, tokensUndescribed: ["color-new"] },
      facts: {
        ...facts,
        designMd: { held: 0, legacy: false, path: "DESIGN.md", unwritten: 0 },
        designSystem: true,
        figma: { id: "f", name: "App" },
      },
      figmaSynced: true,
      setup: emptySetup(0),
    });
    expect(steps.map((s) => [s.kind, s.state])).toEqual([
      ["describe", "attention"],
      ["figma-tokens", "done"],
      ["import-frames", "todo"],
    ]);
    expect(steps[0]?.detail).toContain(
      "1 token the design system does not list"
    );
    expect(summaryOf("maintain", steps)).toContain(
      "Next: describe what changed"
    );
    const quiet = planOf({
      drift: emptyDrift,
      facts: {
        ...facts,
        designMd: { held: 0, legacy: false, path: "DESIGN.md", unwritten: 0 },
        designSystem: true,
      },
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(summaryOf("maintain", quiet)).toContain("Nothing to do");
  });

  it("puts DESIGN.md at the root first: written when there is none, moved from the designs directory", () => {
    const none = planOf({
      drift: emptyDrift,
      facts: { ...facts, designSystem: true },
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(none.map((s) => [s.kind, s.title, s.state])).toEqual([
      ["design-md", "Write DESIGN.md", "attention"],
      ["describe", "Describe what changed", "done"],
    ]);
    const legacy = planOf({
      drift: emptyDrift,
      facts: {
        ...facts,
        designMd: {
          held: 0,
          legacy: true,
          path: "docs/designs/DESIGN.md",
          unwritten: 8,
        },
        designSystem: true,
      },
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(legacy[0]?.title).toBe("Move DESIGN.md to the repository root");
    expect(legacy[0]?.detail).toContain("docs/designs/DESIGN.md");
    const held = planOf({
      drift: emptyDrift,
      facts: {
        ...facts,
        designMd: { held: 3, legacy: false, path: "DESIGN.md", unwritten: 0 },
        designSystem: true,
      },
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(held[0]).toMatchObject({
      kind: "design-tokens",
      state: "attention",
      title: "Take DESIGN.md's tokens into the design system",
    });
    expect(held[0]?.detail).toContain("3 values of DESIGN.md");
    const prose = planOf({
      drift: emptyDrift,
      facts: {
        ...facts,
        designMd: { held: 0, legacy: false, path: "DESIGN.md", unwritten: 8 },
        designSystem: true,
      },
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(prose[0]).toMatchObject({ kind: "describe", state: "attention" });
    expect(prose[0]?.detail).toBe(
      "DESIGN.md has none of the format's sections written yet: an agent writes them, keeping what it says."
    );
  });
});

describe("matching Figma's tokens to the code's", () => {
  const code: SourceToken[] = [
    { kind: "color", name: "color-primary", own: true, value: "#2563eb" },
    { kind: "color", name: "color-muted", own: true, value: "#e5e7eb" },
    { kind: "radius", name: "radius-card", own: true, value: "0.5rem" },
  ];
  const figma: SideToken[] = [
    {
      id: "1:1",
      kind: "color",
      name: "color-brand-600",
      values: { "": "#2563eb" },
      variable: "Collection 1/Brand/600",
    },
    {
      alias: "Collection 1/Brand/600",
      id: "1:2",
      kind: "color",
      name: "color-action",
      values: { "": "#2563eb" },
      variable: "Semantic/Action",
    },
    {
      id: "1:3",
      kind: "radius",
      name: "radius-card",
      values: { "": "12px" },
      variable: "Radius/Card",
    },
    {
      id: "1:4",
      kind: "color",
      name: "color-danger",
      values: { "": "#dc2626" },
      variable: "Color/Danger/Danger",
    },
  ];

  it("takes the same name, the one value, and the semantic token over its palette entry", () => {
    const matched = matchFigma(figma, code, undefined);
    expect(Object.fromEntries(matched)).toEqual({
      // Two of Figma's have primary's value: the one pointing at the other takes it.
      "Collection 1/Brand/600": { by: "rule", to: null },
      "Radius/Card": { by: "rule", to: "radius-card" },
      "Semantic/Action": { by: "rule", to: "color-primary" },
    });
  });

  it("writes nothing of what is unmatched, and what was matched by hand wins", () => {
    const diffs = compareFigma(figma, code, null);
    expect(diffs.map((d) => [d.variable, d.name, d.outcome])).toEqual([
      ["Collection 1/Brand/600", "color-brand-600", "ignored"],
      ["Semantic/Action", "color-primary", "same"],
      ["Radius/Card", "radius-card", "conflict"],
      ["Color/Danger/Danger", "color-danger", "unmatched"],
    ]);
    expect(tokenChanges(diffs, [])).toEqual([]);

    const baseline: SyncBaseline = {
      at: 0,
      code: {},
      figma: {},
      file: "App",
      matches: {
        // Found by its place when Figma's id changed.
        "9:9": {
          by: "user",
          figma: "Color/Danger/Danger",
          to: "color-destructive",
        },
      },
    };
    const matched = compareFigma(figma, code, baseline);
    expect(matched.at(-1)).toMatchObject({
      by: "user",
      name: "color-destructive",
      outcome: "to-design",
    });
    expect(tokenChanges(matched, [])).toEqual([
      { name: "color-destructive", value: "#dc2626" },
    ]);
  });

  it("keeps in the baseline what the user settled, and leaves an unpicked conflict open", () => {
    const diffs = compareFigma(figma, code, null);
    const picks = [{ name: "radius-card", take: "design" as const }];
    const baseline = figmaBaselineAfter({
      at: 1,
      baseline: null,
      design: code,
      diffs,
      file: "App",
      settled: settledKeys(diffs, picks),
      side: figmaSide(figma, code, null),
    });
    // Figma keeps its 12px; the design system its 0.5rem: the difference is what was agreed.
    expect(baseline.code["radius-card"]).toBe("0.5rem");
    expect(baseline.figma["radius-card"]).toBe("12px");
    expect(baseline.matches?.["1:2"]).toEqual({
      by: "rule",
      figma: "Semantic/Action",
      to: "color-primary",
    });
    expect(baseline.matches?.["1:4"]).toBeUndefined();
    const again = compareFigma(figma, code, baseline);
    expect(again.find((d) => d.name === "radius-card")?.outcome).toBe(
      "source-behind"
    );
    const open = figmaBaselineAfter({
      at: 1,
      baseline: null,
      design: code,
      diffs,
      file: "App",
      settled: settledKeys(diffs, []),
      side: figmaSide(figma, code, null),
    });
    expect(open.figma["radius-card"]).toBeUndefined();
    expect(
      compareFigma(figma, code, open).find((d) => d.name === "radius-card")
        ?.outcome
    ).toBe("conflict");
  });

  it("only matches a name of the token's kind", () => {
    const brand = figma[0] as SideToken;
    expect(matchProblem(brand, "color-brand")).toBeNull();
    expect(matchProblem(brand, "radius-card")).toContain("names a radius one");
    expect(matchProblem(brand, "Brand Blue")).toContain("not a token name");
  });
});

describe("DESIGN.md's tokens against the code's (ADR 0027)", () => {
  const code: SourceToken[] = [
    { kind: "color", name: "color-brand", own: true, value: "#2563eb" },
    { kind: "color", name: "color-ink", own: true, value: "#111111" },
    { kind: "radius", name: "radius-card", own: true, value: "0.75rem" },
  ];
  const side = documentSideTokens([
    {
      kind: "color",
      name: "color-primary",
      value: "#2563eb",
      variable: "colors.primary",
    },
    {
      kind: "color",
      name: "color-ink",
      value: "#000000",
      variable: "colors.ink",
    },
    {
      kind: "color",
      name: "color-tertiary",
      value: "#b8422e",
      variable: "colors.tertiary",
    },
    {
      kind: "radius",
      name: "radius-card",
      value: "1rem",
      variable: "rounded.card",
    },
  ]);

  it("matches by name and by the one value, and with nothing agreed, asks where they differ", () => {
    const diffs = compareDocument(side, code, null);
    expect(diffs.map((d) => [d.variable, d.name, d.outcome])).toEqual([
      ["colors.primary", "color-brand", "same"],
      ["colors.ink", "color-ink", "conflict"],
      ["colors.tertiary", "color-tertiary", "unmatched"],
      ["rounded.card", "radius-card", "conflict"],
    ]);
  });

  it("takes what the document changed alone, by what was agreed, and the matches it keeps", () => {
    const diffs = compareDocument(side, code, {
      agreed: { "colors.ink": "#111111", "rounded.card": "0.5rem" },
      at: 1,
      matches: { "colors.tertiary": { by: "user", to: "color-accent" } },
    });
    expect(diffs.map((d) => [d.variable, d.name, d.outcome])).toEqual([
      ["colors.primary", "color-brand", "same"],
      ["colors.ink", "color-ink", "to-design"],
      ["colors.tertiary", "color-accent", "to-design"],
      ["rounded.card", "radius-card", "conflict"],
    ]);
    expect(
      tokenChanges(diffs, [{ name: "radius-card", take: "source" }])
    ).toEqual([
      { name: "color-ink", value: "#000000" },
      { name: "color-accent", value: "#b8422e" },
      { name: "radius-card", value: "1rem" },
    ]);
  });

  it("lists the tokens the code was given, colours in the semantic group", () => {
    const system: DesignSystem = {
      ...emptyDesignSystem(),
      colors: [
        { name: "Blue", tokens: [] },
        {
          name: "Semantic",
          tokens: [{ name: "color-brand", value: "#2563eb" }],
        },
      ],
    };
    const listed = withTokenChanges(system, [
      { name: "color-accent", value: "#b8422e" },
      { name: "radius-pill", value: "9999px" },
    ]);
    expect(listed.colors[1]?.tokens.map((t) => t.name)).toEqual([
      "color-brand",
      "color-accent",
    ]);
    expect(listed.radius).toEqual([{ name: "radius-pill", value: "9999px" }]);
  });
});

describe("the code against the design system (ADR 0028)", () => {
  const code = (name: string, value: string, own = true): SourceToken => ({
    kind: tokenKindOf(name),
    name,
    own,
    value,
  });
  const design = (name: string, value: string) => code(name, value);

  it("says which side each token waits for, against what the two agreed", () => {
    const diffs = compareCode(
      [
        code("color-same", "#000"),
        code("color-design", "#111"),
        code("color-code", "#999"),
        code("color-both", "#555"),
        code("color-new", "#abc"),
        code("color-omitted", "#def"),
        code("color-red-500", "#f00", false),
        code("spacing", "0.25rem", false),
      ],
      [
        design("color-same", "#000"),
        design("color-design", "#222"),
        design("color-code", "#333"),
        design("color-both", "#666"),
        design("color-only", "#777"),
        design("color-red-500", "#f00"),
        design("spacing", "0.25rem"),
      ],
      {
        agreed: {
          "color-both": "#444",
          "color-code": "#333",
          "color-design": "#111",
        },
        at: 1,
      },
      new Set(["color-omitted"])
    );
    expect(Object.fromEntries(diffs.map((d) => [d.name, d.outcome]))).toEqual({
      "color-both": "conflict",
      "color-code": "to-design",
      "color-design": "source-behind",
      "color-new": "to-design",
      "color-omitted": "ignored",
      "color-only": "source-behind",
      // A style system's default the design system names is not waiting for the code.
      "color-red-500": "same",
      "color-same": "same",
      spacing: "same",
    });
    expect(codeCounts(diffs)).toEqual({
      conflicts: 1,
      toCode: 2,
      toDesign: 2,
    });

    const { toCode, toDesign } = codeChanges(diffs, [
      { name: "color-both", take: "design" },
    ]);
    expect(toCode).toEqual([
      { name: "color-both", value: "#666" },
      { name: "color-design", value: "#222" },
      { name: "color-only", value: "#777" },
    ]);
    expect(toDesign).toEqual([
      { name: "color-code", value: "#999" },
      { name: "color-new", value: "#abc" },
    ]);
    expect(codeChanges(diffs, [], "import").toCode).toEqual([]);
    expect(codeChanges(diffs, [], "export").toDesign).toEqual([]);
  });

  it("takes what an agent names one way, conflicts included, and leaves the rest of them to the user", () => {
    const diffs = compareCode(
      [code("color-a", "#111"), code("color-b", "#999")],
      [
        { ...design("color-a", "#222"), values: { dark: "#000" } },
        design("color-b", "#888"),
      ],
      { agreed: { "color-a": "#111", "color-b": "#777" }, at: 1 },
      new Set()
    );
    // Asked for nothing by name, the conflicts stay the user's.
    const all = codeDirection(diffs, "export", []);
    expect(all.decisions).toEqual([]);
    expect(all.left.map((d) => d.name)).toEqual(["color-b"]);
    // Named, a conflict is taken that way; a theme can be named alone.
    const named = codeDirection(diffs, "import", ["color-b", "color-x"]);
    expect(named.decisions).toEqual([{ name: "color-b", take: "source" }]);
    expect(named.left).toEqual([]);
    expect(named.unknown).toEqual(["color-x"]);
    expect(namedDiffs(diffs, ["color-a@dark"]).map((d) => d.theme)).toEqual([
      "dark",
    ]);
    expect(namedDiffs(diffs, ["color-a"])).toHaveLength(2);
    const { toCode } = codeChanges(
      namedDiffs(diffs, ["color-b"]),
      codeDirection(diffs, "export", ["color-b"]).decisions,
      "export"
    );
    expect(toCode).toEqual([{ name: "color-b", value: "#888" }]);
  });

  it("changes a design system's tokens, adding the new ones where they belong", () => {
    const next = withTokenChanges(ds, [
      { name: "color-primary", value: "#123456" },
      { name: "color-primary", theme: "dark", value: "#654321" },
      { name: "color-fresh", value: "#0f0" },
      { name: "radius-pill", value: "999px" },
      { name: "spacing", value: "0.3rem" },
    ]);
    const tokens = designTokensOf(next);
    const byName = new Map(tokens.map((t) => [t.name, t]));
    expect(byName.get("color-primary")).toMatchObject({
      value: "#123456",
      values: { dark: "#654321" },
    });
    expect(byName.get("color-fresh")?.value).toBe("#0f0");
    expect(byName.get("radius-pill")?.value).toBe("999px");
    expect(next.spacing.base).toBe("0.3rem");
    const removed = withTokenChanges(next, [
      { name: "color-fresh", remove: true },
    ]);
    expect(designTokensOf(removed).map((t) => t.name)).not.toContain(
      "color-fresh"
    );
  });

  it("lists a new token of any kind where its kind goes, not only colours, radii and spacing", () => {
    // A token only design.tokens.json has, or one set through setTokens, Figma or DESIGN.md.
    const next = withTokenChanges(ds, [
      { name: "text-xl", value: "1.25rem" },
      { name: "shadow-lg", value: "0 10px 15px rgb(0 0 0 / 0.1)" },
      { name: "font-weight-bold", value: "700" },
      { name: "ease-out", value: "cubic-bezier(0, 0, 0.2, 1)" },
      { name: "breakpoint-xl", value: "80rem" },
      { name: "shadow-lg", theme: "dark", value: "none" },
    ]);
    expect(next.typography.sizes.map((t) => t.name)).toContain("text-xl");
    expect(next.typography.weights.map((t) => t.name)).toContain(
      "font-weight-bold"
    );
    expect(next.shadows.at(-1)).toEqual({
      name: "shadow-lg",
      value: "0 10px 15px rgb(0 0 0 / 0.1)",
      values: { dark: "none" },
    });
    expect(next.motion?.easings?.map((t) => t.name)).toEqual(["ease-out"]);
    expect(next.layout?.breakpoints?.map((t) => t.name)).toEqual([
      "breakpoint-xl",
    ]);
    const side = new Map(designTokensOf(next).map((t) => [t.name, t]));
    expect(side.get("text-xl")).toMatchObject({
      kind: "fontSize",
      value: "1.25rem",
    });
    expect(side.get("font-weight-bold")?.kind).toBe("fontWeight");
  });
});
