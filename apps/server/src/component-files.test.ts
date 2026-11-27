import type {
  AppComponentFile,
  SystemComponentFile,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { SYSTEM_COMPONENTS } from "@ultrapaint/system-components/catalogue";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
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

  it("does not read a look that styles a part, a variant member or a state its component lacks (UP-227)", () => {
    const look = (
      fields: Partial<SystemComponentFile>
    ): SystemComponentFile => ({
      base: { root: { radius: 4 } },
      name: "Button",
      origin: "system",
      states: {},
      variants: {},
      version: 1,
      ...fields,
    });
    expect(problemOf(look({}), [])).toBeUndefined();
    // Written before the check, a known part beside an unknown one: the whole file is refused.
    expect(
      problemOf(look({ base: { label: { color: "red" }, root: {} } }), [])
    ).toBe(
      "base: Button has no part label; its parts are root, button-spinner"
    );
    expect(
      problemOf(look({ variants: { size: { huge: { root: {} } } } }), [])
    ).toBe(
      "variants.size.huge: Button's size has no member huge; its members are md, sm, lg, icon"
    );
    expect(problemOf(look({ states: { pressed: { root: {} } } }), [])).toBe(
      "states.pressed: Button has no state pressed; its states are hover, focus, active, disabled, open"
    );
    expect(
      problemOf(
        look({
          variantStates: { variant: { outline: { hover: { icon: {} } } } },
        }),
        []
      )
    ).toBe(
      "variantStates.variant.outline.hover: Button has no part icon; its parts are root, button-spinner"
    );
  });

  it("reads every system component's default look", () => {
    for (const { name } of SYSTEM_COMPONENTS) {
      const start = defaultLookOf(name);
      expect(start && problemOf(start, []), name).toBeUndefined();
    }
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

  it("refuses a variant member or a state the component lacks, listing the ones it has (UP-227)", () => {
    const style = { fill: "red" };
    expect(
      changedComponent(BUTTON, {
        op: "setStyle",
        place: {
          state: null,
          variant: { axis: "variant", member: "tertiary" },
        },
        slot: "root",
        style,
      })
    ).toEqual({
      problem:
        'Button\'s variant has no member tertiary; its members are primary, secondary, outline, ghost, destructive, link. A member of the product\'s own is added first: {op:"addMember", axis:"variant", member:"tertiary"}',
    });
    expect(
      changedComponent(BUTTON, {
        op: "setStyle",
        place: { state: null, variant: { axis: "tone", member: "loud" } },
        slot: "root",
        style,
      })
    ).toEqual({
      problem:
        'Button has no variant tone; its variants are size, variant. A member of the product\'s own is added first: {op:"addMember", axis:"tone", member:"loud"}',
    });
    expect(
      changedComponent(BUTTON, {
        op: "setStyle",
        place: { state: "checked", variant: null },
        slot: "root",
        style,
      })
    ).toEqual({
      problem:
        "Button has no state checked; its states are hover, focus, active, disabled, open",
    });
    const badge: SystemComponentFile = { ...BUTTON, base: {}, name: "Badge" };
    expect(
      changedComponent(badge, {
        op: "setStyle",
        place: { state: "hover", variant: null },
        slot: "root",
        style,
      })
    ).toEqual({ problem: "Badge has no state hover; it has none" });
  });

  it("takes out with an empty style what a file styles that the component lacks", () => {
    const stray: SystemComponentFile = {
      ...BUTTON,
      base: { label: { color: "red" }, root: { radius: 4 } },
    };
    expect(
      changedComponent(stray, {
        op: "setStyle",
        place: { state: null, variant: null },
        slot: "label",
        style: {},
      })
    ).toMatchObject({ base: { root: { radius: 4 } } });
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

/** A member's non-style field refused, with the style fields listed. */
const NOT_A_STYLE_RE =
  /^variants\.variant\.pending\.root: text is no style field\. A look is Badge's appearance alone \(.*fill.*\); one with props, slots, text or behaviour is an app component built on Badge$/;

describe("a system component's own variant members (ADR 0161)", () => {
  const BADGE: SystemComponentFile = {
    base: {},
    name: "Badge",
    origin: "system",
    states: {},
    variants: {},
    version: 1,
  };
  const look = (fields: Partial<SystemComponentFile>): SystemComponentFile => ({
    ...BADGE,
    ...fields,
  });
  const lookOf = (result: ReturnType<typeof changedComponent>) => {
    if ("problem" in result || result.origin !== "system") {
      throw new Error(JSON.stringify(result));
    }
    return result;
  };

  it("reads a look that styles the members it adds, an axis of its own and a member it takes out", () => {
    const own = look({
      members: {
        shape: { add: ["default", "pill"] },
        variant: { add: ["neutral-strong"], remove: ["outline"] },
      },
      variantStates: {},
      variants: {
        shape: { pill: { root: { radius: "9999px" } } },
        variant: {
          "neutral-strong": { root: { color: "#fff", fill: "#333" } },
          // Its instances keep drawing as the look says.
          outline: { root: { border: { width: "1px" } } },
        },
      },
    });
    expect(problemOf(own, [])).toBeUndefined();
    expect(readComponentFile(componentText(own))).toEqual({ component: own });
  });

  it("refuses a member it adds that sets anything but style fields, saying it is an app component's", () => {
    const read = readComponentFile(
      JSON.stringify({
        ...look({ members: { variant: { add: ["pending"] } } }),
        variants: {
          variant: { pending: { root: { fill: "#fa0", text: "Pending" } } },
        },
      })
    );
    expect("problem" in read && read.problem).toMatch(NOT_A_STYLE_RE);
    // A part that is no part is refused as any look's is.
    expect(
      problemOf(
        look({
          members: { variant: { add: ["pending"] } },
          variants: { variant: { pending: { props: {} } } },
        }),
        []
      )
    ).toBe(
      "variants.variant.pending: Badge has no part props; its parts are root"
    );
  });

  it("refuses members that cannot mean anything, saying why", () => {
    const problem = (members: SystemComponentFile["members"]) =>
      problemOf(look({ members }), []);
    expect(problem({ variant: { remove: ["pill"] } })).toBe(
      "members.variant: Badge's variant has no built-in member pill to take out; its members are default, secondary, outline, destructive, warning, success, info"
    );
    expect(problem({ variant: { add: ["outline"] } })).toBe(
      "members.variant: Badge's variant has outline already"
    );
    expect(problem({ variant: { add: ["pill", "pill"] } })).toBe(
      "members.variant: variant adds pill twice"
    );
    expect(problem({ variant: { add: ["two words"] } })).toBe(
      'members.variant: a member is named in letters, digits, - and _: "two words"'
    );
    expect(
      problem({
        variant: {
          remove: [
            "default",
            "secondary",
            "outline",
            "destructive",
            "warning",
            "success",
            "info",
          ],
        },
      })
    ).toBe(
      "members.variant: Badge's variant keeps a member: add one before taking out the last"
    );
    expect(problem({ shape: {} })).toBe(
      "members.shape: Badge's own axis shape adds its members, the first its default"
    );
    expect(problem({ shape: { add: ["pill"], remove: ["round"] } })).toBe(
      "members.shape: shape is Badge's own axis: it has no built-in member to take out"
    );
    expect(
      problemOf(
        { ...look({}), members: { loading: { add: ["yes"] } }, name: "Button" },
        []
      )
    ).toBe(
      "members.loading: Button's own axis takes a name of its own in camelCase, not loading; its props are variant, size, disabled, loading"
    );
  });

  it("adds a member to an axis or an axis of its own, and puts back a built-in one taken out", () => {
    const added = lookOf(
      changedComponent(BADGE, {
        axis: "variant",
        member: "neutral-strong",
        op: "addMember",
      })
    );
    expect(added.members).toEqual({ variant: { add: ["neutral-strong"] } });
    const shaped = lookOf(
      changedComponent(added, {
        axis: "shape",
        member: "default",
        op: "addMember",
      })
    );
    expect(shaped.members?.shape).toEqual({ add: ["default"] });
    expect(
      changedComponent(added, {
        axis: "variant",
        member: "outline",
        op: "addMember",
      })
    ).toEqual({ problem: "Badge's variant has outline already" });
    const removed = lookOf(
      changedComponent(BADGE, {
        axis: "variant",
        member: "outline",
        op: "removeMember",
      })
    );
    expect(removed.members).toEqual({ variant: { remove: ["outline"] } });
    const back = lookOf(
      changedComponent(removed, {
        axis: "variant",
        member: "outline",
        op: "addMember",
      })
    );
    expect(back.members).toBeUndefined();
  });

  it("takes out a member it added with what it styles in it, and keeps a built-in one's look for its instances", () => {
    const own = look({
      members: { shape: { add: ["default", "pill"] } },
      variantStates: { shape: { pill: { hover: { root: { opacity: 0.8 } } } } },
      variants: {
        shape: { pill: { root: { radius: "9999px" } } },
        variant: { outline: { root: { border: { width: "1px" } } } },
      },
    });
    const pill = lookOf(
      changedComponent(own, {
        axis: "shape",
        member: "pill",
        op: "removeMember",
      })
    );
    expect(pill.members).toEqual({ shape: { add: ["default"] } });
    expect(pill.variants).toEqual({
      variant: { outline: { root: { border: { width: "1px" } } } },
    });
    expect(pill.variantStates).toBeUndefined();
    const outline = lookOf(
      changedComponent(pill, {
        axis: "variant",
        member: "outline",
        op: "removeMember",
      })
    );
    expect(outline.variants.variant).toEqual(own.variants.variant);
    expect(
      changedComponent(outline, {
        axis: "variant",
        member: "outline",
        op: "removeMember",
      })
    ).toEqual({
      problem:
        "Badge's variant offers no member outline; its members are default, secondary, destructive, warning, success, info",
    });
  });

  it("offers no addMember where adding it would be refused", () => {
    const button: SystemComponentFile = { ...BADGE, name: "Button" };
    expect(
      changedComponent(button, {
        op: "setStyle",
        place: { state: null, variant: { axis: "loading", member: "yes" } },
        slot: "root",
        style: { opacity: 0.5 },
      })
    ).toEqual({
      problem: "Button has no variant loading; its variants are size, variant",
    });
  });

  it("styles a member it adds, and says how to add one it lacks", () => {
    const own = look({ members: { variant: { add: ["neutral-strong"] } } });
    const styled = lookOf(
      changedComponent(own, {
        op: "setStyle",
        place: {
          state: null,
          variant: { axis: "variant", member: "neutral-strong" },
        },
        slot: "root",
        style: { fill: "#333" },
      })
    );
    expect(styled.variants).toEqual({
      variant: { "neutral-strong": { root: { fill: "#333" } } },
    });
    expect(
      changedComponent(BADGE, {
        op: "setStyle",
        place: { state: null, variant: { axis: "variant", member: "pending" } },
        slot: "root",
        style: { fill: "#fa0" },
      })
    ).toEqual({
      problem:
        'Badge\'s variant has no member pending; its members are default, secondary, outline, destructive, warning, success, info. A member of the product\'s own is added first: {op:"addMember", axis:"variant", member:"pending"}',
    });
  });
});
