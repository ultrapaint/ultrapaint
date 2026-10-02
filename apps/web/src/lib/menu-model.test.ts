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
  sharedTokenFields,
  textStyleEntries,
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
  count: 1,
  hidden: false,
  index: 1,
  node: row,
  onPage: true,
  parentSelectable: true,
  siblings: 3,
  wrappable: true,
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
  it("offers a link to a page, back or a URL, only in a page", () => {
    const linked = { ...text, link: "pricing.page.json" };
    const entries = nodeEntries(
      facts({
        linkTargets: [{ name: "Pricing", path: "pricing.page.json" }],
        node: linked,
      })
    );
    expect(find(entries, "link:pricing.page.json")).toMatchObject({
      checked: true,
    });
    expect(ids(entries)).toContain("link:none");
    expect(ids(nodeEntries(facts({ onPage: false })))).not.toContain("link");
  });

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

  it("locks a node, and unlocks a locked one, but not a page", () => {
    expect(find(nodeEntries(facts()), "toggleLocked")).toMatchObject({
      label: "Lock",
    });
    expect(
      find(
        nodeEntries(facts({ node: { ...row, locked: true } })),
        "toggleLocked"
      )
    ).toMatchObject({ label: "Unlock" });
    expect(
      find(nodeEntries(facts({ node: page })), "toggleLocked")
    ).toBeUndefined();
  });

  it("says Show when every node it acts on is hidden", () => {
    expect(
      find(nodeEntries(facts({ hidden: true })), "toggleHidden")
    ).toMatchObject({ label: "Show" });
    expect(find(nodeEntries(facts()), "toggleHidden")).toMatchObject({
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
      "ask",
      "askNew",
      "copy",
      "cut",
      "duplicate",
      "wrap",
      "toggleHidden",
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
    name: "Home",
    onCanvas: true,
    preset: "mobile" as const,
    route: "/",
    variantsFree: ["bold"],
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

  it("copies and moves into the other canvases, the root one among them", () => {
    const copy = find(pageEntries(base), "copyTo");
    expect(copy).toMatchObject({ label: "Copy page to canvas" });
    const into =
      copy?.kind === "submenu"
        ? copy.entries.map((e) => ("id" in e ? e.id : e.kind))
        : [];
    expect(into).toEqual(["copyTo:@", "separator", "copyTo:new"]);
    expect(find(pageEntries({ ...base, count: 3 }), "moveTo")).toMatchObject({
      label: "Move 3 pages to canvas",
    });
  });

  it("draws a base page for a variant, and a variant's page for none", () => {
    const variants = find(pageEntries(base), "variant");
    expect(
      variants?.kind === "submenu"
        ? variants.entries.map((e) => ("id" in e ? e.id : e.kind))
        : []
    ).toEqual(["variant:bold", "separator", "variant:new"]);
    expect(ids(pageEntries({ ...base, variant: "bold" }))).not.toContain(
      "variant"
    );
  });
});

describe("the menu of a canvas in the list", () => {
  const base = { current: false, first: false, last: false, only: false };

  it("opens another canvas, and keeps the last one from being deleted", () => {
    expect(ids(canvasListEntries(base))).toContain("openCanvas");
    expect(ids(canvasListEntries({ ...base, current: true }))).not.toContain(
      "openCanvas"
    );
    expect(
      find(canvasListEntries({ ...base, only: true }), "delete")
    ).toMatchObject({
      disabled: true,
    });
  });

  it("moves only where there is room", () => {
    expect(
      find(canvasListEntries({ ...base, first: true }), "moveUp")
    ).toMatchObject({
      disabled: true,
    });
    expect(
      find(canvasListEntries({ ...base, last: true }), "moveDown")
    ).toMatchObject({
      disabled: true,
    });
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
    expect(tokenFields("borderWidth", row).map((f) => f.field)).toEqual([
      "border.width",
    ]);
    expect(tokenFields("container", row).map((f) => f.field)).toEqual([
      "maxWidth",
      "minWidth",
    ]);
    expect(tokenFields("other", row)).toEqual([]);
  });

  it("cannot be applied with nothing selected", () => {
    const got = tokenEntries({
      kind: "radius",
      name: "radius-lg",
      selected: [],
      value: "0.5rem",
    });
    expect(find(got, "apply")).toMatchObject({ disabled: true });
    expect(ids(got)).toContain("copyRef");
  });

  it("fit only the fields every selected node has", () => {
    expect(sharedTokenFields("color", [text, row]).map((f) => f.field)).toEqual(
      ["fill", "border.color"]
    );
    expect(sharedTokenFields("font", [text, row])).toEqual([]);
    expect(sharedTokenFields("color", [])).toEqual([]);
    const got = tokenEntries({
      kind: "color",
      name: "primary",
      selected: [text, row],
      value: "#000",
    });
    expect(find(got, "apply")).toMatchObject({
      disabled: false,
      label: "Apply to 2 elements",
    });
  });
});

describe("text styles", () => {
  it("apply when every selected node is text", () => {
    const other: DesignNode = { ...text, id: "t2" };
    const texts = textStyleEntries({ name: "Body", selected: [text, other] });
    expect(find(texts, "apply:textStyle")).toMatchObject({
      disabled: false,
      label: "Apply to 2 elements",
    });
    const mixed = textStyleEntries({ name: "Body", selected: [text, row] });
    expect(find(mixed, "apply:textStyle")).toMatchObject({ disabled: true });
  });
});

describe("the Assets menu", () => {
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
