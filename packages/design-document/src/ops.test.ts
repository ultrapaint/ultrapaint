import type { JsonValue } from "@ultrapaint/contracts/base";
import type {
  DesignNode,
  DocOp,
  InstanceNode,
  PageNode,
  TextNode,
  TextRun,
} from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { fillIds, makeIdGenerator } from "./ids.ts";
import { applyOps, cloneJson, DocumentOpError, touchedBy } from "./ops.ts";
import { runsDropped } from "./text-runs.ts";

const BOTH_LINKS_RE = /links as a whole|its words link/;
const FIXED_RUNS_RE = /runs is the same at every breakpoint/;
const NAMES_RUNS_RE = /runs/;

import { canvasRoot, findNode, findPath } from "./tree.ts";

const text = (id: string, value = id): DesignNode => ({
  id,
  role: "paragraph",
  text: value,
  type: "text",
});

const page = (): PageNode => ({
  children: [
    {
      children: [text("a"), text("b"), text("c")],
      id: "row",
      type: "row",
    },
    text("d"),
  ],
  id: "root",
  type: "page",
});

const ids = (node: DesignNode | null) =>
  node && "children" in node ? (node.children ?? []).map((c) => c.id) : [];

const card = (
  children?: DesignNode[],
  id = "card",
  words?: string
): InstanceNode => ({
  component: "Card",
  from: "@ultrapaint/system",
  id,
  type: "instance",
  ...(children && { children }),
  ...(words !== undefined && { text: words }),
});

const options = () => ({ canvas: false, next: makeIdGenerator(["root"]) });

describe("applyOps", () => {
  it("inserts at an index and at the end, keeping the given id", () => {
    const { created, root } = applyOps(
      page(),
      [
        { index: 1, node: text("x"), op: "insert", parent: "row" },
        { node: text("y"), op: "insert", parent: null },
      ],
      options()
    );
    expect(ids(findNode(root, "row"))).toEqual(["a", "x", "b", "c"]);
    expect(ids(root)).toEqual(["row", "d", "y"]);
    expect(created).toEqual(["x", "y"]);
  });

  it("gives an inserted tree new ids when one is taken", () => {
    const { created, root } = applyOps(
      page(),
      [{ node: text("a"), op: "insert", parent: null }],
      options()
    );
    expect(created[0]).not.toBe("a");
    expect(findNode(root, created[0] as string)).not.toBeNull();
  });

  it("moves within a parent counting siblings without the moved node", () => {
    const { root } = applyOps(
      page(),
      [{ id: "a", index: 2, op: "move", parent: "row" }],
      options()
    );
    expect(ids(findNode(root, "row"))).toEqual(["b", "c", "a"]);
  });

  it("moves across parents and refuses a move into itself", () => {
    const { root } = applyOps(
      page(),
      [{ id: "d", index: 0, op: "move", parent: "row" }],
      options()
    );
    expect(ids(findNode(root, "row"))).toEqual(["d", "a", "b", "c"]);
    expect(() =>
      applyOps(page(), [{ id: "row", op: "move", parent: "row" }], options())
    ).toThrow(DocumentOpError);
  });

  it("updates fields, removes them with null, and guards the structure", () => {
    const { root } = applyOps(
      page(),
      [
        { id: "row", op: "update", set: { gap: 12, type: "column" } },
        { id: "row", op: "update", set: { gap: null } },
      ],
      options()
    );
    const row = findNode(root, "row");
    expect(row?.type).toBe("column");
    expect(row && "gap" in row).toBe(false);
    expect(() =>
      applyOps(
        page(),
        [{ id: "a", op: "update", set: { type: "row" } }],
        options()
      )
    ).toThrow(DocumentOpError);
    expect(() =>
      applyOps(page(), [{ id: "a", op: "update", set: { id: "z" } }], options())
    ).toThrow(DocumentOpError);
  });

  it("wraps siblings in place and unwraps them back", () => {
    const wrapped = applyOps(
      page(),
      [{ ids: ["c", "b"], op: "wrap", type: "column" }],
      options()
    );
    const column = wrapped.created[0] as string;
    expect(ids(findNode(wrapped.root, "row"))).toEqual(["a", column]);
    expect(ids(findNode(wrapped.root, column))).toEqual(["b", "c"]);
    const unwrapped = applyOps(
      wrapped.root,
      [{ id: column, op: "unwrap" }],
      options()
    );
    expect(ids(findNode(unwrapped.root, "row"))).toEqual(["a", "b", "c"]);
    expect(() =>
      applyOps(
        page(),
        [{ ids: ["a", "d"], op: "wrap", type: "row" }],
        options()
      )
    ).toThrow(DocumentOpError);
  });

  it("replaces nodes in place, siblings, keeping an id of one it replaces", () => {
    const { created, root } = applyOps(
      page(),
      [{ ids: ["b", "c"], node: card(undefined, "b"), op: "replace" }],
      options()
    );
    expect(ids(findNode(root, "row"))).toEqual(["a", "b"]);
    expect(findNode(root, "b")).toMatchObject({ type: "instance" });
    expect(created).toEqual(["b"]);
    expect(() =>
      applyOps(
        page(),
        [{ ids: ["a", "d"], node: text("x"), op: "replace" }],
        options()
      )
    ).toThrow(DocumentOpError);
  });

  it("takes a node named twice as named once, replacing or wrapping it", () => {
    const replaced = applyOps(
      page(),
      [{ ids: ["a", "a"], node: text("x"), op: "replace" }],
      options()
    );
    expect(ids(findNode(replaced.root, "row"))).toEqual(["x", "b", "c"]);
    const wrapped = applyOps(
      page(),
      [{ ids: ["a", "a"], op: "wrap", type: "column" }],
      options()
    );
    const column = wrapped.created[0] as string;
    expect(ids(findNode(wrapped.root, "row"))).toEqual([column, "b", "c"]);
    expect(ids(findNode(wrapped.root, column))).toEqual(["a"]);
  });

  it("replaces a node on the canvas at its position, unless the node gives its own", () => {
    const canvas = canvasRoot([{ ...text("free"), x: 10, y: 20 }]);
    const opts = { canvas: true, next: makeIdGenerator() };
    const { root } = applyOps(
      canvas,
      [{ ids: ["free"], node: card(undefined, "free"), op: "replace" }],
      opts
    );
    expect(findNode(root, "free")).toMatchObject({
      type: "instance",
      x: 10,
      y: 20,
    });
  });

  it("duplicates with new ids right after the original", () => {
    const { created, root } = applyOps(
      page(),
      [{ id: "row", op: "duplicate" }],
      options()
    );
    const copy = created[0] as string;
    expect(ids(root)).toEqual(["row", copy, "d"]);
    expect(ids(findNode(root, copy))).not.toContain("a");
  });

  it("pairs every node of a duplicate with its copy's, two copies of one node each", () => {
    const { copies, created, root } = applyOps(
      page(),
      [
        { id: "row", op: "duplicate" },
        { id: "row", op: "duplicate" },
      ],
      options()
    );
    const [first = "", second = ""] = created;
    expect(copies.map((c) => c.from)).toEqual([
      ...["row", "a", "b", "c"],
      ...["row", "a", "b", "c"],
    ]);
    expect(copies.map((c) => c.to)).toEqual([
      first,
      ...ids(findNode(root, first)),
      second,
      ...ids(findNode(root, second)),
    ]);
  });

  it("pairs an inserted tree's ids with the ones it was given when one is taken, and none when all are free", () => {
    const clashing: DesignNode = {
      children: [text("a"), text("y")],
      id: "x",
      type: "column",
    };
    const { copies, created, root } = applyOps(
      page(),
      [
        { node: clashing, op: "insert", parent: null },
        { node: text("free"), op: "insert", parent: null },
      ],
      options()
    );
    const [column = ""] = created;
    expect(copies).toEqual([
      { from: "x", to: column },
      ...ids(findNode(root, column)).map((to, i) => ({
        from: ["a", "y"][i],
        to,
      })),
    ]);
    expect(created[1]).toBe("free");
  });

  it("pairs no id a replace keeps of what it replaces, and every one of a tree that clashes elsewhere", () => {
    const kept = applyOps(
      page(),
      [{ ids: ["b"], node: text("b", "B"), op: "replace" }],
      options()
    );
    expect(kept.copies).toEqual([]);
    const clashing = applyOps(
      page(),
      [{ ids: ["b"], node: text("d"), op: "replace" }],
      options()
    );
    expect(clashing.copies).toEqual([{ from: "d", to: clashing.created[0] }]);
  });

  it("sets and clears instance props", () => {
    const start: PageNode = {
      children: [
        {
          component: "Button",
          from: "@ultrapaint/system",
          id: "b",
          type: "instance",
        },
      ],
      id: "root",
      type: "page",
    };
    const set = applyOps(
      start,
      [{ id: "b", op: "setProps", props: { size: "sm", variant: "ghost" } }],
      options()
    );
    const cleared = applyOps(
      set.root,
      [{ id: "b", op: "setProps", props: { size: null, variant: null } }],
      options()
    );
    expect(findNode(set.root, "b")).toMatchObject({
      props: { size: "sm", variant: "ghost" },
    });
    expect(findNode(cleared.root, "b")).not.toHaveProperty("props");
    expect(() =>
      applyOps(page(), [{ id: "a", op: "setProps", props: {} }], options())
    ).toThrow(DocumentOpError);
  });

  it("positions the canvas's top-level nodes and nothing inside them", () => {
    const canvas = canvasRoot([{ ...text("free"), x: 10.4, y: 20 }]);
    const opts = { canvas: true, next: makeIdGenerator() };
    const { root } = applyOps(
      canvas,
      [
        { node: text("new"), op: "insert", parent: null },
        { ids: ["free"], op: "wrap", type: "group" },
      ],
      opts
    );
    expect(findNode(root, "new")).toMatchObject({ x: 0, y: 0 });
    const group = findPath(root, "free")?.at(-2);
    expect(group).toMatchObject({ type: "group", x: 10, y: 20 });
    expect(findNode(root, "free")).not.toHaveProperty("x");
  });

  it("moves a node into an instance and back out", () => {
    const withCard: PageNode = {
      ...page(),
      children: [...page().children, card([text("title")])],
    };
    const into = applyOps(
      withCard,
      [{ id: "d", index: 0, op: "move", parent: "card" }],
      options()
    ).root;
    expect(ids(findNode(into, "card"))).toEqual(["d", "title"]);
    const out = applyOps(
      into,
      [{ id: "d", op: "move", parent: "root" }],
      options()
    ).root;
    // Left with its one plain text, the card shows it as its own text again.
    expect(findNode(out, "card")).toEqual(card(undefined, "card", "title"));
    expect(ids(out)).toEqual(["row", "card", "d"]);
  });

  it("turns an instance's text into its first child when a node arrives", () => {
    const withCard: PageNode = {
      ...page(),
      children: [...page().children, card(undefined, "card", "Card")],
    };
    const { created, root } = applyOps(
      withCard,
      [{ id: "d", index: 0, op: "move", parent: "card" }],
      options()
    );
    const node = findNode(root, "card");
    const [first, second] =
      node?.type === "instance" ? (node.children ?? []) : [];
    expect(node && "text" in node).toBe(false);
    expect(first).toMatchObject({
      role: "paragraph",
      text: "Card",
      type: "text",
    });
    expect(second?.id).toBe("d");
    expect(created).toEqual([]);
  });

  it("keeps an instance's text as a child when something is inserted into it", () => {
    const withCard: PageNode = {
      ...page(),
      children: [card(undefined, "card", "Save")],
    };
    const { created, root } = applyOps(
      withCard,
      [{ node: text("icon"), op: "insert", parent: "card" }],
      options()
    );
    const node = findNode(root, "card");
    expect(ids(node).at(-1)).toBe("icon");
    expect(ids(node)).toHaveLength(2);
    expect(created).toEqual(["icon"]);
  });

  it("gives an instance its text back when what came in goes out again", () => {
    const withCard: PageNode = {
      ...page(),
      children: [...page().children, card(undefined, "card", "Card")],
    };
    const into = applyOps(
      withCard,
      [{ id: "d", op: "move", parent: "card" }],
      options()
    ).root;
    const out = applyOps(
      into,
      [{ id: "d", op: "move", parent: "root" }],
      options()
    ).root;
    expect(findNode(out, "card")).toEqual(card(undefined, "card", "Card"));
    const removed = applyOps(into, [{ id: "d", op: "remove" }], options());
    expect(findNode(removed.root, "card")).toEqual(
      card(undefined, "card", "Card")
    );
  });

  it("keeps a text node that was styled, or that stays among others", () => {
    const styled: PageNode = {
      ...page(),
      children: [
        card([{ ...(text("words") as TextNode), weight: 600 }, text("icon")]),
        text("d"),
      ],
    };
    const { root } = applyOps(
      styled,
      [{ id: "icon", op: "remove" }],
      options()
    );
    expect(ids(findNode(root, "card"))).toEqual(["words"]);
    const reordered = applyOps(
      { ...page(), children: [card([text("words"), text("icon")])] },
      [{ id: "icon", index: 0, op: "move", parent: "card" }],
      options()
    ).root;
    expect(ids(findNode(reordered, "card"))).toEqual(["icon", "words"]);
  });

  it("refuses to move an instance into what it holds", () => {
    const nested: PageNode = {
      ...page(),
      children: [card([card([], "inner")])],
    };
    expect(() =>
      applyOps(nested, [{ id: "card", op: "move", parent: "inner" }], options())
    ).toThrow(DocumentOpError);
  });

  it("leaves the input untouched", () => {
    const before = page();
    const copy = cloneJson(before);
    applyOps(before, [{ id: "a", op: "remove" }], options());
    expect(before).toEqual(copy);
  });
});

describe("fillIds", () => {
  it("fills missing and repeated ids in raw JSON", () => {
    const raw = {
      root: {
        children: [
          { role: "paragraph", text: "x", type: "text" },
          { id: "same", role: "paragraph", text: "y", type: "text" },
          { id: "same", role: "paragraph", text: "z", type: "text" },
        ],
        id: "root",
        type: "page",
      },
      version: 1,
    };
    expect(fillIds(raw)).toBe(true);
    const got = raw.root.children.map((c) => (c as { id?: string }).id);
    expect(new Set(got).size).toBe(3);
    expect(got[1]).toBe("same");
    expect(fillIds(raw)).toBe(false);
  });
});

describe("touchedBy", () => {
  it("names what was set, moved or made, not what was removed or the root", () => {
    const before: DesignNode = {
      children: [
        { id: "a", role: "paragraph", text: "A", type: "text" },
        { id: "b", role: "paragraph", text: "B", type: "text" },
        { id: "c", role: "paragraph", text: "C", type: "text" },
      ],
      id: "root",
      type: "page",
    };
    const ops: DocOp[] = [
      { id: "a", op: "update", set: { text: "A!" } },
      { id: "b", op: "remove" },
      { id: "c", index: 0, op: "move", parent: null },
      { id: "root", op: "update", set: { gap: 8 } },
    ];
    const { root } = applyOps(before, ops, {
      canvas: false,
      next: () => "x_1",
    });
    expect(touchedBy(ops, [], root).sort()).toEqual(["a", "c"]);
  });

  it("names an inserted node by the id it got, not the node that had its id", () => {
    const before: DesignNode = {
      children: [{ id: "a", role: "paragraph", text: "A", type: "text" }],
      id: "root",
      type: "page",
    };
    const ops: DocOp[] = [
      {
        node: { id: "a", role: "paragraph", text: "New", type: "text" },
        op: "insert",
        parent: null,
      },
    ];
    const { created, root } = applyOps(before, ops, {
      canvas: false,
      next: () => "x_1",
    });
    expect(touchedBy(ops, created, root)).toEqual(["x_1"]);
  });
});

describe("an instance's layers (ADR 0114)", () => {
  const shell = (overrides?: InstanceNode["overrides"]): PageNode => ({
    children: [
      {
        component: "Shell",
        from: "#app",
        id: "shell",
        type: "instance",
        ...(overrides && { overrides }),
      },
    ],
    id: "root",
    type: "page",
  });
  const overridesOf = (root: DesignNode) =>
    (findNode(root, "shell") as InstanceNode).overrides;

  it("are changed as the instance's overrides, a breakpoint's in their own `at`", () => {
    const { root } = applyOps(
      shell({ side: { gap: 4 } }),
      [
        { id: "shell/side", op: "update", set: { fill: "#111" } },
        { at: "md", id: "shell/side", op: "update", set: { gap: 8 } },
        { id: "shell/nav/text", op: "update", set: { color: "red" } },
      ],
      options()
    );
    expect(overridesOf(root)).toEqual({
      "nav/text": { color: "red" },
      side: { at: { md: { gap: 8 } }, fill: "#111", gap: 4 },
    });
  });

  it("are given back to the main component's value by a null, field by field", () => {
    const { root } = applyOps(
      shell({ "nav/text": { color: "red" }, side: { fill: "#111", gap: 4 } }),
      [
        { id: "shell/side", op: "update", set: { gap: null } },
        { id: "shell/nav/text", op: "update", set: { color: null } },
      ],
      options()
    );
    expect(overridesOf(root)).toEqual({ side: { fill: "#111" } });
    const cleared = applyOps(
      root,
      [{ id: "shell/side", op: "update", set: { fill: null } }],
      options()
    ).root;
    expect(overridesOf(cleared)).toBeUndefined();
  });

  it("turn a layer's row into a column and back, as a container's own type", () => {
    const { root } = applyOps(
      shell(),
      [{ id: "shell/side", op: "update", set: { type: "row" } }],
      options()
    );
    expect(overridesOf(root)).toEqual({ side: { type: "row" } });
    const back = applyOps(
      root,
      [{ id: "shell/side", op: "update", set: { type: null } }],
      options()
    ).root;
    expect(overridesOf(back)).toBeUndefined();
  });

  it("turn a layer's row into a column from a breakpoint on", () => {
    const { root } = applyOps(
      shell(),
      [{ at: "md", id: "shell/side", op: "update", set: { type: "column" } }],
      options()
    );
    expect(overridesOf(root)).toEqual({
      side: { at: { md: { type: "column" } } },
    });
  });

  it("turn only a container's kind, from a breakpoint on only a row or a column's", () => {
    const kinds = (kind: string) => ({ ...options(), kindOf: () => kind });
    expect(() =>
      applyOps(
        shell(),
        [{ id: "shell/title", op: "update", set: { type: "row" } }],
        kinds("text")
      )
    ).toThrow(DocumentOpError);
    expect(() =>
      applyOps(
        shell(),
        [{ at: "md", id: "shell/side", op: "update", set: { type: "row" } }],
        kinds("group")
      )
    ).toThrow(DocumentOpError);
    expect(
      overridesOf(
        applyOps(
          shell(),
          [{ id: "shell/side", op: "update", set: { type: "group" } }],
          kinds("column")
        ).root
      )
    ).toEqual({ side: { type: "group" } });
  });

  it("refuse turning a layer whose kind is not known, an instance inserted by the batch read as it is", () => {
    const unknown = { ...options(), kindOf: () => undefined };
    expect(() =>
      applyOps(
        shell(),
        [{ id: "shell/side", op: "update", set: { type: "row" } }],
        unknown
      )
    ).toThrow(DocumentOpError);
    const fromTree = {
      ...options(),
      kindOf: (_: string, tree: DesignNode) =>
        findNode(tree, "late") ? "text" : undefined,
    };
    expect(() =>
      applyOps(
        shell(),
        [
          {
            node: {
              component: "Shell",
              from: "#app",
              id: "late",
              type: "instance",
            },
            op: "insert",
            parent: "root",
          },
          { id: "late/title", op: "update", set: { type: "row" } },
        ],
        fromTree
      )
    ).toThrow("a text layer cannot become a row");
  });

  it("leave a node of the document whose own id has a slash a node", () => {
    const slashed: PageNode = {
      children: [text("a/b", "Slashed")],
      id: "root",
      type: "page",
    };
    const { root } = applyOps(
      slashed,
      [{ id: "a/b", op: "update", set: { text: "Still a node" } }],
      options()
    );
    expect(findNode(root, "a/b")).toMatchObject({ text: "Still a node" });
  });

  it("set a nested instance's props for this instance alone", () => {
    const { root } = applyOps(
      shell(),
      [{ id: "shell/nav", op: "setProps", props: { label: "Home" } }],
      options()
    );
    expect(overridesOf(root)).toEqual({ nav: { props: { label: "Home" } } });
  });

  it("are hidden when removed, never taken out of the component", () => {
    const { root } = applyOps(
      shell(),
      [{ id: "shell/side", op: "remove" }],
      options()
    );
    expect(overridesOf(root)).toEqual({ side: { hidden: true } });
  });

  it("are never moved, wrapped, duplicated or given nodes: that is the main component's", () => {
    for (const op of [
      { id: "shell/side", index: 0, op: "move", parent: "root" },
      { ids: ["shell/side"], op: "wrap", type: "row" },
      { id: "shell/side", op: "duplicate" },
      { node: text("x"), op: "insert", parent: "shell/side" },
      { id: "shell/side", op: "update", set: { children: [] } },
    ] as DocOp[]) {
      expect(() => applyOps(shell(), [op], options())).toThrow(DocumentOpError);
    }
  });

  it("name their instance as what the operations touched", () => {
    const ops: DocOp[] = [{ id: "shell/side", op: "update", set: { gap: 2 } }];
    const { created, root } = applyOps(shell(), ops, options());
    expect(touchedBy(ops, created, root)).toEqual(["shell"]);
  });
});

describe("a text's runs", () => {
  const legal = (fields: Partial<TextNode> = {}): PageNode => ({
    children: [
      {
        id: "legal",
        role: "paragraph",
        text: "By signing up you accept the terms",
        type: "text",
        ...fields,
      },
    ],
    id: "root",
    type: "page",
  });
  const RUNS: TextRun[] = [
    { text: "By signing up you accept the " },
    { link: "terms.page.json", text: "terms", underline: true },
  ];
  /** The runs as an operation's `set` holds them, as JSON. */
  const RUNS_SET = RUNS as unknown as JsonValue;
  const legalOf = (root: DesignNode) => findNode(root, "legal") as TextNode;

  it("keep text as their words joined, which a reader that knows no runs shows", () => {
    const { root } = applyOps(
      legal(),
      [{ id: "legal", op: "update", set: { runs: RUNS_SET, text: "stale" } }],
      options()
    );
    expect(legalOf(root).text).toBe("By signing up you accept the terms");
    expect(legalOf(root).runs).toEqual(RUNS);

    const inserted = applyOps(
      legal(),
      [
        {
          node: {
            id: "note",
            role: "paragraph",
            runs: [{ text: "Read " }, { text: "this", underline: true }],
            text: "",
            type: "text",
          },
          op: "insert",
          parent: "root",
        },
      ],
      options()
    );
    expect((findNode(inserted.root, "note") as TextNode).text).toBe(
      "Read this"
    );
  });

  it("read as plain words once none is a link or an underline, and lose a run of no words", () => {
    const { root } = applyOps(
      legal({ runs: RUNS }),
      [
        {
          id: "legal",
          op: "update",
          set: {
            runs: [
              { text: "By signing up you accept " },
              { text: "the terms" },
              { link: "terms.page.json", text: "" },
            ],
          },
        },
      ],
      options()
    );
    expect(legalOf(root).runs).toBeUndefined();
    expect(legalOf(root).text).toBe("By signing up you accept the terms");
  });

  it("go when text is set alone, and the answer says its links were dropped", () => {
    const ops: DocOp[] = [
      { id: "legal", op: "update", set: { text: "You accept the terms" } },
    ];
    const { found, root } = applyOps(legal({ runs: RUNS }), ops, options());
    expect(legalOf(root).runs).toBeUndefined();
    expect(legalOf(root).text).toBe("You accept the terms");
    expect(runsDropped(found, root)).toEqual([
      {
        message:
          "text set alone took off its runs (a link and an underline): set runs with the words to keep them",
        nodeId: "legal",
      },
    ]);
  });

  it("stay when text is set to their own words, and nothing is said", () => {
    const same = applyOps(
      legal({ runs: RUNS }),
      [
        {
          id: "legal",
          op: "update",
          set: { text: "By signing up you accept the terms" },
        },
      ],
      options()
    );
    expect(legalOf(same.root).runs).toEqual(RUNS);
    expect(runsDropped(same.found, same.root)).toEqual([]);
  });

  /** Applying the operations, to be refused. */
  const applying = (root: PageNode, ops: DocOp[]) => () =>
    applyOps(root, ops, options());

  it("never link inside a text that links as a whole", () => {
    expect(
      applying(legal({ link: "home.page.json" }), [
        { id: "legal", op: "update", set: { runs: RUNS_SET } },
      ])
    ).toThrow(BOTH_LINKS_RE);
    expect(
      applying(page(), [
        {
          node: {
            id: "both",
            link: "home.page.json",
            role: "paragraph",
            runs: RUNS,
            text: "",
            type: "text",
          },
          op: "insert",
          parent: "root",
        },
      ])
    ).toThrow(BOTH_LINKS_RE);
  });

  it("keep a text from linking as a whole once its words link", () => {
    expect(
      applying(legal({ runs: RUNS }), [
        { id: "legal", op: "update", set: { link: "home.page.json" } },
      ])
    ).toThrow(BOTH_LINKS_RE);
  });

  it("underline words of a text that links as a whole: an underline is no link", () => {
    const underlined = applyOps(
      legal({ link: "home.page.json" }),
      [
        {
          id: "legal",
          op: "update",
          set: {
            runs: [
              { text: "By signing up" },
              { text: " you accept the terms", underline: true },
            ],
          },
        },
      ],
      options()
    );
    expect(legalOf(underlined.root).runs).toHaveLength(2);
  });

  it("are the same at every breakpoint", () => {
    expect(() =>
      applyOps(
        legal(),
        [{ at: "md", id: "legal", op: "update", set: { runs: RUNS_SET } }],
        options()
      )
    ).toThrow(FIXED_RUNS_RE);
  });

  it("keep a text's words the same at every breakpoint", () => {
    expect(() =>
      applyOps(
        legal({ runs: RUNS }),
        [{ at: "md", id: "legal", op: "update", set: { text: "Accept" } }],
        options()
      )
    ).toThrow(NAMES_RUNS_RE);
    expect(() =>
      applyOps(
        legal({ at: { md: { text: "Accept the terms" } } }),
        [{ id: "legal", op: "update", set: { runs: RUNS_SET } }],
        options()
      )
    ).toThrow(NAMES_RUNS_RE);
  });
});
