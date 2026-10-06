import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { emptySetup } from "@ultrapaint/contracts/design-system-setup";
import { emptyDrift, type SyncFacts } from "@ultrapaint/contracts/sync";
import type { SourceToken } from "@ultrapaint/contracts/tokens";
import { describe, expect, it } from "vitest";
import {
  caseOf,
  driftOf,
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
      facts: { ...facts, designSystem: true, figma: { id: "f", name: "App" } },
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
      facts: { ...facts, designSystem: true },
      figmaSynced: false,
      setup: emptySetup(0),
    });
    expect(summaryOf("maintain", quiet)).toContain("Nothing to do");
  });
});
