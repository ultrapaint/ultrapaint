import { describe, expect, it } from "vitest";
import { type DesignSystem, emptyDesignSystem } from "./design-system.ts";
import {
  addTokens,
  allTokens,
  fillValues,
  layValues,
  lineHeightName,
  listedTokens,
  mapTokenRecords,
  removeTokens,
  SPACING_BASE,
  stripValues,
  TOKEN_TABLE,
  tokenKindOf,
  tokenPrefix,
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
