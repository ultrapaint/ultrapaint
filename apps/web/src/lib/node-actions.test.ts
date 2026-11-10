import "../testing/fake-browser.ts";
import type {
  AppliedChanges,
  ApplyInput,
  DesignNode,
  DocumentState,
} from "@ultrapaint/contracts/document";
import { applyOps } from "@ultrapaint/design-document/ops";
import { canvasDocOf, canvasOfDoc } from "@ultrapaint/design-document/tree";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { endDrag, useDrag } from "../canvas/drag.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { select, selectMany } from "../state/selection.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { pasteInto } from "./clipboard.ts";
import {
  deleteSelection,
  duplicateSelection,
  insertNodesAt,
  moveNode,
  resetAt,
  setField,
  setHidden,
  showBy,
  updateNodes,
  updateSelection,
  wrapSelection,
} from "./node-actions.ts";
import { ALIGN } from "./node-fields.ts";
import { spacingOf } from "./sides.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const HOME = "home.page.json";
const ABOUT = "about.page.json";
/** A view of the home page at 800 px: `md`, of the default breakpoints. */
const TABLET = `${HOME}#tablet`;
/** A view of the home page at 390 px: below the first breakpoint, the base. */
const PHONE = `${HOME}#phone`;
const CANVAS = canvasDocOf("main");

const text = (id: string, extra: Partial<DesignNode> = {}): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text", ...extra }) as DesignNode;

const column = (id: string, children: DesignNode[]): DesignNode => ({
  children,
  id,
  type: "column",
});

const stateOf = (doc: string, root: DesignNode): DocumentState => ({
  doc,
  hash: `${doc}@0`,
  root,
});

let ids = 0;
/** Each state the fake server answers with has a hash of its own. */
let versions = 0;

/** The server's side of `documents.apply`: the operations applied to the documents the editor has. */
const serve = () =>
  fakeApi.respond("documents.apply", (input: ApplyInput): AppliedChanges => {
    const states = new Map<string, DocumentState>();
    const created: string[] = [];
    for (const { doc, ops } of input.edits) {
      const before = states.get(doc) ?? useDocuments.getState().docs[doc];
      if (!before?.root) {
        throw new Error(`no document ${doc}`);
      }
      const applied = applyOps(before.root, ops, {
        canvas: canvasOfDoc(doc) !== null,
        next: (prefix = "n") => {
          ids += 1;
          return `${prefix}_${ids}`;
        },
      });
      created.push(...applied.created);
      versions += 1;
      states.set(doc, { doc, hash: `${doc}@${versions}`, root: applied.root });
    }
    return { changes: [...states.values()], created };
  });

/** The requests sent to the server to change documents: one each is one undo step. */
const applied = () =>
  fakeApi.calls
    .filter((c) => c.method === "documents.apply")
    .map((c) => c.input as ApplyInput);

const selected = () => {
  const { also, selection } = useEditor.getState();
  return selection ? [selection, ...also] : [];
};

const initial = useEditor.getState();

beforeEach(() => {
  fakeApi.reset();
  serve();
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main", variants: [] }],
    info: {
      configured: true,
      storage: { mode: "managed" },
    },
    pages: [],
  });
  useEditor.setState(initial, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [ABOUT]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 1200 },
      [HOME]: {
        height: 900,
        preset: "desktop",
        views: [
          { height: 900, id: "tablet", width: 800, x: 1600, y: 0 },
          { height: 900, id: "phone", width: 390, x: 2500, y: 0 },
        ],
        width: 1440,
        x: 0,
        y: 0,
      },
      [PHONE]: { height: 900, preset: "custom", width: 390, x: 2500, y: 0 },
      [TABLET]: { height: 900, preset: "custom", width: 800, x: 1600, y: 0 },
    },
  });
  useDocuments.setState({
    canvas: "main",
    docs: {
      [ABOUT]: stateOf(ABOUT, {
        children: [text("intro")],
        id: "about",
        type: "page",
      }),
      [CANVAS]: stateOf(CANVAS, {
        children: [{ ...text("note"), x: 2000, y: 1500 }],
        id: "canvas",
        type: "group",
      }),
      [HOME]: stateOf(HOME, {
        children: [
          column("hero", [text("title"), text("lede")]),
          column("list", [text("a", { at: { md: { hidden: true } } })]),
        ],
        id: "home",
        type: "page",
      }),
    },
    loaded: true,
  });
});

describe("a field edited", () => {
  it("lands at the breakpoint of the view it is edited in, as one step", async () => {
    select({ frame: TABLET, nodeId: "hero" });
    await updateSelection({ gap: "$spacing-6" }, "Change gap");
    expect(applied()).toEqual([
      {
        edits: [
          {
            doc: HOME,
            ops: [
              {
                at: "md",
                id: "hero",
                op: "update",
                set: { gap: "$spacing-6" },
              },
            ],
          },
        ],
        label: "Change gap",
      },
    ]);
    expect(selected()).toEqual([{ frame: TABLET, nodeId: "hero" }]);
  });

  it("changes the node's own fields in a view below the first breakpoint", async () => {
    select({ frame: PHONE, nodeId: "hero" });
    await updateSelection({ gap: "$spacing-2" });
    expect(applied()[0]?.edits).toEqual([
      {
        doc: HOME,
        ops: [{ id: "hero", op: "update", set: { gap: "$spacing-2" } }],
      },
    ]);
  });

  it("takes the override away when a field is set back to what it inherits", async () => {
    select({ frame: TABLET, nodeId: "a" });
    await updateSelection({ hidden: false });
    expect(applied()[0]?.edits[0]?.ops).toEqual([
      { at: "md", id: "a", op: "update", set: { hidden: null } },
    ]);
  });

  it("takes the override away when sides are set back to what they inherit, in whatever order", async () => {
    const padded = (padding: DesignNode["padding"]): DesignNode => ({
      at: { md: { padding: "$spacing-6" } },
      children: [],
      id: "padded",
      padding,
      type: "column",
    });
    useDocuments.setState((s) => ({
      docs: {
        ...s.docs,
        [HOME]: stateOf(HOME, {
          children: [padded({ bottom: "$spacing-2", top: "$spacing-4" })],
          id: "home",
          type: "page",
        }),
      },
    }));
    select({ frame: TABLET, nodeId: "padded" });
    // As the fields write them: the sides in CSS order, not the order the document is read in.
    await updateSelection({
      padding: spacingOf({ bottom: "$spacing-2", top: "$spacing-4" }),
    });
    expect(applied()[0]?.edits[0]?.ops).toEqual([
      { at: "md", id: "padded", op: "update", set: { padding: null } },
    ]);
  });

  it("edits a page without views where the value it shows comes from", async () => {
    useDocuments.setState((s) => ({
      docs: {
        ...s.docs,
        [ABOUT]: stateOf(ABOUT, {
          children: [
            {
              at: { lg: { gap: "$spacing-4" } },
              children: [],
              id: "box",
              type: "column",
            },
          ],
          id: "about",
          type: "page",
        }),
      },
    }));
    await updateNodes([{ frame: ABOUT, nodeId: "box" }], {
      gap: "$spacing-8",
      padding: "$spacing-2",
    });
    expect(applied()[0]?.edits[0]?.ops).toEqual([
      { at: "lg", id: "box", op: "update", set: { gap: "$spacing-8" } },
      { id: "box", op: "update", set: { padding: "$spacing-2" } },
    ]);
  });

  it("lands at the view the selection is in when the page's frame names the node", async () => {
    // The layers name pages, not views: a row's eye hides the node where it is being looked at.
    select({ frame: TABLET, nodeId: "title" });
    await setHidden(true, { frame: HOME, nodeId: "title" });
    expect(applied()[0]?.edits[0]?.ops).toEqual([
      { at: "md", id: "title", op: "update", set: { hidden: true } },
    ]);
  });

  it("sets every node selected in one request", async () => {
    selectMany([
      { frame: TABLET, nodeId: "title" },
      { frame: TABLET, nodeId: "lede" },
    ]);
    await updateSelection({ fontWeight: 700 }, "Change fontWeight");
    expect(applied()).toHaveLength(1);
    expect(applied()[0]?.edits[0]?.ops).toEqual([
      { at: "md", id: "title", op: "update", set: { fontWeight: 700 } },
      { at: "md", id: "lede", op: "update", set: { fontWeight: 700 } },
    ]);
  });

  it("aligns a text to the start where its view draws it, unset where nothing below differs", async () => {
    useDocuments.setState((s) => ({
      docs: {
        ...s.docs,
        [HOME]: stateOf(HOME, {
          children: [
            column("hero", [text("title", { align: "center" }), text("lede")]),
          ],
          id: "home",
          type: "page",
        }),
      },
    }));
    await setField(ALIGN, "start", [{ frame: TABLET, nodeId: "title" }]);
    await setField(ALIGN, "start", [{ frame: TABLET, nodeId: "lede" }]);
    await setField(ALIGN, "start", [{ frame: PHONE, nodeId: "title" }]);
    expect(applied().map((a) => [a.label, a.edits[0]?.ops])).toEqual([
      [
        "Align the text",
        [{ at: "md", id: "title", op: "update", set: { align: "start" } }],
      ],
      [
        "Align the text",
        [{ at: "md", id: "lede", op: "update", set: { align: null } }],
      ],
      ["Align the text", [{ id: "title", op: "update", set: { align: null } }]],
    ]);
  });

  it("types text in a view at its breakpoint, and resizes a node on the canvas in its own fields", async () => {
    await updateNodes([{ frame: TABLET, nodeId: "title" }], { text: "Hi" });
    await updateNodes(
      [{ frame: "node:note", nodeId: "note" }],
      { height: 40, width: 200, x: 2000, y: 1500 },
      "Resize"
    );
    expect(applied().map((a) => a.edits[0]?.ops)).toEqual([
      [{ at: "md", id: "title", op: "update", set: { text: "Hi" } }],
      [
        {
          id: "note",
          op: "update",
          set: { height: 40, width: 200, x: 2000, y: 1500 },
        },
      ],
    ]);
  });
});

describe("an edit that names its breakpoints", () => {
  it("resets a field at the breakpoint named, from any view", async () => {
    select({ frame: PHONE, nodeId: "a" });
    await resetAt({ frame: PHONE, nodeId: "a" }, "md", "hidden");
    expect(applied()[0]).toEqual({
      edits: [
        {
          doc: HOME,
          ops: [{ at: "md", id: "a", op: "update", set: { hidden: null } }],
        },
      ],
      label: "Reset hidden at md",
    });
  });

  it("shows a node by one rule, its own fields and its breakpoints' together", async () => {
    await showBy(
      { frame: TABLET, nodeId: "a" },
      { at: "lg", kind: "from" },
      "Show at from lg up"
    );
    const [op] = applied()[0]?.edits[0]?.ops ?? [];
    expect(op).toMatchObject({ id: "a", op: "update" });
    expect(op && "at" in op).toBe(false);
    const after = useDocuments.getState().docs[HOME]?.root;
    expect(JSON.stringify(after)).toContain('"lg":{"hidden":false}');
  });
});

describe("inserting", () => {
  it("pastes into the selected container, hidden below the view's breakpoint, and selects what landed", async () => {
    select({ frame: TABLET, nodeId: "list" });
    await pasteInto(undefined, [{ ...text("copy"), x: 10, y: 20 }]);
    expect(applied()).toEqual([
      {
        edits: [
          {
            doc: HOME,
            ops: [
              {
                node: {
                  ...text("copy"),
                  at: { md: { hidden: false } },
                  hidden: true,
                },
                op: "insert",
                parent: "list",
              },
            ],
          },
        ],
        label: "Paste",
      },
    ]);
    expect(selected()).toEqual([{ frame: TABLET, nodeId: "copy" }]);
  });

  it("puts nodes on the canvas one after the other, and selects as many as one frame shows", async () => {
    const created = await insertNodesAt(
      { at: { x: 100.4, y: 200 }, kind: "canvas" },
      [text("one"), text("two")],
      "Paste"
    );
    expect(created).toEqual(["one", "two"]);
    expect(applied()[0]?.edits).toEqual([
      {
        doc: CANVAS,
        ops: [
          {
            node: { ...text("one"), x: 100, y: 200 },
            op: "insert",
            parent: null,
          },
          {
            node: { ...text("two"), x: 124, y: 224 },
            op: "insert",
            parent: null,
          },
        ],
      },
    ]);
    expect(selected()).toEqual([{ frame: "node:one", nodeId: "one" }]);
  });

  it("inserts in a page's own frame without views at the base", async () => {
    await insertNodesAt(
      { frame: ABOUT, index: 0, kind: "into", parent: "about" },
      [text("new")]
    );
    expect(applied()[0]).toEqual({
      edits: [
        {
          doc: ABOUT,
          ops: [{ index: 0, node: text("new"), op: "insert", parent: "about" }],
        },
      ],
      label: "Insert",
    });
    expect(selected()).toEqual([{ frame: ABOUT, nodeId: "new" }]);
  });
});

describe("moving", () => {
  it("moves within a page, at the breakpoint of no view, and selects it where it landed", async () => {
    await moveNode(
      { frame: HOME, nodeId: "lede" },
      { frame: TABLET, index: 0, kind: "into", parent: "list" }
    );
    expect(applied()).toEqual([
      {
        edits: [
          {
            doc: HOME,
            ops: [{ id: "lede", index: 0, op: "move", parent: "list" }],
          },
        ],
        label: "Move",
      },
    ]);
    expect(selected()).toEqual([{ frame: TABLET, nodeId: "lede" }]);
  });

  it("takes a node out of one page and puts it in another, as a Layers drop does", async () => {
    await moveNode(
      { frame: HOME, nodeId: "title" },
      { frame: ABOUT, index: 1, kind: "into", parent: "about" }
    );
    expect(applied()).toEqual([
      {
        edits: [
          { doc: HOME, ops: [{ id: "title", op: "remove" }] },
          {
            doc: ABOUT,
            ops: [
              { index: 1, node: text("title"), op: "insert", parent: "about" },
            ],
          },
        ],
        label: "Move",
      },
    ]);
    expect(selected()).toEqual([{ frame: ABOUT, nodeId: "title" }]);
  });

  it("moves a node onto the canvas where it was let go, selected in its own frame", async () => {
    await moveNode(
      { frame: HOME, nodeId: "title" },
      { at: { x: 30, y: 40 }, kind: "canvas" }
    );
    expect(applied()[0]).toMatchObject({
      edits: [
        { doc: HOME, ops: [{ id: "title", op: "remove" }] },
        {
          doc: CANVAS,
          ops: [
            {
              node: { ...text("title"), x: 30, y: 40 },
              op: "insert",
              parent: null,
            },
          ],
        },
      ],
      label: "Move onto the canvas",
    });
    expect(selected()).toEqual([{ frame: "node:title", nodeId: "title" }]);
  });

  it("only places a node on the canvas moved around it, keeping the selection", async () => {
    select({ frame: "node:note", nodeId: "note" });
    await moveNode(
      { frame: "node:note", nodeId: "note" },
      { at: { x: 10, y: 20 }, kind: "canvas" }
    );
    expect(applied()).toEqual([
      {
        edits: [
          {
            doc: CANVAS,
            ops: [{ id: "note", op: "update", set: { x: 10, y: 20 } }],
          },
        ],
        label: "Move on the canvas",
      },
    ]);
    expect(selected()).toEqual([{ frame: "node:note", nodeId: "note" }]);
  });

  it("copies a node dragged with Alt into a view as an insert there", async () => {
    const drop = {
      box: null,
      frame: TABLET,
      index: 1,
      kind: "into" as const,
      line: null,
      parent: "list",
    };
    useDrag.setState({
      copy: true,
      dragged: {
        frame: TABLET,
        kind: "node",
        node: text("title"),
        rect: { height: 20, width: 100, x: 0, y: 0 },
      },
      drop,
    });
    await endDrag();
    expect(applied()).toEqual([
      {
        edits: [
          {
            doc: HOME,
            ops: [
              {
                index: 1,
                node: {
                  ...text("title"),
                  at: { md: { hidden: false } },
                  hidden: true,
                },
                op: "insert",
                parent: "list",
              },
            ],
          },
        ],
        label: "Copy",
      },
    ]);
    const [copy] = selected();
    expect(copy?.frame).toBe(TABLET);
    expect(copy?.nodeId).not.toBe("title");
  });
});

describe("the tree changed", () => {
  it("deletes the selection less what goes with its container, and lets it go", async () => {
    selectMany([
      { frame: TABLET, nodeId: "hero" },
      { frame: TABLET, nodeId: "title" },
    ]);
    await deleteSelection();
    expect(applied()).toEqual([
      {
        edits: [{ doc: HOME, ops: [{ id: "hero", op: "remove" }] }],
        label: "Delete",
      },
    ]);
    expect(selected()).toEqual([]);
  });

  it("wraps siblings in a row and selects the row in the view they were in", async () => {
    selectMany([
      { frame: TABLET, nodeId: "title" },
      { frame: TABLET, nodeId: "lede" },
    ]);
    await wrapSelection("row");
    expect(applied()).toEqual([
      {
        edits: [
          {
            doc: HOME,
            ops: [{ ids: ["title", "lede"], op: "wrap", type: "row" }],
          },
        ],
        label: "Wrap in a row",
      },
    ]);
    const [wrapper] = selected();
    expect(wrapper?.frame).toBe(TABLET);
    const root = useDocuments.getState().docs[HOME]?.root;
    const hero = root && "children" in root ? root.children?.[0] : undefined;
    expect(hero && "children" in hero && hero.children?.[0]?.id).toBe(
      wrapper?.nodeId
    );
  });

  it("selects the copies a duplicate made, in the frame of the originals", async () => {
    select({ frame: PHONE, nodeId: "title" });
    await duplicateSelection();
    expect(applied()).toEqual([
      {
        edits: [{ doc: HOME, ops: [{ id: "title", op: "duplicate" }] }],
        label: "Duplicate",
      },
    ]);
    const [copy] = selected();
    expect(copy?.frame).toBe(PHONE);
    expect(copy?.nodeId).not.toBe("title");
  });
});
