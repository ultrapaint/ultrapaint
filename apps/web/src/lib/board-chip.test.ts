import "../testing/fake-browser.ts";
import type { AppComponentFile } from "@ultrapaint/contracts/components";
import {
  type DesignDocument,
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import { catalogueOf } from "@ultrapaint/system-components/catalogue";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { describe, expect, it, vi } from "vitest";
import { attachmentsOf, chipKey } from "../state/attachments.ts";
import { type BoardFacts, boardChipLabel, boardChipOf } from "./board-chip.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const ds: DesignSystem = {
  ...emptyDesignSystem(),
  colors: [
    {
      name: "primary",
      tokens: [
        { name: "color-primary-50", value: "#eff6ff" },
        {
          name: "color-primary-600",
          value: "#2563eb",
          values: { dark: "#60a5fa" },
        },
      ],
    },
  ],
  themes: ["light", "dark"],
  typography: {
    fonts: [],
    sizes: [],
    styles: [
      { name: "body", role: "paragraph", size: "$text-sm", weight: 500 },
    ],
    weights: [],
  },
};

const document = {
  path: "DESIGN.md",
  sections: [{ heading: "Colors", section: "Colors", text: "Calm." }],
} as unknown as DesignDocument;

const plan: AppComponentFile = {
  name: "Plan",
  origin: "app",
  properties: [
    {
      default: "default",
      kind: "choice",
      members: ["default", "featured"],
      name: "tone",
    },
  ],
  slots: [],
  tree: { children: [], id: "card", type: "column" },
  version: 1,
};

const facts: BoardFacts = {
  catalogue: catalogueOf([plan]),
  components: [plan],
  designsDir: "docs/designs",
  document,
  ds,
  editedOn: null,
};

const system = (item: string, nodeId?: string) =>
  boardChipOf(
    { item, view: "system" },
    nodeId ? { frame: `board:system/${item}/light`, nodeId } : null,
    facts
  );

const library = (
  item: string,
  nodeId?: string,
  more: Partial<BoardFacts> = {}
) =>
  boardChipOf(
    { item, view: "library" },
    nodeId ? { frame: `board:library/${item}/matrix`, nodeId } : null,
    { ...facts, ...more }
  );

describe("a board's pick as a chip (ADR 0045, B11)", () => {
  it("is the token picked, with its value in each theme and the design system's file", () => {
    expect(system("color", "token:color-primary-600")).toEqual({
      detail: "light #2563eb, dark #60a5fa",
      file: "docs/designs/design-system.json",
      kind: "board",
      name: "color-primary-600",
      pick: "token",
    });
    expect(system("color", "token:color-primary-50")?.detail).toBe("#eff6ff");
  });

  it("is the colour group, the text style, else the foundation open", () => {
    expect(system("color", "group:primary")).toMatchObject({
      detail: "2 tokens, color-primary-50 to color-primary-600",
      name: "primary",
      pick: "group",
    });
    expect(system("typography", "style:body")).toMatchObject({
      detail: "size $text-sm, weight 500",
      name: "body",
      pick: "textStyle",
    });
    expect(system("spacing")).toMatchObject({
      name: "Spacing",
      pick: "foundation",
    });
  });

  it("is a guideline's section, in DESIGN.md", () => {
    expect(system("guide-colors")).toEqual({
      file: "DESIGN.md",
      kind: "board",
      name: "Colors",
      pick: "guideline",
    });
  });

  it("is a system component at the cell picked, saying when it has no file yet", () => {
    const outlineHover = library("Button", "cell:variant=outline:hover");
    expect(outlineHover).toEqual({
      detail: "in its default look: it has no file yet",
      file: "docs/designs/components/Button.component.json",
      kind: "board",
      name: "Button",
      pick: "systemComponent",
      place: {
        state: "hover",
        variant: { axis: "variant", member: "outline" },
      },
    });
    expect(boardChipLabel(outlineHover as never)).toBe(
      "Button · variant=outline, hover"
    );
    const button = defaultLookOf("Button");
    const saved = library("Button", "cell:base:base", {
      components: button ? [button] : [],
    });
    expect(saved).toEqual({
      file: "docs/designs/components/Button.component.json",
      kind: "board",
      name: "Button",
      pick: "systemComponent",
    });
  });

  it("is an app component at the variant picked or edited in place, its default member its own fields", () => {
    expect(library("Plan")).toMatchObject({ pick: "appComponent" });
    expect(library("Plan")?.place).toBeUndefined();
    expect(library("Plan", "variant:tone=featured")).toEqual({
      file: "docs/designs/components/Plan.component.json",
      kind: "board",
      name: "Plan",
      pick: "appComponent",
      place: { state: null, variant: { axis: "tone", member: "featured" } },
    });
    expect(
      library("Plan", "variant:tone=featured", {
        editedOn: "board:library/Plan/tone=default",
      })
    ).toMatchObject({
      detail: "its choice's default member: the component's own fields",
      place: { state: null, variant: { axis: "tone", member: "default" } },
    });
  });

  it("is nothing on the Overview", () => {
    expect(library("overview")).toBeNull();
  });

  it("goes with a prompt as it is, keyed by what it is and where", () => {
    const token = system("color", "token:color-primary-600");
    const cell = library("Button", "cell:variant=outline:hover");
    if (!(token && cell)) {
      throw new Error("no chips");
    }
    expect(attachmentsOf([token, cell])).toEqual([token, cell]);
    expect(chipKey(cell)).toBe(
      "board:systemComponent/Button/variant=outline/hover"
    );
  });
});
