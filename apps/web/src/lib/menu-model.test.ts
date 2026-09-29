import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  canvasEntries,
  commentEntries,
  componentEntries,
  type Entry,
  type NodeFacts,
  nodeEntries,
  pageEntries,
  tidy,
  tokenEntries,
  tokenFields,
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
  index: 1,
  node: row,
  onPage: true,
  parentSelectable: true,
  siblings: 3,
  ...over,
});

/** Every item id of a menu, submenus flattened. */
const ids = (entries: readonly Entry[]): string[] =>
  entries.flatMap((e) => {
    if (e.kind === "item") {
      return [e.id];
    }
    return e.kind === "submenu" ? [e.id, ...ids(e.entries)] : [];
  });

const find = (entries: readonly Entry[], id: string) =>
  entries
    .flatMap((e) => (e.kind === "submenu" ? [e, ...e.entries] : [e]))
    .find((e) => "id" in e && e.id === id);

describe("tidy", () => {
  it("drops separators at the ends, doubled ones and left-out items", () => {
    const sep: Entry = { kind: "separator" };
    const a: Entry = { id: "a", kind: "item", label: "A" };
    expect(tidy([sep, a, false, sep, null, sep, a, sep])).toEqual([a, sep, a]);
  });
});

describe("the node menu", () => {
  it("offers text editing on text only, and unwrapping on containers only", () => {
    expect(ids(nodeEntries(facts({ node: text })))).toContain("editText");
    expect(ids(nodeEntries(facts({ node: text })))).not.toContain("unwrap");
    expect(ids(nodeEntries(facts()))).toContain("unwrap");
    expect(ids(nodeEntries(facts()))).not.toContain("editText");
  });

  it("leaves out what cannot be done to a page's root", () => {
    const got = ids(
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
    expect(find(first, "arrange:up")).toMatchObject({ disabled: true });
    expect(find(first, "arrange:down")).toMatchObject({ disabled: false });
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

  it("comments only on a page, and selects a parent only when there is one", () => {
    const loose = ids(
      nodeEntries(facts({ onPage: false, parentSelectable: false }))
    );
    expect(loose).not.toContain("comment");
    expect(loose).not.toContain("selectParent");
  });

  it("says Show for a hidden node", () => {
    expect(
      find(
        nodeEntries(facts({ node: { ...row, hidden: true } })),
        "toggleHidden"
      )
    ).toMatchObject({ label: "Show" });
  });
});

describe("the page menu", () => {
  const base = {
    canPaste: false,
    name: "Home",
    onCanvas: true,
    preset: "mobile" as const,
    route: "/",
  };

  it("marks the current viewport", () => {
    expect(find(pageEntries(base), "preset:mobile")).toMatchObject({
      checked: true,
    });
    expect(find(pageEntries(base), "preset:desktop")).toMatchObject({
      checked: false,
    });
  });

  it("keeps to what the prototype can show", () => {
    const got = ids(pageEntries({ ...base, onCanvas: false }));
    expect(got).not.toContain("zoomTo");
    expect(got).not.toContain("preset");
    expect(got).toContain("rename");
    expect(got).toContain("delete");
  });
});

describe("the canvas menu", () => {
  it("names the comments toggle after what it does", () => {
    expect(
      find(
        canvasEntries({ canPaste: true, commentsVisible: true }),
        "toggleComments"
      )
    ).toMatchObject({ label: "Hide comments" });
  });
});

describe("the comment menu", () => {
  it("sends to the current session only when it is free", () => {
    const busy = commentEntries({
      current: { busy: true, title: "Work" },
      hasElement: false,
      resolved: false,
    });
    expect(find(busy, "send:current")).toMatchObject({ disabled: true });
    expect(ids(busy)).not.toContain("selectElement");
    const none = commentEntries({
      current: null,
      hasElement: true,
      resolved: true,
    });
    expect(find(none, "send:current")).toMatchObject({ disabled: true });
    expect(find(none, "resolve")).toMatchObject({ label: "Reopen" });
  });
});

describe("tokens", () => {
  it("fit the fields the selected node has", () => {
    expect(tokenFields("color", text).map((f) => f.field)).toEqual([
      "fill",
      "color",
      "border.color",
    ]);
    expect(tokenFields("color", row).map((f) => f.field)).toEqual([
      "fill",
      "border.color",
    ]);
    expect(tokenFields("spacing", row).map((f) => f.field)).toEqual([
      "gap",
      "padding",
      "margin",
    ]);
    expect(tokenFields("spacing", text).map((f) => f.field)).toEqual([
      "padding",
      "margin",
    ]);
    expect(tokenFields("font", row)).toEqual([]);
    expect(tokenFields("size", text).map((f) => f.field)).toEqual(["size"]);
  });

  it("cannot be applied with nothing selected", () => {
    const got = tokenEntries({
      kind: "radius",
      name: "radius-lg",
      selected: null,
      value: "0.5rem",
    });
    expect(find(got, "apply")).toMatchObject({ disabled: true });
    expect(ids(got)).toContain("copyRef");
  });
});

describe("the palette menu", () => {
  it("inserts only where there is somewhere to insert", () => {
    const got = componentEntries({
      isComponent: false,
      name: "Row",
      onCanvas: true,
      target: null,
    });
    expect(find(got, "insert")).toMatchObject({ disabled: true });
    expect(ids(got)).not.toContain("copyName");
  });
});
