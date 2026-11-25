import type { AppComponentFile } from "@ultrapaint/contracts/components";
import type { DesignNode, PageNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { type ColourUsed, coloursUsed, recolourOps } from "./colours-used.ts";
import type { AppFileOf } from "./instance-layers.ts";

const page = (children: readonly DesignNode[]) =>
  ({ children, id: "root", type: "page" }) as PageNode;

const text = (id: string, more: Record<string, unknown> = {}) =>
  ({ id, role: "paragraph", text: id, type: "text", ...more }) as DesignNode;

/** A shell: a side column holding a title and a nested instance of Nav, whose layer is a label. */
const files: Record<string, AppComponentFile> = {
  Nav: {
    name: "Nav",
    origin: "app",
    properties: [],
    slots: [],
    tree: {
      children: [text("label", { color: "#000000" })],
      id: "nav-root",
      type: "row",
    },
    version: 1,
  } as AppComponentFile,
  Shell: {
    name: "Shell",
    origin: "app",
    properties: [],
    slots: [],
    tree: {
      children: [
        {
          children: [
            text("title", { color: "#123456" }),
            { component: "Nav", from: "#app", id: "nav", type: "instance" },
          ],
          fill: "#abcdef",
          id: "side",
          type: "column",
        },
        text("foot"),
      ],
      id: "shell-root",
      type: "column",
    },
    version: 1,
  } as AppComponentFile,
};
const fileOf: AppFileOf = (name) => files[name];

/** Each colour with its uses as `node[/layer] [at] field`. */
const listed = (root: DesignNode, ids: readonly string[]) =>
  coloursUsed(root, ids, fileOf).map((c) => [
    c.value,
    ...c.uses.map(
      (u) =>
        `${u.node}${u.layer ? `/${u.layer}` : ""}${u.at ? ` ${u.at}` : ""} ${u.field}`
    ),
  ]);

describe("the colours a selection uses", () => {
  it("counts a fill, a text's colour, a border's colour and an image's tint", () => {
    const root = page([
      {
        border: { color: "#ff0000", width: 1 },
        children: [
          text("t", { color: "#00ff00" }),
          { id: "icon", src: "i.svg", tint: "#0000ff", type: "image" },
        ],
        fill: "#ffffff",
        id: "card",
        type: "column",
      },
    ]);
    expect(listed(root, ["card"])).toEqual([
      ["#ffffff", "card fill"],
      ["#ff0000", "card border.color"],
      ["#00ff00", "t color"],
      ["#0000ff", "icon tint"],
    ]);
  });

  it("counts the same fields at a breakpoint as the node's own", () => {
    const root = page([
      {
        at: { md: { border: { color: "#ff0000" }, fill: "#ffffff" } },
        children: [text("t", { at: { lg: { color: "#ffffff" } } })],
        id: "card",
        type: "column",
      },
    ]);
    expect(listed(root, ["card"])).toEqual([
      ["#ffffff", "card md fill", "t lg color"],
      ["#ff0000", "card md border.color"],
    ]);
  });

  it("counts an instance's own fields and its overrides by layer, theirs at a breakpoint too", () => {
    const root = page([
      {
        component: "Shell",
        fill: "#eeeeee",
        from: "#app",
        id: "shell",
        overrides: {
          "nav/label": { color: "#111111" },
          side: { at: { md: { fill: "#222222" } }, fill: "#111111" },
        },
        props: { tone: "#333333" },
        type: "instance",
      },
    ]);
    expect(listed(root, ["shell"])).toEqual([
      ["#eeeeee", "shell fill"],
      ["#111111", "shell/nav/label color", "shell/side fill"],
      ["#222222", "shell/side md fill"],
    ]);
  });

  it("reads nothing of a main component's tree, a shadow or a text style", () => {
    const root = page([
      {
        children: [
          text("t", { textStyle: "body" }),
          { component: "Shell", from: "#app", id: "shell", type: "instance" },
        ],
        id: "card",
        shadow: "0 1px 2px #000000",
        type: "column",
      },
    ]);
    expect(listed(root, ["card"])).toEqual([]);
  });

  it("reads the overrides of an instance's layer and of the layers under it, nested instances' too", () => {
    const root = page([
      {
        component: "Shell",
        from: "#app",
        id: "shell",
        overrides: {
          foot: { color: "#999999" },
          "nav/label": { color: "#111111" },
          title: { color: "#222222" },
        },
        type: "instance",
      },
    ]);
    expect(listed(root, ["shell/side"])).toEqual([
      ["#111111", "shell/nav/label color"],
      ["#222222", "shell/title color"],
    ]);
  });

  it("folds one colour written two ways into one", () => {
    const root = page([
      {
        children: [
          text("a", { color: "#fff" }),
          text("b", { color: "#FFFFFF" }),
        ],
        id: "card",
        type: "column",
      },
    ]);
    expect(listed(root, ["card"])).toEqual([["#fff", "a color", "b color"]]);
  });

  it("keeps a token apart from a raw colour of its value", () => {
    const root = page([
      {
        children: [
          text("c", { color: "$color-primary" }),
          text("d", { color: "#2563eb" }),
          text("e", { color: "$color-primary" }),
        ],
        id: "card",
        type: "column",
      },
    ]);
    expect(listed(root, ["card"])).toEqual([
      ["$color-primary", "c color", "e color"],
      ["#2563eb", "d color"],
    ]);
  });

  it("reads each colour of a fill in layers", () => {
    const root = page([
      {
        children: [],
        fill: "linear-gradient(#ff0000, $color-primary)",
        id: "card",
        type: "group",
      },
    ]);
    expect(listed(root, ["card"])).toEqual([
      ["#ff0000", "card fill"],
      ["$color-primary", "card fill"],
    ]);
  });

  it("leaves out a value that is no colour: currentColor, an image", () => {
    const root = page([
      {
        children: [text("t", { color: "currentColor" })],
        fill: "url(a.png)",
        id: "card",
        type: "column",
      },
    ]);
    expect(listed(root, ["card"])).toEqual([]);
  });

  it("counts a node once when it is selected and inside another selected", () => {
    const root = page([
      {
        children: [text("t", { color: "#00ff00" })],
        id: "card",
        type: "column",
      },
    ]);
    expect(listed(root, ["card", "t"])).toEqual([["#00ff00", "t color"]]);
  });
});

describe("a colour used changed", () => {
  const only = (root: DesignNode, ids: readonly string[]): ColourUsed => {
    const [first] = coloursUsed(root, ids, fileOf);
    if (!first) {
      throw new Error("no colour used");
    }
    return first;
  };

  it("is one update for every use, a breakpoint's naming its `at` and an override its layer", () => {
    const root = page([
      {
        at: { md: { fill: "#fff" } },
        border: { color: "#ffffff", style: "dashed", width: 2 },
        children: [
          {
            component: "Shell",
            from: "#app",
            id: "shell",
            overrides: { side: { at: { md: { fill: "#ffffff" } } } },
            type: "instance",
          },
        ],
        id: "card",
        type: "column",
      },
    ]);
    expect(recolourOps(only(root, ["card"]), "$color-surface")).toEqual([
      {
        id: "card",
        op: "update",
        set: {
          border: { color: "$color-surface", style: "dashed", width: 2 },
        },
      },
      { at: "md", id: "card", op: "update", set: { fill: "$color-surface" } },
      {
        at: "md",
        id: "shell/side",
        op: "update",
        set: { fill: "$color-surface" },
      },
    ]);
  });

  it("rewrites only its own colours inside a fill in layers", () => {
    const root = page([
      {
        children: [],
        fill: "linear-gradient(#ff0000, #00ff00 40%, #f00)",
        id: "card",
        type: "group",
      },
    ]);
    expect(recolourOps(only(root, ["card"]), "#0000ff")).toEqual([
      {
        id: "card",
        op: "update",
        set: { fill: "linear-gradient(#0000ff, #00ff00 40%, #0000ff)" },
      },
    ]);
  });
});
