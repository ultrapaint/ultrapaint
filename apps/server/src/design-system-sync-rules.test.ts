import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { emptySetup } from "@ultrapaint/contracts/design-system-setup";
import {
  emptyDrift,
  type SyncBaseline,
  type SyncFacts,
} from "@ultrapaint/contracts/sync";
import type { SourceToken } from "@ultrapaint/contracts/tokens";
import { describe, expect, it } from "vitest";
import {
  caseOf,
  compareFigma,
  driftOf,
  type FigmaSide,
  figmaChanges,
  matchFigma,
  matchProblem,
  planOf,
  summaryOf,
} from "./services/design-system-sync-rules.ts";

const facts: SyncFacts = {
  app: true,
  components: 12,
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
  components: { Button: {}, Gone: {} },
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
      ["Button", "Card"],
      true
    );
    expect(drift).toEqual({
      componentsGone: ["Gone"],
      componentsUndescribed: ["Card"],
      tokensGone: ["color-old"],
      tokensUndescribed: ["color-new"],
    });
  });

  it("says nothing is gone when the stylesheets could not be read", () => {
    expect(driftOf(ds, [], [], false).tokensGone).toEqual([]);
    expect(driftOf(null, [token("x")], ["A"], true)).toEqual(emptyDrift);
  });
});

describe("the plan", () => {
  it("asks for the settings first when no component is found", () => {
    const steps = planOf({
      drift: emptyDrift,
      facts: { ...facts, components: 0, libraryDirs: [] },
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(steps[0]).toMatchObject({ kind: "settings", state: "attention" });
    expect(steps[0]?.detail).toContain("no component directory is set");
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
        designMd: { held: 0, legacy: false, path: "DESIGN.md" },
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
        designMd: { held: 0, legacy: false, path: "DESIGN.md" },
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
        designMd: { held: 0, legacy: true, path: "docs/designs/DESIGN.md" },
        designSystem: true,
      },
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(legacy[0]?.title).toBe("Move DESIGN.md to the repository root");
    expect(legacy[0]?.detail).toContain("docs/designs/DESIGN.md");
  });
});

describe("matching Figma's tokens to the code's", () => {
  const code: SourceToken[] = [
    { kind: "color", name: "color-primary", own: true, value: "#2563eb" },
    { kind: "color", name: "color-muted", own: true, value: "#e5e7eb" },
    { kind: "radius", name: "radius-card", own: true, value: "0.5rem" },
  ];
  const figma: FigmaSide[] = [
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
    expect(figmaChanges(diffs, [])).toEqual([]);

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
      outcome: "to-code",
    });
    expect(figmaChanges(matched, [])).toEqual([
      { name: "color-destructive", value: "#dc2626" },
    ]);
  });

  it("only matches a name of the token's kind", () => {
    const brand = figma[0] as FigmaSide;
    expect(matchProblem(brand, "color-brand")).toBeNull();
    expect(matchProblem(brand, "radius-card")).toContain("names a radius one");
    expect(matchProblem(brand, "Brand Blue")).toContain("not a token name");
  });
});
