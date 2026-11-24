import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  canvasEntries,
  canvasListEntries,
  commentEntries,
  componentEntries,
  type Entry,
  type NodeFacts,
  nodeEntries,
  pageEntries,
  tidy,
} from "./menu-model.ts";

const text: DesignNode = {
  id: "t1",
  role: "paragraph",
  text: "Hello",
  type: "text",
};
const row: DesignNode = { children: [text], id: "r1", type: "row" };
const page: DesignNode = { children: [row], id: "home", type: "page" };

const facts = (over: Partial<NodeFacts> = {}): NodeFacts => ({
  canPaste: false,
  count: 1,
  frame: { kind: "page", page: "home.page.json" },
  hidden: false,
  index: 1,
  node: row,
  parentSelectable: true,
  siblings: 3,
  wrappable: true,
  ...over,
});

type Action = { kind: string } & Record<string, unknown>;

/** Every entry of a menu, a submenu's after it. */
const all = (entries: readonly Entry[]): Entry[] =>
  entries.flatMap((e) => (e.kind === "submenu" ? [e, ...all(e.entries)] : [e]));

/** What each item does and each submenu gathers, in order. */
const kinds = (entries: readonly Entry[]): string[] =>
  all(entries).flatMap((e) => {
    if (e.kind === "item") {
      return [(e.action as Action).kind];
    }
    return e.kind === "submenu" ? [e.id] : [];
  });

/** Whether an action is the one described: every field said is as said. */
const matches = (action: unknown, what: Action) =>
  Object.entries(what).every(
    ([key, value]) => (action as Action)[key] === value
  );

/** The submenu of an id or the first item of an action's kind, or the item of that action. */
const find = (entries: readonly Entry[], what: string | Action) =>
  all(entries).find((e) => {
    if (typeof what !== "string") {
      return e.kind === "item" && matches(e.action, what);
    }
    return (
      (e.kind === "submenu" && e.id === what) ||
      (e.kind === "item" && (e.action as Action).kind === what)
    );
  });

/** A submenu's entries, an item by its action and the rest by their kind. */
const inside = (entry: Entry | undefined) =>
  entry?.kind === "submenu"
    ? entry.entries.map((e) => (e.kind === "item" ? e.action : e.kind))
    : [];

describe("tidy", () => {
  it("drops separators at the ends, doubled ones and left-out items", () => {
    const sep: Entry = { kind: "separator" };
    const a: Entry = { action: "a", kind: "item", label: "A" };
    expect(tidy([sep, a, false, sep, null, sep, a, sep])).toEqual([a, sep, a]);
  });
});

describe("the node menu", () => {
  it("offers a link to a page, back or a URL, only in a page", () => {
    const linked = { ...text, link: "pricing.page.json" };
    const entries = nodeEntries(
      facts({
        linkTargets: [{ name: "Pricing", path: "pricing.page.json" }],
        node: linked,
      })
    );
    expect(
      find(entries, { kind: "link", to: "pricing.page.json" })
    ).toMatchObject({
      checked: true,
    });
    expect(find(entries, { kind: "link", to: null })).toMatchObject({
      label: "Remove link",
    });
    expect(
      kinds(nodeEntries(facts({ frame: { kind: "node", node: "r1" } })))
    ).not.toContain("link");
  });

  it("offers text editing on text only, and unwrapping on containers only", () => {
    expect(kinds(nodeEntries(facts({ node: text })))).toContain("editText");
    expect(kinds(nodeEntries(facts({ node: text })))).not.toContain("unwrap");
    expect(kinds(nodeEntries(facts()))).toContain("unwrap");
    expect(kinds(nodeEntries(facts()))).not.toContain("editText");
  });

  it("leaves out what cannot be done to a page's root", () => {
    const got = kinds(
      nodeEntries(facts({ node: page, parentSelectable: false }))
    );
    for (const id of [
      "copy",
      "cut",
      "duplicate",
      "wrap",
      "arrange",
      "delete",
    ]) {
      expect(got).not.toContain(id);
    }
    expect(got).toContain("paste");
  });

  it("greys out moves that go nowhere", () => {
    const first = nodeEntries(facts({ index: 0 }));
    expect(find(first, { kind: "arrange", to: "up" })).toMatchObject({
      disabled: true,
    });
    expect(find(first, { kind: "arrange", to: "down" })).toMatchObject({
      disabled: false,
    });
    const only = nodeEntries(facts({ index: 0, siblings: 1 }));
    expect(find(only, "arrange")).toMatchObject({ disabled: true });
  });

  it("pastes only with something copied", () => {
    expect(find(nodeEntries(facts()), "paste")).toMatchObject({
      disabled: true,
    });
    expect(find(nodeEntries(facts({ canPaste: true })), "paste")).toMatchObject(
      { disabled: false }
    );
  });

  it("comments on a node beside the pages, and selects a parent only when there is one", () => {
    const loose = kinds(
      nodeEntries(
        facts({
          frame: { kind: "node", node: "r1" },
          parentSelectable: false,
        })
      )
    );
    expect(loose).toContain("comment");
    expect(loose).not.toContain("selectParent");
  });

  describe("the layers under the pointer (ADR 0143)", () => {
    /** The text in a row on the page, right-clicked on the text, the row selected. */
    const under = [
      { id: "t1", label: "Hello", selected: false },
      { id: "r1", label: "Row", selected: true },
      { id: "home", label: "Home", selected: false },
    ];

    it("are listed in Select layer, deepest first and the page last, the selected ones ticked", () => {
      const layers = find(nodeEntries(facts({ layersUnder: under })), "layers");
      expect(layers).toMatchObject({ label: "Select layer" });
      expect(
        layers?.kind === "submenu" &&
          layers.entries.map((e) =>
            e.kind === "item" ? [e.label, e.action, e.checked === true] : e
          )
      ).toEqual([
        ["Hello", { id: "t1", kind: "selectLayerUnder" }, false],
        ["Row", { id: "r1", kind: "selectLayerUnder" }, true],
        ["Home", { id: "home", kind: "selectLayerUnder" }, false],
      ]);
    });

    it("sit with Select parent", () => {
      const order = kinds(nodeEntries(facts({ layersUnder: under })));
      expect(order.indexOf("layers")).toBe(order.indexOf("selectParent") + 1);
    });

    it("are not offered without a point", () => {
      expect(kinds(nodeEntries(facts()))).not.toContain("layers");
    });

    it("are not offered when there is only one", () => {
      expect(
        kinds(nodeEntries(facts({ layersUnder: under.slice(0, 1) })))
      ).not.toContain("layers");
    });

    it("are offered for several selected as for one", () => {
      expect(
        inside(
          find(nodeEntries(facts({ count: 2, layersUnder: under })), "layers")
        )
      ).toHaveLength(3);
    });
  });

  it("offers a node of a tree on its board nothing of a page's, but what it does to the node", () => {
    const onBoard = kinds(
      nodeEntries(
        facts({
          frame: {
            item: "Promo",
            kind: "board",
            name: "component",
            view: "library",
          },
        })
      )
    );
    for (const kind of [
      "comment",
      "makeApp",
      "link",
      "viewCode",
      "copyLink",
      "copyRef",
    ]) {
      expect(onBoard, kind).not.toContain(kind);
    }
    expect(onBoard).toEqual(
      expect.arrayContaining(["rename", "wrap", "hide", "zoomTo", "delete"])
    );
  });

  it("locks a node, and unlocks a locked one, but not a page", () => {
    expect(find(nodeEntries(facts()), "lock")).toMatchObject({
      label: "Lock",
    });
    expect(
      find(nodeEntries(facts({ node: { ...row, locked: true } })), "lock")
    ).toMatchObject({ label: "Unlock" });
    expect(find(nodeEntries(facts({ node: page })), "lock")).toBeUndefined();
  });

  it("says Show when every node it acts on is hidden", () => {
    expect(find(nodeEntries(facts({ hidden: true })), "hide")).toMatchObject({
      label: "Show",
    });
    expect(find(nodeEntries(facts()), "hide")).toMatchObject({
      label: "Hide",
    });
  });
});

describe("the node menu, several selected", () => {
  const several = nodeEntries(facts({ count: 3, node: text }));

  it("says how many it acts on", () => {
    expect(several[0]).toEqual({ kind: "label", label: "3 selected" });
    expect(find(several, "delete")).toMatchObject({
      destructive: true,
      label: "Delete 3 elements",
    });
  });

  it("greys out what is about one node only", () => {
    for (const id of [
      "editText",
      "rename",
      "viewCode",
      "comment",
      "selectParent",
      "copyLink",
      "copyRef",
      "arrange",
    ]) {
      expect(find(several, id)).toMatchObject({ disabled: true });
    }
  });

  it("keeps what acts on all of them", () => {
    for (const id of [
      { kind: "ask", newChat: false },
      { kind: "ask", newChat: true },
      "copy",
      "cut",
      "duplicate",
      "wrap",
      "hide",
      "delete",
    ]) {
      expect(find(several, id)).not.toMatchObject({ disabled: true });
    }
  });

  it("wraps them together only when they are siblings", () => {
    expect(
      find(nodeEntries(facts({ count: 2, wrappable: false })), "wrap")
    ).toMatchObject({ disabled: true });
  });

  it("is the menu it was for one node", () => {
    const one = nodeEntries(facts());
    expect(one[0]).toMatchObject({ kind: "label" });
    expect(one[0]).not.toMatchObject({ label: "1 selected" });
    expect(find(one, "rename")).toMatchObject({ disabled: false });
    expect(find(one, "delete")).toMatchObject({ label: "Delete" });
  });
});

describe("the page menu", () => {
  const base = {
    canPaste: false,
    canvases: [{ id: "", name: "App" }],
    count: 1,
    implementation: "draft" as const,
    name: "Home",
    onCanvas: true,
    preset: "mobile" as const,
    route: "/",
    statesFree: [],
    variantsFree: ["bold"],
  };

  it("marks the current viewport", () => {
    expect(
      find(pageEntries(base), { kind: "preset", preset: "mobile" })
    ).toMatchObject({
      checked: true,
    });
    expect(
      find(pageEntries(base), { kind: "preset", preset: "desktop" })
    ).toMatchObject({
      checked: false,
    });
  });

  it("keeps to what the prototype can show", () => {
    const got = kinds(pageEntries({ ...base, onCanvas: false }));
    expect(got).not.toContain("zoomTo");
    expect(got).not.toContain("preset");
    expect(got).toContain("rename");
    expect(got).toContain("delete");
  });

  it("copies and moves into the other canvases, the root one among them", () => {
    const copy = find(pageEntries(base), "copyTo");
    expect(copy).toMatchObject({ label: "Copy page to canvas" });
    expect(inside(copy)).toEqual([
      { canvas: "", kind: "copyTo", move: false },
      "separator",
      { canvas: null, kind: "copyTo", move: false },
    ]);
    expect(inside(find(pageEntries(base), "moveTo"))).toContainEqual({
      canvas: "",
      kind: "copyTo",
      move: true,
    });
    expect(find(pageEntries({ ...base, count: 3 }), "moveTo")).toMatchObject({
      label: "Move 3 pages to canvas",
    });
  });

  it("copies a base page as a new variation (ADR 0098)", () => {
    expect(kinds(pageEntries(base))).toContain("newVariation");
  });

  it("copies no state's page as a variation", () => {
    expect(kinds(pageEntries({ ...base, state: "empty" }))).not.toContain(
      "newVariation"
    );
  });

  it("links one page to its code, or brings several in at once (ADR 0030)", () => {
    const one = kinds(pageEntries(base));
    expect(one).toContain("implement");
    expect(one).toContain("adopt");
    expect(one).toContain("ready");
    expect(
      kinds(pageEntries({ ...base, implementation: "implemented" }))
    ).not.toContain("adopt");
    const several = pageEntries({ ...base, count: 3 });
    expect(find(several, "readyAll")).toMatchObject({
      label: "Mark 3 pages ready to implement",
    });
    expect(find(several, "adopt")).toMatchObject({
      label: "Find the code of 3 pages with an agent",
    });
    expect(kinds(several)).not.toContain("implement");
    expect(kinds(several)).not.toContain("markImplemented");
  });

  it("updates several pages from their code, beside finding it (ADR 0115)", () => {
    expect(
      find(pageEntries({ ...base, count: 3 }), "updateFromCode")
    ).toMatchObject({ label: "Update 3 pages from code" });
  });

  it("updates one page not linked yet from its code, as its Code tab's menu does (ADR 0102)", () => {
    expect(find(pageEntries(base), "updateFromCode")).toMatchObject({
      label: "Update from code",
    });
    expect(
      kinds(pageEntries({ ...base, implementation: "changed" }))
    ).not.toContain("updateFromCode");
  });
});

describe("the menu of a canvas in the list", () => {
  const base = { current: false, first: false, last: false, only: false };

  it("opens another canvas, and keeps the last one from being deleted", () => {
    expect(kinds(canvasListEntries(base))).toContain("openCanvas");
    expect(kinds(canvasListEntries({ ...base, current: true }))).not.toContain(
      "openCanvas"
    );
    expect(
      find(canvasListEntries({ ...base, only: true }), "delete")
    ).toMatchObject({
      disabled: true,
    });
  });

  it("brings every page of a canvas in: ready, or linked to its code by an agent", () => {
    expect(find(canvasListEntries(base), "readyAll")).toMatchObject({
      label: "Mark every page ready to implement",
    });
    expect(find(canvasListEntries(base), "adopt")).toMatchObject({
      label: "Find the pages' code with an agent",
    });
  });

  it("updates its pages from their code (ADR 0115)", () => {
    expect(find(canvasListEntries(base), "updateFromCode")).toMatchObject({
      label: "Update its pages from code",
    });
  });

  it("moves only where there is room", () => {
    expect(
      find(canvasListEntries({ ...base, first: true }), {
        by: -1,
        kind: "move",
      })
    ).toMatchObject({
      disabled: true,
    });
    expect(
      find(canvasListEntries({ ...base, last: true }), { by: 1, kind: "move" })
    ).toMatchObject({
      disabled: true,
    });
  });
});

describe("the canvas menu", () => {
  it("names the comments toggle after what it does", () => {
    expect(
      find(
        canvasEntries({
          canPaste: true,
          commentsVisible: true,
          gridVisible: false,
        }),
        { id: "toggleComments", kind: "command" }
      )
    ).toMatchObject({ label: "Hide comments" });
  });

  it("adds a comment where it was opened", () => {
    expect(
      find(
        canvasEntries({
          canPaste: false,
          commentsVisible: false,
          gridVisible: false,
        }),
        "comment"
      )
    ).toMatchObject({ label: "Add a comment" });
  });

  it("names the grid toggle after what it does", () => {
    const entries = (gridVisible: boolean) =>
      canvasEntries({ canPaste: true, commentsVisible: true, gridVisible });
    expect(find(entries(false), { id: "grid", kind: "command" })).toMatchObject(
      {
        command: "grid",
        label: "Show grid",
      }
    );
    expect(find(entries(true), { id: "grid", kind: "command" })).toMatchObject({
      label: "Hide grid",
    });
  });
});

describe("the comment menu", () => {
  it("sends to the current session only when it is free", () => {
    const busy = commentEntries({
      current: { busy: true, id: "t1", title: "Work" },
      hasElement: false,
      onPage: true,
      resolved: false,
    });
    expect(find(busy, { kind: "send", threadId: "t1" })).toMatchObject({
      disabled: true,
    });
    expect(kinds(busy)).not.toContain("selectElement");
    const none = commentEntries({
      current: null,
      hasElement: true,
      onPage: true,
      resolved: true,
    });
    expect(find(none, "send")).toMatchObject({ label: "Send to an agent" });
    expect(find(none, { kind: "send" })).toMatchObject({
      disabled: true,
      label: "Current chat",
    });
    expect(find(none, "resolve")).toMatchObject({ label: "Reopen" });
  });

  it("makes a behaviour note only of a comment on a page, the canvas being implemented as none", () => {
    const said = { current: null, hasElement: false, resolved: false };
    expect(
      find(commentEntries({ ...said, onPage: true }), "note")
    ).toMatchObject({ label: "Make it a behaviour note" });
    expect(kinds(commentEntries({ ...said, onPage: false }))).not.toContain(
      "note"
    );
  });
});

describe("the Library's menu", () => {
  it("inserts only where there is somewhere to insert", () => {
    const got = componentEntries({
      app: true,
      codeChanged: false,
      name: "Card",
      onCanvas: true,
      ownLook: true,
      target: null,
    });
    expect(find(got, "insert")).toMatchObject({ disabled: true });
    expect(find(got, "copyName")).toMatchObject({ label: "Copy Card" });
  });

  it("opens the component's board, as its row's chevron does under the pointer", () => {
    const got = componentEntries({
      app: true,
      codeChanged: false,
      name: "Card",
      onCanvas: false,
      ownLook: true,
      target: "the page",
    });
    expect(find(got, "openBoard")).toMatchObject({ label: "Open board" });
  });

  it("offers Update from code for a component whose code changed, as its board's menu does (ADR 0122)", () => {
    const card = {
      app: true,
      name: "Card",
      onCanvas: false,
      ownLook: true,
      target: "the page",
    };
    expect(
      find(componentEntries({ ...card, codeChanged: true }), "updateFromCode")
    ).toMatchObject({ label: "Update from code" });
    expect(
      find(componentEntries({ ...card, codeChanged: false }), "updateFromCode")
    ).toBeUndefined();
  });

  it("is the board's menu too, with Implement, and ends on deleting an app component or the look a system component keeps (ADR 0102)", () => {
    const base = {
      codeChanged: false,
      name: "Button",
      onCanvas: false,
      target: "the page",
    };
    const app = componentEntries({ ...base, app: true, ownLook: true });
    expect(find(app, "implement")).toMatchObject({ label: "Implement" });
    expect(find(app, "delete")).toMatchObject({
      destructive: true,
      label: "Delete component",
    });
    const ownLook = componentEntries({ ...base, app: false, ownLook: true });
    expect(find(ownLook, "resetLook")).toMatchObject({
      label: "Reset to default look",
    });
    expect(find(ownLook, "delete")).toBeUndefined();
    const defaultLook = componentEntries({
      ...base,
      app: false,
      ownLook: false,
    });
    expect(find(defaultLook, "takeOver")).toMatchObject({
      label: "Take the look over",
    });
    expect(find(defaultLook, "resetLook")).toBeUndefined();
  });
});
