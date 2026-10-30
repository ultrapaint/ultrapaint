import type {
  AppComponentFile,
  SystemComponentFile,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  changedComponent,
  componentText,
  instanceOps,
  problemOf,
  readComponentFile,
  withTree,
} from "./services/component-files.ts";

const PLAN: AppComponentFile = {
  name: "Plan",
  origin: "app",
  properties: [
    { default: "Pro", kind: "text", name: "title", targets: [{ node: "t" }] },
    {
      default: "plain",
      kind: "choice",
      members: ["plain", "loud"],
      name: "tone",
    },
  ],
  slots: [{ default: true, name: "body", node: "s" }],
  tree: {
    children: [
      {
        at: { md: { size: 24 }, "tone=loud": { color: "red" } },
        id: "t",
        role: "heading",
        text: "Pro",
        type: "text",
      },
      { children: [], id: "s", type: "column" },
    ],
    id: "root",
    type: "column",
  },
  version: 1,
};

const appOf = (next: ReturnType<typeof changedComponent>) => {
  if ("problem" in next) {
    throw new Error(next.problem);
  }
  if (next.origin !== "app") {
    throw new Error(`${next.name} is no app component`);
  }
  return next;
};

const changed = (change: Parameters<typeof changedComponent>[1]) =>
  appOf(changedComponent(PLAN, change));

const atOf = (file: AppComponentFile) =>
  (file.tree as unknown as { children: { at?: Record<string, unknown> }[] })
    .children[0]?.at;

describe("a component's file", () => {
  it("reads back what it writes, and says why a file does not read", () => {
    expect(
      readComponentFile(componentText(PLAN), "components/Plan.component.json")
    ).toEqual({ component: PLAN });
    expect(readComponentFile("{", undefined)).toMatchObject({
      problem: expect.stringContaining("not JSON"),
    });
    expect(
      readComponentFile(componentText(PLAN), "components/Card.component.json")
    ).toEqual({
      problem: "the file of Plan is components/Plan.component.json",
    });
  });

  it("gives properties, slots and a choice's members names of their own", () => {
    expect(problemOf(PLAN, [])).toBeUndefined();
    const [title] = PLAN.properties;
    expect(
      problemOf(
        {
          ...PLAN,
          properties: [...PLAN.properties, { ...title, default: "" } as never],
        },
        []
      )
    ).toBe("two properties are named title");
    expect(
      problemOf(
        { ...PLAN, slots: [...PLAN.slots, { name: "body", node: "root" }] },
        []
      )
    ).toBe("two slots are named body");
    expect(
      problemOf(
        changed({
          members: ["plain", "plain"],
          name: "tone",
          op: "setProperty",
        }),
        []
      )
    ).toBe("the choice tone has plain twice");
  });
});

describe("a change to an app component", () => {
  it("renames a property, the variants its tree keeps for it with it", () => {
    const next = changed({ name: "tone", op: "renameProperty", to: "mood" });
    expect(next.properties.map((p) => p.name)).toEqual(["title", "mood"]);
    expect(atOf(next)).toEqual({
      md: { size: 24 },
      "mood=loud": { color: "red" },
    });
  });

  it("renames a member, its default and its overrides with it", () => {
    const next = changed({
      member: "loud",
      op: "renameMember",
      property: "tone",
      to: "bold",
    });
    expect(next.properties[1]?.members).toEqual(["plain", "bold"]);
    expect(atOf(next)).toEqual({
      md: { size: 24 },
      "tone=bold": { color: "red" },
    });
    const fromDefault = changed({
      member: "plain",
      op: "renameMember",
      property: "tone",
      to: "calm",
    });
    expect(fromDefault.properties[1]?.default).toBe("calm");
  });

  it("takes a property or a member out with its overrides", () => {
    expect(atOf(changed({ name: "tone", op: "removeProperty" }))).toEqual({
      md: { size: 24 },
    });
    const fewer = changed({
      members: ["plain"],
      name: "tone",
      op: "setProperty",
    });
    expect(atOf(fewer)).toEqual({ md: { size: 24 } });
    expect(
      changedComponent(PLAN, { name: "size", op: "removeProperty" })
    ).toEqual({
      problem: "Plan has no property size",
    });
  });

  it("makes one slot the default, or none", () => {
    const two = changed({
      op: "addSlot",
      slot: { name: "aside", node: "root" },
    });
    const moved = appOf(
      changedComponent(two, { name: "aside", op: "defaultSlot" })
    );
    expect(moved.slots).toEqual([
      { name: "body", node: "s" },
      { default: true, name: "aside", node: "root" },
    ]);
    const none = appOf(
      changedComponent(two, { name: null, op: "defaultSlot" })
    );
    expect(none.slots.some((s) => s.default)).toBe(false);
  });

  it("follows a text edited in place into its property's default, and forgets nodes gone", () => {
    const tree: DesignNode = {
      children: [{ id: "t", role: "heading", text: "Max", type: "text" }],
      id: "root",
      type: "column",
    };
    const next = withTree(PLAN, tree);
    expect(next.properties[0]?.default).toBe("Max");
    expect(next.slots).toEqual([]);
  });
});

describe("the instances of a changed component", () => {
  const page: DesignNode = {
    children: [
      {
        at: { md: { props: { tone: "loud" } } },
        component: "Plan",
        from: "#app",
        id: "a",
        props: { title: "Team", tone: "loud" },
        type: "instance",
      },
      {
        component: "Plan",
        from: "#app",
        id: "b",
        props: { title: "Solo" },
        type: "instance",
      },
      {
        component: "Plan",
        from: "@ultrapaint/system",
        id: "other",
        props: { tone: "loud" },
        type: "instance",
      },
    ],
    id: "page",
    type: "page",
  };

  it("set their props as the property or member is now named, at every breakpoint", () => {
    expect(
      instanceOps(page, "Plan", {
        name: "tone",
        op: "renameProperty",
        to: "mood",
      })
    ).toEqual([
      { id: "a", op: "setProps", props: { mood: "loud", tone: null } },
      {
        at: "md",
        id: "a",
        op: "setProps",
        props: { mood: "loud", tone: null },
      },
    ]);
    expect(
      instanceOps(page, "Plan", {
        member: "loud",
        op: "renameMember",
        property: "tone",
        to: "bold",
      })
    ).toEqual([
      { id: "a", op: "setProps", props: { tone: "bold" } },
      { at: "md", id: "a", op: "setProps", props: { tone: "bold" } },
    ]);
    expect(
      instanceOps(page, "Plan", { name: "title", op: "removeProperty" })
    ).toEqual([
      { id: "a", op: "setProps", props: { title: null } },
      { id: "b", op: "setProps", props: { title: null } },
    ]);
    expect(
      instanceOps(page, "Plan", {
        members: ["plain"],
        name: "tone",
        op: "setProperty",
      })
    ).toEqual([
      { id: "a", op: "setProps", props: { tone: null } },
      { at: "md", id: "a", op: "setProps", props: { tone: null } },
    ]);
  });
});

describe("a change to any component's file", () => {
  const BUTTON: SystemComponentFile = {
    base: { root: { radius: 4 } },
    content: { root: [] },
    description: "Starts an action",
    name: "Button",
    notes: [{ id: "n1", text: "Submits on Enter" }],
    origin: "system",
    states: {},
    variants: {},
    version: 1,
  };

  // What the editor read before is not what it sends: each change is made on the file as it is.
  const CARD: SystemComponentFile = {
    base: { "card-title": { fill: "$color-card" } },
    name: "Card",
    origin: "system",
    states: {},
    variants: {},
    version: 1,
  };
  const label = {
    id: "l",
    role: "paragraph" as const,
    text: "Item",
    type: "text" as const,
  };

  it("leaves an optional part out and shows it again, the rest of the look as the file has it (review D6)", () => {
    const left = changedComponent(CARD, {
      hidden: true,
      op: "setHidden",
      part: "card-description",
    });
    expect(left).toEqual({ ...CARD, hidden: ["card-description"] });
    expect(
      changedComponent(left as SystemComponentFile, {
        hidden: false,
        op: "setHidden",
        part: "card-description",
      })
    ).toEqual(CARD);
    expect(
      changedComponent(CARD, { hidden: true, op: "setHidden", part: "nope" })
    ).toEqual({
      problem: expect.stringContaining("Card has no part nope"),
    });
  });

  it("gives a slot its content when empty, or takes it away, the rest of the look as the file has it", () => {
    const given = changedComponent(CARD, {
      nodes: [label],
      op: "setContent",
      slot: "card-content",
    });
    expect(given).toEqual({ ...CARD, content: { "card-content": [label] } });
    expect(
      changedComponent(given as SystemComponentFile, {
        nodes: [],
        op: "setContent",
        slot: "card-content",
      })
    ).toEqual(CARD);
  });

  it("draws the items by a template, or by their label again", () => {
    const select = { ...CARD, name: "Select" };
    const item = { label: "l", tree: label };
    const templated = changedComponent(select, { item, op: "setItem" });
    expect(templated).toEqual({ ...select, item });
    expect(
      changedComponent(templated as SystemComponentFile, {
        item: null,
        op: "setItem",
      })
    ).toEqual(select);
  });

  it("adds a note about a part or the whole, under the id it is given", () => {
    expect(
      changedComponent(
        BUTTON,
        { op: "addNote", slot: "root", text: " Opens the menu " },
        { noteId: "n2" }
      )
    ).toMatchObject({
      notes: [
        { id: "n1", text: "Submits on Enter" },
        { id: "n2", text: "Opens the menu" },
      ],
    });
    expect(
      changedComponent(
        PLAN,
        { op: "addNote", slot: "s", text: "Scrolls" },
        { noteId: "n2" }
      )
    ).toMatchObject({ notes: [{ id: "n2", slot: "s", text: "Scrolls" }] });
    expect(
      changedComponent(
        BUTTON,
        { op: "addNote", slot: "nope", text: "x" },
        { noteId: "n2" }
      )
    ).toEqual({
      problem: "Button has no part nope; its parts are root, button-spinner",
    });
    expect(
      changedComponent(BUTTON, { op: "addNote", text: " " }, { noteId: "n2" })
    ).toEqual({ problem: "say what the component must do" });
  });

  it("sets one part's style at a place, the rest of the look as the file has it", () => {
    const outlineHover = {
      state: "hover" as const,
      variant: { axis: "variant", member: "outline" },
    };
    const next = changedComponent(BUTTON, {
      op: "setStyle",
      place: outlineHover,
      slot: "root",
      style: { fill: "$color-accent" },
    });
    expect(next).toMatchObject({
      base: { root: { radius: 4 } },
      content: { root: [] },
      notes: [{ id: "n1", text: "Submits on Enter" }],
      variantStates: {
        variant: { outline: { hover: { root: { fill: "$color-accent" } } } },
      },
    });
    // An empty style takes the part out of the place, and the place with it.
    expect(
      changedComponent(next as SystemComponentFile, {
        op: "setStyle",
        place: outlineHover,
        slot: "root",
        style: {},
      })
    ).not.toHaveProperty("variantStates");
    expect(
      changedComponent(BUTTON, {
        op: "setStyle",
        place: { state: null, variant: null },
        slot: "nope",
        style: { fill: "red" },
      })
    ).toEqual({
      problem: expect.stringContaining(
        "Button has no part nope; its parts are root"
      ),
    });
    expect(
      changedComponent(PLAN, {
        op: "setStyle",
        place: { state: null, variant: null },
        slot: "root",
        style: {},
      })
    ).toEqual({ problem: "Plan is an app component: it has no look" });
  });

  it("takes a note out of either origin, and says when there is none", () => {
    expect(
      changedComponent(BUTTON, { id: "n1", op: "removeNote" })
    ).toMatchObject({ notes: [] });
    expect(changedComponent(PLAN, { id: "n1", op: "removeNote" })).toEqual({
      problem: "Plan has no note n1",
    });
  });

  it("refuses properties of a system component", () => {
    expect(
      changedComponent(BUTTON, { name: "x", op: "removeProperty" })
    ).toEqual({
      problem:
        "Button is a system component's look: it has no properties or slots",
    });
  });
});
