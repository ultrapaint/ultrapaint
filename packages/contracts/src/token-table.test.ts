import { describe, expect, it } from "vitest";
import { type DesignSystem, emptyDesignSystem } from "./design-system.ts";
import {
  addTokens,
  allTokens,
  DEFAULT_SPACING_BASE,
  fillValues,
  layValues,
  lineHeightName,
  listedTokens,
  mapTokenRecords,
  removeTokens,
  SPACING_BASE,
  SPACING_STEPS,
  shortName,
  spacingBasePx,
  spacingLength,
  spacingStepAt,
  spacingStepName,
  spacingStepOf,
  stripValues,
  TOKEN_TABLE,
  tokenChangesBetween,
  tokenKindOf,
  tokenOf,
  tokenPrefix,
  tokensByValue,
  tokensOfKind,
  withEmptyValues,
  withTokenChanges,
} from "./token-table.ts";

/** The tokens at a path of the table, every colour group's for `*`. */
const at = (ds: unknown, path: readonly string[]): unknown[] => {
  const [key, ...more] = path;
  if (key === undefined) {
    return Array.isArray(ds) ? ds : [];
  }
  if (key === "*") {
    return Array.isArray(ds) ? ds.flatMap((n) => at(n, more)) : [];
  }
  return typeof ds === "object" && ds !== null
    ? at((ds as Record<string, unknown>)[key], more)
    : [];
};

const nameOf = (kind: string) =>
  `${tokenPrefix(kind as Parameters<typeof tokenPrefix>[0])}x`;

/** A design system with one token of every kind, `<prefix>x`, valued `1`. */
const full = TOKEN_TABLE.reduce<DesignSystem>(
  (ds, entry) => addTokens(ds, [{ name: nameOf(entry.kind), value: "1" }]),
  emptyDesignSystem()
);

describe("the token table", () => {
  it.each(TOKEN_TABLE.map((e) => [e.kind, e] as const))(
    "names %s tokens by every prefix it has",
    (kind, entry) => {
      for (const prefix of entry.prefixes) {
        expect(tokenKindOf(`${prefix}sm`)).toBe(kind);
      }
      expect(tokenPrefix(kind)).toBe(entry.prefixes[0]);
    }
  );

  it("tries the longest prefix first, and knows the spacing base and the rest", () => {
    expect(tokenKindOf("font-weight-bold")).toBe("fontWeight");
    expect(tokenKindOf("font-sans")).toBe("font");
    expect(tokenKindOf("text-shadow-sm")).toBe("shadow");
    expect(tokenKindOf("text-sm")).toBe("fontSize");
    expect(tokenKindOf("default-transition-duration")).toBe("duration");
    expect(tokenKindOf(SPACING_BASE)).toBe("spacing");
    expect(tokenKindOf("z-modal")).toBe("other");
    expect(tokenPrefix("other")).toBe("");
  });

  it.each(TOKEN_TABLE.map((e) => [e.kind, e] as const))(
    "adds, sets and takes out a %s token in its list",
    (_kind, entry) => {
      const name = nameOf(entry.kind);
      const added = withTokenChanges(emptyDesignSystem(), [
        { name, value: "2" },
        { name, theme: "dark", value: "3" },
      ]);
      expect(at(added, entry.list)).toEqual([
        { name, value: "2", values: { dark: "3" } },
      ]);

      const set = withTokenChanges(full, [
        { name, value: "4" },
        { name, theme: "dark", value: "5" },
      ]);
      expect(at(set, entry.list)).toEqual([
        { name, value: "4", values: { dark: "5" } },
      ]);
      const others = (ds: DesignSystem) =>
        listedTokens(ds).filter((t) => t.name !== name);
      expect(others(set)).toEqual(others(full));

      const gone = withTokenChanges(set, [{ name, remove: true }]);
      expect(at(gone, entry.list)).toEqual([]);
      expect(others(gone)).toEqual(others(full));
      const themeGone = withTokenChanges(set, [
        { name, remove: true, theme: "dark" },
      ]);
      expect(at(themeGone, entry.list)).toEqual([
        { name, value: "4", values: {} },
      ]);
    }
  );

  it("puts a new colour in the semantic group, the first, or a group of its own", () => {
    const groups: DesignSystem = {
      ...emptyDesignSystem(),
      colors: [
        { name: "Blue", tokens: [] },
        { name: "Semantic", tokens: [{ name: "color-brand", value: "#00f" }] },
      ],
    };
    const accent = [{ name: "color-accent", value: "#f00" }];
    expect(addTokens(groups, accent).colors[1]?.tokens).toEqual([
      { name: "color-brand", value: "#00f" },
      ...accent,
    ]);
    expect(
      addTokens({ ...groups, colors: [{ name: "Blue", tokens: [] }] }, accent)
        .colors
    ).toEqual([{ name: "Blue", tokens: accent }]);
    expect(addTokens(emptyDesignSystem(), accent).colors).toEqual([
      { name: "Colors", tokens: accent },
    ]);
  });

  it("leaves out a token of no kind, and needs a default value to add one", () => {
    const ds = withTokenChanges(emptyDesignSystem(), [
      { name: "z-modal", value: "50" },
      { name: "radius-lg", theme: "dark", value: "1rem" },
    ]);
    expect(listedTokens(ds)).toEqual([]);
  });

  it("keeps the spacing base as `spacing`: set, never taken out, first of all", () => {
    const ds = withTokenChanges(full, [
      { name: SPACING_BASE, value: "0.3rem" },
      { name: SPACING_BASE, theme: "dark", value: "1rem" },
    ]);
    expect(ds.spacing.base).toBe("0.3rem");
    expect(
      withTokenChanges(ds, [{ name: SPACING_BASE, remove: true }]).spacing.base
    ).toBe("0.3rem");
    expect(
      addTokens(ds, [{ name: SPACING_BASE, value: "4px" }]).spacing
    ).toEqual({ ...ds.spacing, base: "4px" });
    expect(allTokens(ds)[0]).toEqual({ name: SPACING_BASE, value: "0.3rem" });
    expect(listedTokens(ds).map((t) => t.name)).not.toContain(SPACING_BASE);
  });

  it("flattens every token once, with its themes' values and its own fields", () => {
    const ds: DesignSystem = {
      ...full,
      typography: {
        ...full.typography,
        sizes: [{ lineHeight: "1.5", name: "text-x", value: "1rem" }],
      },
    };
    const shadowed = addTokens(
      withTokenChanges(ds, [{ name: "color-x", theme: "dark", value: "#000" }]),
      [{ name: "color-x", value: "again" }]
    );
    const flat = allTokens(shadowed);
    expect(flat.map((t) => t.name)).toEqual([
      SPACING_BASE,
      ...TOKEN_TABLE.map((e) => nameOf(e.kind)),
    ]);
    expect(flat.find((t) => t.name === "color-x")).toEqual({
      name: "color-x",
      value: "1",
      values: { dark: "#000" },
    });
    expect(flat.find((t) => t.name === "text-x")?.lineHeight).toBe("1.5");
    expect(lineHeightName("text-x")).toBe("text-x--line-height");
  });

  it("takes tokens out by name wherever they are listed", () => {
    const names = new Set(["color-x", "ease-x", "font-x"]);
    const left = removeTokens(full, names).spacing;
    expect(left).toEqual(full.spacing);
    expect(listedTokens(removeTokens(full, names)).map((t) => t.name)).toEqual(
      TOKEN_TABLE.map((e) => nameOf(e.kind)).filter((n) => !names.has(n))
    );
  });
});

describe("the changes between two design systems", () => {
  it("says every value set, theme taken out and token taken out, the spacing base too", () => {
    const before = withTokenChanges(emptyDesignSystem(), [
      { name: "color-ink", value: "#111" },
      { name: "color-ink", theme: "dark", value: "#eee" },
      { name: "radius-md", value: "4px" },
      { name: "color-line", value: "#ccc" },
    ]);
    const after = withTokenChanges(before, [
      { name: "color-ink", value: "#000" },
      { name: "color-ink", remove: true, theme: "dark" },
      { name: "radius-md", remove: true },
      { name: "radius-lg", value: "8px" },
      { name: "radius-lg", theme: "dark", value: "6px" },
      { name: SPACING_BASE, value: "0.5rem" },
    ]);
    expect(tokenChangesBetween(before, after)).toEqual([
      { name: SPACING_BASE, value: "0.5rem" },
      { name: "color-ink", value: "#000" },
      { name: "color-ink", remove: true, theme: "dark" },
      { name: "radius-lg", value: "8px" },
      { name: "radius-lg", theme: "dark", value: "6px" },
      { name: "radius-md", remove: true },
    ]);
    expect(tokenChangesBetween(after, after)).toEqual([]);
  });
});

describe("a design system's values", () => {
  const themed = withTokenChanges(full, [
    { name: "radius-x", theme: "dark", value: "2" },
  ]);

  it("strips every value and the spacing base, and reads them back as empty", () => {
    const stripped = stripValues(themed);
    expect(stripped.spacing).toEqual({ tokens: [{ name: "spacing-x" }] });
    expect(at(stripped, ["radius"])).toEqual([{ name: "radius-x" }]);
    mapTokenRecords(stripped, (t) => {
      expect(t).not.toHaveProperty("value");
      return t;
    });
    const empty = withEmptyValues(stripped) as DesignSystem;
    expect(empty.spacing.base).toBe("");
    expect(allTokens(empty).every((t) => t.value === "")).toBe(true);
  });

  it("lays values over a design system: theirs win, an empty one does not count", () => {
    const laid = layValues(themed, [
      { name: "radius-x", value: "9", values: { dark: "" } },
      { name: "shadow-new", value: "none", values: { dark: "0 0 1px" } },
      { name: "color-x", value: "" },
      { name: SPACING_BASE, value: "2px" },
    ]);
    const byName = new Map(allTokens(laid).map((t) => [t.name, t]));
    expect(byName.get("radius-x")).toEqual({
      name: "radius-x",
      value: "9",
      values: { dark: "2" },
    });
    expect(byName.get("color-x")?.value).toBe("1");
    expect(laid.shadows.at(-1)).toEqual({
      name: "shadow-new",
      value: "none",
      values: { dark: "0 0 1px" },
    });
    expect(laid.spacing.base).toBe("2px");
  });

  it("fills only the values left empty, the spacing base's too", () => {
    const empty = withEmptyValues(stripValues(themed)) as DesignSystem;
    const known = new Map(allTokens(themed).map((t) => [t.name, t]));
    const filled = fillValues(
      {
        ...empty,
        radius: [{ name: "radius-x", value: "kept" }],
      },
      (name) => known.get(name)
    );
    expect(filled.spacing.base).toBe(themed.spacing.base);
    expect(filled.radius).toEqual([{ name: "radius-x", value: "kept" }]);
    expect(allTokens(filled).filter((t) => t.name !== "radius-x")).toEqual(
      allTokens(themed).filter((t) => t.name !== "radius-x")
    );
    expect(fillValues(empty, () => undefined)).toEqual(empty);
  });
});

describe("reading a kind", () => {
  it.each(TOKEN_TABLE.map((e) => [e.kind] as const))(
    "lists the %s tokens, by their short names",
    (kind) => {
      expect(tokensOfKind(full, kind).map((t) => t.name)).toEqual([
        nameOf(kind),
      ]);
      expect(shortName(nameOf(kind))).toBe("x");
    }
  );

  it("keeps a name its kind's own prefix does not start, and finds the spacing base", () => {
    expect(shortName("inset-shadow-sm")).toBe("inset-shadow-sm");
    expect(shortName(SPACING_BASE)).toBe(SPACING_BASE);
    expect(shortName("brand")).toBe("brand");
    expect(tokensOfKind(full, "other")).toEqual([]);
    expect(tokensOfKind(null, "color")).toEqual([]);
    expect(tokenOf(full, SPACING_BASE)?.value).toBe(DEFAULT_SPACING_BASE);
    expect(tokenOf(full, "radius-x")?.value).toBe("1");
    expect(tokenOf(full, "radius-y")).toBeUndefined();
  });
});

describe("the spacing scale", () => {
  it.each([
    ["spacing-4", 4],
    ["spacing-0", 0],
    ["spacing-2.5", 2.5],
    ["spacing-gutter", null],
    ["spacing-4x", null],
    ["spacing--4", null],
    [SPACING_BASE, null],
    ["radius-4", null],
  ] as const)("reads %s as the step %s", (name, step) => {
    expect(spacingStepOf(name)).toBe(step);
  });

  it("names a step as Tailwind writes it, and every named step reads back", () => {
    expect(spacingStepName(4)).toBe("spacing-4");
    expect(spacingStepName(0.5)).toBe("spacing-0.5");
    for (const step of SPACING_STEPS) {
      expect(spacingStepOf(spacingStepName(step))).toBe(step);
    }
    expect([...SPACING_STEPS].sort((a, b) => a - b)).toEqual(SPACING_STEPS);
    expect(SPACING_STEPS).toContain(3.5);
    expect(SPACING_STEPS).toContain(96);
  });

  it.each([
    [undefined, 4],
    ["", 4],
    [DEFAULT_SPACING_BASE, 4],
    ["0.5rem", 8],
    ["3px", 3],
    ["0.25em", 4],
    ["0", 4],
    ["-2px", 4],
    ["var(--x)", 4],
    ["2", 4],
  ] as const)("takes a base of %j as %spx a step", (base, px) => {
    expect(spacingBasePx(base)).toBe(px);
  });

  it.each([
    [16, 4, 4],
    [10, 4, 2.5],
    [0, 4, 0],
    [-8, 4, -2],
    [13, 4, null],
    [9, 4, null],
    [9.6, 4.8, 2],
    [16.0004, 4, 4],
  ] as const)("finds %spx on a %spx base at the step %s", (px, base, step) => {
    expect(spacingStepAt(px, base)).toBe(step);
  });

  it("gives a step's length in the base's own unit", () => {
    expect(spacingLength("0.25rem", 9)).toBe("2.25rem");
    expect(spacingLength("4px", 2.5)).toBe("10px");
    expect(spacingLength(undefined, 4)).toBe("1rem");
    expect(spacingLength("var(--x)", 4)).toBeNull();
  });
});

describe("the tokens with a value", () => {
  it("finds every token of the kind that holds it, in the order given, by the one notion of the same value", () => {
    const ds = addTokens(emptyDesignSystem(), [
      { name: "color-primary", value: "oklch(62.3% 0.214 259.815)" },
      { name: "color-blue-500", value: "#2b7fff" },
      { name: "color-white", value: "white" },
      { name: "color-overlay", value: "rgb(0 0 0 / 0.5)" },
      { name: "radius-md", value: "0.375rem" },
      { name: "spacing-gutter", value: "6px" },
      { name: "shadow-md", value: "0 4px 6px rgb(0 0 0 / 0.1)" },
      { name: "font-weight-bold", value: "700" },
    ]);
    const byValue = tokensByValue(listedTokens(ds));
    const names = (kind: Parameters<typeof byValue>[0], value: string) =>
      byValue(kind, value).map((t) => t.name);

    // A hex and an oklch() of one colour, both, in the design's order.
    expect(names("color", "#2B7FFF")).toEqual([
      "color-primary",
      "color-blue-500",
    ]);
    expect(names("color", "#fff")).toEqual(["color-white"]);
    expect(names("color", "#00000080")).toEqual(["color-overlay"]);
    expect(names("color", "#2563eb")).toEqual([]);
    // A length in pixels against rem; a kind is its own.
    expect(names("radius", "6px")).toEqual(["radius-md"]);
    expect(names("spacing", "0.375rem")).toEqual(["spacing-gutter"]);
    expect(names("fontSize", "6px")).toEqual([]);
    expect(names("shadow", "0 4px  6px RGB(0 0 0 / 0.1)")).toEqual([
      "shadow-md",
    ]);
    expect(names("fontWeight", "700.0")).toEqual(["font-weight-bold"]);
    // A token that says its kind is of that kind, whatever its name.
    expect(
      tokensByValue([{ kind: "radius", name: "rounded", value: "4px" }])(
        "radius",
        "0.25rem"
      ).map((t) => t.name)
    ).toEqual(["rounded"]);
  });
});
