import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import {
  type DesignDocument,
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { catalogueOf } from "@ultrapaint/system-components/catalogue";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { describe, expect, it } from "vitest";
import { libraryBoards, OVERVIEW, overviewBoard } from "./library-boards.ts";
import {
  foundationsOf,
  guidelineId,
  guidelinesOf,
  systemBoards,
  systemItemName,
} from "./system-boards.ts";

const token = (name: string, value = "1") => ({ name, value });

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [
    {
      name: "primary",
      tokens: [
        token("color-primary-50", "#eff6ff"),
        token("color-primary-600", "#2563eb"),
      ],
    },
    { name: "neutral", tokens: [token("color-neutral-900", "#171717")] },
  ],
  radius: [token("radius-md", "0.5rem")],
  shadows: [],
  spacing: { base: "0.25rem" },
  typography: {
    fonts: [],
    sizes: [token("text-sm", "0.875rem")],
    styles: [{ name: "body", role: "paragraph", size: "$text-sm" }],
    weights: [],
  },
};

const document = {
  sections: [
    { heading: "Overview", section: "Overview", text: "Calm.\n\nAnd quiet." },
    { heading: "Do's and Don'ts", section: "Do's and Don'ts", text: "Do." },
  ],
} as unknown as DesignDocument;

/** Every id in a tree, depth first. */
const ids = (node: DesignNode): string[] => [
  node.id,
  ...("children" in node ? (node.children ?? []).flatMap(ids) : []),
];

describe("Design system's list", () => {
  it("has the foundations the design system has data for, with their counts", () => {
    expect(foundationsOf(ds)).toEqual([
      { count: 3, id: "color", name: "Color" },
      { count: 2, id: "typography", name: "Typography" },
      { count: 0, id: "spacing", name: "Spacing" },
      { count: 1, id: "radius", name: "Radius" },
    ]);
  });

  it("keeps what a search finds tokens in", () => {
    expect(foundationsOf(ds, "primary")).toEqual([
      { count: 2, id: "color", name: "Color" },
    ]);
  });

  it("has Color alone, the neutral palette, without a design system", () => {
    expect(foundationsOf(null)).toEqual([
      { count: 16, id: "color", name: "Color" },
    ]);
    expect(foundationsOf(null, "nothing like it")).toEqual([]);
  });

  it("has DESIGN.md's sections as the guidelines, named for their heading", () => {
    expect(guidelinesOf(document).map((g) => g.id)).toEqual([
      "guide-overview",
      "guide-do-s-and-don-ts",
    ]);
    expect(guidelinesOf(document, "quiet").map((g) => g.name)).toEqual([
      "Overview",
    ]);
    expect(guidelinesOf(null)).toEqual([]);
    expect(guidelineId("Brand & Style")).toBe("guide-brand-style");
    expect(systemItemName("guide-overview", document)).toBe("Overview");
    expect(systemItemName("radius", document)).toBe("Radius");
  });
});

describe("Design system's boards", () => {
  it("draws every palette's swatches, each named for its token", () => {
    const { boards } = systemBoards("color", ds, document);
    expect(boards.map((b) => b.name)).toEqual(["palette"]);
    const drawn = ids((boards[0] as { root: DesignNode }).root);
    expect(drawn).toContain("token:color-primary-600");
    expect(drawn).toContain("token:color-neutral-900");
  });

  it("draws the neutral palette without a design system", () => {
    const { boards } = systemBoards("color", null, null);
    expect(ids((boards[0] as { root: DesignNode }).root)).toContain(
      "token:color-primary"
    );
  });

  it("draws the text styles and the type scale, a guideline as a document", () => {
    expect(
      systemBoards("typography", ds, null).boards.map((b) => b.name)
    ).toEqual(["styles", "scale"]);
    const [guide] = systemBoards("guide-overview", ds, document).boards;
    expect(guide && ids(guide.root)).toEqual([
      "document",
      "heading",
      "paragraph-0",
      "paragraph-1",
    ]);
  });

  it("draws nothing for an item it does not have", () => {
    expect(systemBoards("everything", ds, document).boards).toEqual([]);
    expect(systemBoards("radius", null, null).boards).toEqual([]);
  });
});

describe("the Library's boards", () => {
  const catalogue: readonly ComponentMeta[] = catalogueOf([]);

  it("draws every component on the Overview, each named for opening it, none drawn open", () => {
    const { root } = overviewBoard(catalogue);
    const drawn = ids(root);
    expect(drawn).toContain("item:Button");
    expect(drawn).toContain("item:Dialog");
    const open = JSON.stringify(root).includes('"open":true');
    expect(open).toBe(false);
  });

  it("draws a component's matrix in one row a member, at its own width", () => {
    const { boards } = libraryBoards("Button", catalogue, defaultLookOf);
    const [matrix] = boards;
    const root = matrix?.root;
    expect(root?.width).toBe("hug");
    const rows = root && "children" in root ? (root.children ?? []) : [];
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => !("wrap" in r) || r.wrap === false)).toBe(true);
    // Each cell named for its member and state, which a click picks.
    expect(ids(root as DesignNode)).toEqual(
      expect.arrayContaining(["cell:primary:base", "cell:outline:hover"])
    );
  });

  it("draws the Overview first and nothing for a component it does not have", () => {
    expect(
      libraryBoards(OVERVIEW, catalogue, defaultLookOf).boards
    ).toHaveLength(1);
    expect(libraryBoards("Nope", catalogue, () => undefined).boards).toEqual(
      []
    );
  });
});
