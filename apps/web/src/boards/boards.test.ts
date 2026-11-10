import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import type { AppComponentFile } from "@ultrapaint/contracts/components";
import {
  type DesignDocument,
  type DesignSystem,
  emptyDesignSystem,
  type TokenGroup,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { catalogueOf } from "@ultrapaint/system-components/catalogue";
import { DEFAULT_LOOK } from "@ultrapaint/system-components/default-look";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { describe, expect, it } from "vitest";
import { contrastPairs, gradeOf, isRamp } from "./color-boards.ts";
import {
  appComponentBoards,
  drawnWidths,
  libraryBoards,
  OVERVIEW,
  overviewBoard,
} from "./library-boards.ts";
import {
  type Board,
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

/** A node of a tree by its id. */
const find = (node: DesignNode, id: string): DesignNode | undefined => {
  if (node.id === id) {
    return node;
  }
  for (const child of "children" in node ? (node.children ?? []) : []) {
    const found = find(child, id);
    if (found) {
      return found;
    }
  }
  return undefined;
};

/** Every id in a tree, depth first. */
const ids = (node: DesignNode): string[] => [
  node.id,
  ...("children" in node ? (node.children ?? []).flatMap(ids) : []),
];

describe("Design system's list", () => {
  it("has the foundations the design system has data for, with their counts", () => {
    expect(foundationsOf(ds)).toEqual([
      { count: 3, id: "color", name: "Colour" },
      { count: 2, id: "typography", name: "Typography" },
      { count: 0, id: "spacing", name: "Spacing" },
      { count: 1, id: "radius", name: "Radius" },
    ]);
  });

  it("keeps what a search finds tokens in", () => {
    expect(foundationsOf(ds, "primary")).toEqual([
      { count: 2, id: "color", name: "Colour" },
    ]);
  });

  it("has the default look's foundations without a design system of its own", () => {
    expect(foundationsOf(null)).toEqual(foundationsOf(DEFAULT_LOOK));
    expect(foundationsOf(null).map((f) => f.id)).toEqual([
      "color",
      "typography",
      "spacing",
      "radius",
      "elevation",
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
  const ramp = (name: string, values: readonly string[]) => ({
    name,
    tokens: [50, 500, 950].map((step, i) => ({
      name: `color-${name}-${step}`,
      value: values[i] ?? "#000000",
    })),
  });
  const themed: DesignSystem = {
    ...ds,
    colors: [
      ramp("blue", ["#eff6ff", "#3b82f6", "#172554"]),
      {
        name: "Semantic",
        tokens: [
          {
            name: "color-background",
            value: "#ffffff",
            values: { dark: "#0a0a0a" },
          },
          {
            name: "color-foreground",
            value: "#0a0a0a",
            values: { dark: "#fafafa" },
          },
          {
            name: "color-muted-foreground",
            value: "#d4d4d4",
            values: { dark: "#a3a3a3" },
          },
          { name: "color-primary", value: "var(--color-blue-500)" },
          { name: "color-primary-foreground", value: "#ffffff" },
        ],
      },
    ],
    themes: ["light", "dark"],
  };

  it("draws a board per theme, each in its theme, every swatch named for its token", () => {
    const { boards, direction } = systemBoards("color", themed, document);
    expect(direction).toBe("row");
    expect(boards.map((b) => [b.name, b.theme, b.title])).toEqual([
      ["light", "light", "Light"],
      ["dark", "dark", "Dark"],
    ]);
    const drawn = ids((boards[0] as Board).root);
    expect(drawn).toEqual(
      expect.arrayContaining([
        "token:color-blue-50",
        "token:color-background",
        "group:blue",
        "group:Semantic",
      ])
    );
  });

  it("draws a palette as its ramp, each shade over its step", () => {
    expect(isRamp(themed.colors[0] as TokenGroup)).toBe(true);
    expect(isRamp(themed.colors[1] as TokenGroup)).toBe(false);
    const { root } = systemBoards("color", themed, null).boards[0] as Board;
    const shades = find(root, "ramp:blue") as unknown as {
      children: DesignNode[];
    };
    expect(shades.children.map((c) => c.id)).toEqual([
      "token:color-blue-50",
      "token:color-blue-500",
      "token:color-blue-950",
    ]);
    expect(find(root, "fill:color-blue-500")?.fill).toBe("$color-blue-500");
    expect(
      (find(root, "step:color-blue-500") as { text?: string } | undefined)?.text
    ).toBe("500");
    // A colour named for another says which, in the board's theme.
    expect(
      (find(root, "value:color-primary") as { text?: string } | undefined)?.text
    ).toBe("→ blue-500");
  });

  it("grades the usual pairs in each theme, a value that is another token followed", () => {
    const [light, dark] = systemBoards("color", themed, null).boards as Board[];
    const grade = (b: Board, pair: string) =>
      (find(b.root, `grade:${pair}`) as { text?: string } | undefined)?.text;
    expect(grade(light as Board, "color-foreground:color-background")).toBe(
      "AAA"
    );
    expect(
      grade(light as Board, "color-muted-foreground:color-background")
    ).toBe("Fails");
    expect(
      grade(dark as Board, "color-muted-foreground:color-background")
    ).toBe("AAA");
    // White on blue-500, through `var(--color-blue-500)`.
    expect(
      grade(light as Board, "color-primary-foreground:color-primary")
    ).toBe("AA large");
    expect(gradeOf(4.5)).toBe("AA");
    expect(
      contrastPairs(
        new Set(["color-foreground", "color-background", "color-card"])
      )
    ).toEqual([["color-foreground", "color-background"]]);
  });

  it("finds a colour by its name or its value in any theme, the list counting what every board draws", () => {
    const drawn = (query: string) =>
      systemBoards("color", themed, null, query).boards.map((b) =>
        ids(b.root)
          .filter((id) => id.startsWith("token:"))
          .map((id) => id.slice("token:".length))
      );
    const counted = (query: string) =>
      foundationsOf(themed, query).find((f) => f.id === "color")?.count;
    // The ramp by its names, and the colour whose value names a shade of it.
    const blue = [
      "color-blue-50",
      "color-blue-500",
      "color-blue-950",
      "color-primary",
    ];
    expect(drawn("blue")).toEqual([blue, blue]);
    expect(counted("blue")).toBe(4);
    // What a value that names another comes to.
    expect(drawn("#3b82f6")).toEqual([
      ["color-blue-500", "color-primary"],
      ["color-blue-500", "color-primary"],
    ]);
    expect(counted("#3b82f6")).toBe(2);
    // A value only the dark theme has.
    expect(drawn("a3a3a3")).toEqual([
      ["color-muted-foreground"],
      ["color-muted-foreground"],
    ]);
    expect(counted("a3a3a3")).toBe(1);
  });

  it("draws the default look's palette, light and dark, without a design system", () => {
    const { boards } = systemBoards("color", null, null);
    expect(boards.map((b) => b.theme)).toEqual(["light", "dark"]);
    expect(ids((boards[0] as Board).root)).toContain("token:color-primary");
  });

  it("draws the text styles and the type scale, a guideline as a document", () => {
    const typography = systemBoards("typography", ds, null).boards;
    expect(typography.map((b) => b.name)).toEqual(["styles", "scale"]);
    expect(ids((typography[0] as Board).root)).toContain("style:body");
    expect(ids((typography[1] as Board).root)).toContain("token:text-sm");
    const [guide] = systemBoards("guide-overview", ds, document).boards;
    expect(guide && ids(guide.root)).toEqual([
      "document",
      "heading",
      "paragraph-0",
      "paragraph-1",
    ]);
  });

  it("draws the other foundations' tokens, each named for its token", () => {
    const more: DesignSystem = {
      ...ds,
      layout: { breakpoints: [{ name: "breakpoint-md", value: "48rem" }] },
      motion: {
        durations: [{ name: "duration-fast", value: "150ms" }],
        easings: [{ name: "ease-out", value: "cubic-bezier(0, 0, 0.2, 1)" }],
      },
      shadows: [{ name: "shadow-sm", value: "0 1px 2px #0000000d" }],
    };
    expect(
      ids((systemBoards("radius", more, null).boards[0] as Board).root)
    ).toContain("token:radius-md");
    expect(
      ids((systemBoards("elevation", more, null).boards[0] as Board).root)
    ).toContain("token:shadow-sm");
    expect(
      ids((systemBoards("breakpoints", more, null).boards[0] as Board).root)
    ).toContain("token:breakpoint-md");
    expect(
      ids((systemBoards("spacing", more, null).boards[0] as Board).root)
    ).toContain("token:spacing");
  });

  it("animates each easing and duration in the motion board's own stylesheet", () => {
    const [motion] = systemBoards(
      "motion",
      {
        ...ds,
        motion: {
          durations: [{ name: "duration-fast", value: "150ms" }],
          easings: [{ name: "ease-out", value: "cubic-bezier(0, 0, 0.2, 1)" }],
        },
      },
      null
    ).boards;
    expect(motion?.css).toContain("@keyframes ed-board-move");
    expect(motion?.css).toContain(
      '[data-ed-node="dot:ease-out"] { animation: ed-board-move 1.5s var(--ease-out, cubic-bezier(0, 0, 0.2, 1)) infinite alternate; }'
    );
    expect(motion?.css).toContain("var(--duration-fast, 150ms) ease-in-out");
    expect(ids(motion?.root as DesignNode)).toContain("dot:ease-out");
  });

  it("draws nothing for an item it does not have", () => {
    expect(systemBoards("everything", ds, document).boards).toEqual([]);
    // Without a design system of its own, the default look has one.
    expect(systemBoards("radius", null, null).boards).toEqual(
      systemBoards("radius", DEFAULT_LOOK, null).boards
    );
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

  it("draws a system component's matrix, members and states named, and a board an axis more", () => {
    const { boards, direction } = libraryBoards(
      "Button",
      catalogue,
      defaultLookOf
    );
    expect(direction).toBe("column");
    expect(boards.map((b) => [b.name, b.title])).toEqual([
      ["matrix", "variant × state"],
      ["axis-size", "size"],
    ]);
    const [matrix, sizes] = boards;
    expect(matrix?.root.width).toBe("hug");
    const drawn = ids(matrix?.root as DesignNode);
    // The states over their columns, the members before their rows, a grid lining them up.
    expect(drawn).toEqual(
      expect.arrayContaining([
        "state:base",
        "state:hover",
        "member:outline",
        "cell:variant=primary:base",
        "cell:variant=outline:hover",
      ])
    );
    expect(matrix?.css).toContain("grid-template-columns");
    expect(ids(sizes?.root as DesignNode)).toEqual(
      expect.arrayContaining(["cell:size=sm:base", "member:size=sm"])
    );
    // A square icon size shows an icon in its label's place, not a label that overflows it.
    const nodes = (root: DesignNode | undefined): DesignNode[] =>
      root
        ? [
            root,
            ...(("children" in root && root.children) || []).flatMap(nodes),
          ]
        : [];
    const cell = (id: string) =>
      nodes(sizes?.root).find((n) => n.id === id) as unknown as
        | { children: DesignNode[] }
        | undefined;
    const [icon] = cell("cell:size=icon:base")?.children ?? [];
    expect(icon).toMatchObject({ type: "instance" });
    expect(icon).not.toHaveProperty("text");
    expect((icon as unknown as { children: DesignNode[] }).children).toEqual([
      expect.objectContaining({ tint: "currentColor", type: "image" }),
    ]);
    expect(cell("cell:size=sm:base")?.children[0]).toMatchObject({
      text: "Button",
    });
  });

  it("draws an app component a board a member of each choice, edited in place on the member", () => {
    const card: AppComponentFile = {
      name: "Plan",
      origin: "app",
      properties: [
        {
          default: "default",
          kind: "choice",
          members: ["default", "featured"],
          name: "tone",
        },
        { default: "Pro", kind: "text", name: "title" },
      ],
      slots: [],
      tree: { children: [], id: "card", type: "column", width: 320 },
      version: 1,
    };
    const { boards, direction } = libraryBoards("Plan", catalogue, () => card);
    expect(direction).toBe("wrap");
    expect(boards.map((b) => b.name)).toEqual([
      "tone=default",
      "tone=featured",
    ]);
    const [base, featured] = boards;
    expect(featured?.inPlace).toEqual({
      instance: {
        component: "Plan",
        from: "#app",
        id: "instance",
        props: { tone: "featured" },
        type: "instance",
      },
      variant: { member: "featured", property: "tone" },
    });
    // The choice's default member is the component's own fields.
    expect(base?.inPlace?.variant).toBeNull();
    expect(base?.root.width).toBe(368);
    // Named for its variant, a click picks it.
    expect(featured?.root.id).toBe("variant:tone=featured");
    // Without a choice, once, as an instance that sets nothing.
    const plain = { ...card, properties: [] };
    expect(appComponentBoards(plain).map((b) => b.name)).toEqual(["component"]);
  });

  it("scales an app component wider than a tile down to it on the Overview, measured once drawn", () => {
    const header: AppComponentFile = {
      name: "Header",
      origin: "app",
      properties: [],
      slots: [],
      tree: { children: [], id: "h", type: "row" },
      version: 1,
    };
    const withHeader = catalogueOf([header]);
    // Hugging what it holds, its width is known once it is drawn.
    expect(overviewBoard(withHeader, () => header).css).not.toContain(
      "example:Header"
    );
    const drawn = drawnWidths(
      ["Header"],
      { "example:Header": { width: 704 } },
      {}
    );
    expect(drawn).toEqual({ Header: 704 });
    expect(overviewBoard(withHeader, () => header, drawn).css).toContain(
      '[data-ed-node="example:Header"] { zoom: 0.2500;'
    );
    // Drawn again at that scale, it measures the same: nothing moves.
    expect(
      drawnWidths(["Header"], { "example:Header": { width: 176 } }, drawn)
    ).toBe(drawn);
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
