/**
 * A component's file, read, checked and changed (ADRs 0041, 0042): `components/<Name>.component.json`
 * in the designs directory. Pure, as `design-system-files` is the design system's: the
 * `ComponentService` reads and writes the files, the `DocumentService` writes an app component's
 * tree edited in place, and both go through here, so the format has one reader.
 *
 * Checking, a component is named in PascalCase and is unique; a system component's look leaves
 * out only optional parts and templates only items; an app component takes no system component's
 * name, names nodes its tree has, has one default slot at most, gives its properties, slots and a
 * choice's members names of their own, and places no app component that places it.
 *
 * Changing an app component's properties follows them everywhere they are named: a property or
 * a choice's member renamed or taken out is renamed or taken out of the variants its tree keeps
 * (`at["size=lg"]`), and of every instance's props (`instanceOps`, the edits of each document).
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  APP_FROM,
  type AppComponentFile,
  type AxisMembers,
  type ComponentChange,
  ComponentFile,
  type ComponentProperty,
  componentFileOf,
  isVariantKey,
  PartStyle,
  ROOT_SLOT,
  type SystemComponentFile,
  variantKey,
} from "@ultrapaint/contracts/components";
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import { appComponentCycle } from "@ultrapaint/design-document/app-components";
import { serialise } from "@ultrapaint/design-document/factories";
import { styleAt, withStyle } from "@ultrapaint/design-document/look-places";
import {
  childrenOf,
  findNode,
  idsOf,
  walk,
} from "@ultrapaint/design-document/tree";
import {
  axesOf,
  type SystemComponentMeta,
  systemComponentOf,
  systemMetaIn,
} from "@ultrapaint/system-components/catalogue";
import { Schema } from "effect";

const decodeComponent = Schema.decodeUnknownResult(ComponentFile);

const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const SPACED_WORD_RE = /\s+(\w)/g;

/** The name a new app component takes from what was typed: `Hero title` is `HeroTitle`. */
export const appComponentName = (given: string) =>
  given.trim().replace(SPACED_WORD_RE, (_, c: string) => c.toUpperCase());

/** The parts a note can be about: a system component's, an app component's slots and nodes. */
const partsOf = (component: ComponentFile): string[] =>
  component.origin === "system"
    ? (systemComponentOf(component.name)?.slots ?? []).map((s) => s.name)
    : [...component.slots.map((s) => s.name), ...idsOf(component.tree)];

/** A file's text as a component, or why it is not one. */
export type ComponentRead =
  | { readonly component: ComponentFile }
  | { readonly problem: string };

/** The style fields a part's style has, which a member the project adds keeps to (ADR 0161). */
const STYLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(PartStyle.fields)
);

type Json = Readonly<Record<string, unknown>>;
const objectIn = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

/**
 * The first field of a style a member the project adds sets that is no style field, with where
 * (ADR 0161): such a member is appearance only, and its file is refused rather than read without
 * the field. Read off the file's JSON, since reading it as a component drops what it does not know.
 */
const behaviourIn = (
  json: unknown,
  component: SystemComponentFile
): string | undefined => {
  const meta = systemComponentOf(component.name);
  if (!(meta && component.members)) {
    return undefined;
  }
  const axes = axesOf(meta, component);
  const own = (axis: string, member: string) =>
    axes[axis]?.added.includes(member) ?? false;
  const raw = objectIn(json);
  const places = [
    ...Object.entries(objectIn(raw.variants)).flatMap(([axis, members]) =>
      Object.entries(objectIn(members)).flatMap(([member, parts]) =>
        own(axis, member)
          ? [{ at: `variants.${axis}.${member}`, parts: objectIn(parts) }]
          : []
      )
    ),
    ...Object.entries(objectIn(raw.variantStates)).flatMap(([axis, members]) =>
      Object.entries(objectIn(members)).flatMap(([member, states]) =>
        own(axis, member)
          ? Object.entries(objectIn(states)).map(([state, parts]) => ({
              at: `variantStates.${axis}.${member}.${state}`,
              parts: objectIn(parts),
            }))
          : []
      )
    ),
  ];
  for (const { at, parts } of places) {
    for (const [part, style] of Object.entries(parts)) {
      const refused = notAStyle(component.name, style);
      if (refused !== undefined) {
        return `${at}.${part}: ${refused}`;
      }
    }
  }
  return undefined;
};

/**
 * Why a style a look is given is refused, when it sets a field that is no style field (ADR
 * 0161): a look is its component's appearance alone, and what does more is an app component
 * built on it. Said alike of a file's member and of `handoff`'s setStyle, whose change would
 * otherwise be read without the field.
 */
export const notAStyle = (
  component: string,
  style: unknown
): string | undefined => {
  const field = Object.keys(objectIn(style)).find((f) => !STYLE_FIELDS.has(f));
  return field === undefined
    ? undefined
    : `${field} is no style field. A look is ${component}'s appearance alone (${[...STYLE_FIELDS].join(", ")}); one with props, slots, text or behaviour is an app component built on ${component}`;
};

/** What a writer gives (a file's JSON, an editor's or an agent's) as a component, or why it is not one. */
export const componentOf = (json: unknown): ComponentRead => {
  const result = decodeComponent(json);
  if (result._tag !== "Success") {
    return { problem: result.failure.message };
  }
  const component = result.success;
  const behaviour =
    component.origin === "system" ? behaviourIn(json, component) : undefined;
  return behaviour === undefined ? { component } : { problem: behaviour };
};

/**
 * A component's file as it reads: JSON, a component, kept under its own name when `file` (its
 * name in the components directory) is given.
 */
export const readComponentFile = (
  text: string,
  file?: string
): ComponentRead => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { problem: `not JSON: ${String(error)}` };
  }
  const read = componentOf(json);
  if ("problem" in read) {
    return read;
  }
  const { component } = read;
  if (file !== undefined && file !== componentFileOf(component.name)) {
    return {
      problem: `the file of ${component.name} is ${componentFileOf(component.name)}`,
    };
  }
  return { component };
};

/** The text a component's file is written with. */
export const componentText = (component: ComponentFile): string =>
  serialise(component);

/** The first name given twice, when there is one. */
const twice = (names: readonly string[]): string | undefined =>
  names.find((name, i) => names.indexOf(name) !== i);

/** What is wrong with an app component's tree, its slots and its properties, or nothing. */
const appProblemOf = (component: AppComponentFile): string | undefined => {
  const ids = idsOf(component.tree);
  const slot = twice(component.slots.map((s) => s.name));
  if (slot !== undefined) {
    return `two slots are named ${slot}`;
  }
  for (const s of component.slots) {
    const node = findNode(component.tree, s.node);
    if (!node) {
      return `the slot ${s.name} is node ${s.node}, which the tree does not have`;
    }
    if (!("children" in node)) {
      return `the slot ${s.name} is node ${s.node}, which holds no nodes`;
    }
  }
  if (component.slots.filter((s) => s.default).length > 1) {
    return "only one slot is the default";
  }
  const property = twice(component.properties.map((p) => p.name));
  if (property !== undefined) {
    return `two properties are named ${property}`;
  }
  for (const p of component.properties) {
    const missing = (p.targets ?? []).find((t) => !ids.has(t.node));
    if (missing) {
      return `the property ${p.name} sets node ${missing.node}, which the tree does not have`;
    }
    const members = p.members ?? [];
    const member = twice(members);
    if (member !== undefined) {
      return `the choice ${p.name} has ${member} twice`;
    }
    if (
      p.kind === "choice" &&
      !(typeof p.default === "string" && members.includes(p.default))
    ) {
      return `the choice ${p.name} starts in a member it has: ${members.join(", ") || "it has none"}`;
    }
  }
  return undefined;
};

/** `its <what> are a, b`, or that it has none. */
const theyAre = (what: string, names: readonly string[]) =>
  names.length > 0 ? `its ${what} are ${names.join(", ")}` : "it has none";

/** A place of a look as a file writes it, whatever its keys: a state's may be any string there. */
interface PlaceIn {
  readonly axis?: string;
  readonly member?: string;
  readonly state?: string;
}

/**
 * What a look's catalogue entry lacks for it to style `part` at a place, or nothing (UP-227): a
 * variant axis or member, a state or a part, said with the ones it has. A file's check and `setStyle`
 * say it in the same words.
 */
const lackOf = (
  meta: SystemComponentMeta,
  { axis, member, state }: PlaceIn,
  part: string
): string | undefined => {
  const { name } = meta;
  if (axis !== undefined) {
    const members = meta.variants[axis];
    if (!members) {
      return `${name} has no variant ${axis}; ${theyAre("variants", Object.keys(meta.variants))}`;
    }
    if (member !== undefined && !members.includes(member)) {
      return `${name}'s ${axis} has no member ${member}; ${theyAre("members", members)}`;
    }
  }
  if (state !== undefined && !meta.states.includes(state)) {
    return `${name} has no state ${state}; ${theyAre("states", meta.states)}`;
  }
  const parts = meta.slots.map((s) => s.name);
  return parts.includes(part)
    ? undefined
    : `${name} has no part ${part}; ${theyAre("parts", parts)}`;
};

/** Every place a look styles parts at, with where the file keeps it and the parts it styles. */
const placesIn = (
  look: SystemComponentFile
): {
  readonly at: string;
  readonly parts: string[];
  readonly place: PlaceIn;
}[] => [
  { at: "base", parts: Object.keys(look.base), place: {} },
  ...Object.entries(look.variants).flatMap(([axis, members]) =>
    Object.entries(members).map(([member, styles]) => ({
      at: `variants.${axis}.${member}`,
      parts: Object.keys(styles),
      place: { axis, member },
    }))
  ),
  ...Object.entries(look.states).map(([state, styles]) => ({
    at: `states.${state}`,
    parts: Object.keys(styles),
    place: { state },
  })),
  ...Object.entries(look.variantStates ?? {}).flatMap(([axis, members]) =>
    Object.entries(members).flatMap(([member, states]) =>
      Object.entries(states).map(([state, styles]) => ({
        at: `variantStates.${axis}.${member}.${state}`,
        parts: Object.keys(styles),
        place: { axis, member, state },
      }))
    )
  ),
];

const MEMBER_RE = /^[A-Za-z0-9][\w-]*$/;

/** A member added that the axis offers already, said alike by the file's check and `addMember`. */
const hasAlready = (meta: SystemComponentMeta, axis: string, member: string) =>
  `${meta.name}'s ${axis} has ${member} already`;
const AXIS_RE = /^[a-z][A-Za-z0-9]*$/;

/**
 * What is wrong with the members one axis of a look adds or takes out (ADR 0161), or nothing: a
 * member it adds is named as a prop's value can be and once, one it takes out is the catalogue's,
 * an axis keeps a member, and an axis of its own is named apart from the component's props.
 */
const axisProblemOf = (
  meta: SystemComponentMeta,
  axis: string,
  { add = [], remove = [] }: AxisMembers
): string | undefined => {
  const { name } = meta;
  const builtIn = meta.variants[axis];
  const at = `members.${axis}`;
  if (!builtIn) {
    if (meta.props.some((p) => p.name === axis) || !AXIS_RE.test(axis)) {
      return `${at}: ${name}'s own axis takes a name of its own in camelCase, not ${axis}; its props are ${meta.props.map((p) => p.name).join(", ")}`;
    }
    if (remove.length > 0) {
      return `${at}: ${axis} is ${name}'s own axis: it has no built-in member to take out`;
    }
    if (add.length === 0) {
      return `${at}: ${name}'s own axis ${axis} adds its members, the first its default`;
    }
  }
  const bad = add.find((m) => !MEMBER_RE.test(m));
  if (bad !== undefined) {
    return `${at}: a member is named in letters, digits, - and _: ${JSON.stringify(bad)}`;
  }
  const again = twice(add);
  if (again !== undefined) {
    return `${at}: ${axis} adds ${again} twice`;
  }
  const had = add.find((m) => builtIn?.includes(m));
  if (had !== undefined) {
    return `${at}: ${hasAlready(meta, axis, had)}`;
  }
  const unknown = remove.find((m) => !builtIn?.includes(m));
  if (unknown !== undefined) {
    return `${at}: ${name}'s ${axis} has no built-in member ${unknown} to take out; ${theyAre("members", builtIn ?? [])}`;
  }
  if (builtIn && add.length === 0 && builtIn.every((m) => remove.includes(m))) {
    return `${at}: ${name}'s ${axis} keeps a member: add one before taking out the last`;
  }
  return undefined;
};

/**
 * A system component's entry with the members its look may style (ADR 0161): those it offers,
 * and the built-in ones it takes out, whose instances keep drawing.
 */
const styledMetaOf = (
  meta: SystemComponentMeta,
  component: SystemComponentFile
): SystemComponentMeta => {
  if (!component.members) {
    return meta;
  }
  const axes = axesOf(meta, component);
  return {
    ...systemMetaIn(meta, component),
    variants: Object.fromEntries(
      Object.entries(axes).map(([axis, a]) => [
        axis,
        [...a.members, ...a.removed],
      ])
    ),
  };
};

/**
 * Everything wrong with a system component's look against its catalogue entry, in the file's
 * order: the members it adds or takes out mean something, it styles only the parts, variant
 * members (its own among them) and states it has, leaves out only optional parts, gives content
 * only to slots, and a template only to a Select's or a Menu's items.
 */
const systemProblemsOf = (
  component: SystemComponentFile,
  builtIn: SystemComponentMeta
): string[] => {
  const problems = Object.entries(component.members ?? {}).flatMap(
    ([axis, members]) => axisProblemOf(builtIn, axis, members) ?? []
  );
  const meta = styledMetaOf(builtIn, component);
  for (const { at, parts: styled, place } of placesIn(component)) {
    // A place it lacks is said once, not once per part.
    const lacks = styled.flatMap((p) => lackOf(meta, place, p) ?? []);
    problems.push(...[...new Set(lacks)].map((s) => `${at}: ${s}`));
  }
  const parts = new Map(meta.slots.map((s) => [s.name, s]));
  const fixed = (component.hidden ?? []).find((p) => !parts.get(p)?.optional);
  if (fixed !== undefined) {
    const optional = meta.slots.filter((s) => s.optional).map((s) => s.name);
    problems.push(
      `${component.name} cannot leave out ${fixed}: ${optional.length > 0 ? `its optional parts are ${optional.join(", ")}` : "it has no optional part"}`
    );
  }
  const notSlot = Object.keys(component.content ?? {}).find(
    (slot) => parts.get(slot)?.holds === undefined
  );
  if (notSlot !== undefined) {
    problems.push(
      `${component.name} has no slot ${notSlot} to give content: its slots are ${meta.slots.flatMap((s) => (s.holds ? [s.name] : [])).join(", ") || "none"}`
    );
  }
  const { item } = component;
  if (item && !meta.templatedItems) {
    problems.push(
      `${component.name} has no items to draw with a template: a Select's and a Menu's have`
    );
  }
  const ids = item ? idsOf(item.tree) : new Set<string>();
  const unbound = [item?.label, item?.image].find(
    (id) => id !== undefined && !ids.has(id)
  );
  if (unbound !== undefined) {
    problems.push(
      `the item template shows the item in node ${unbound}, which its tree does not have`
    );
  }
  return problems;
};

/** What is wrong with a component's file among the others, or nothing. */
export const problemOf = (
  component: ComponentFile,
  others: readonly ComponentFile[]
): string | undefined => {
  if (!COMPONENT_NAME_RE.test(component.name)) {
    return `a component is named in PascalCase, letters and digits: ${component.name}`;
  }
  const system = systemComponentOf(component.name);
  if (component.origin === "system") {
    return system
      ? systemProblemsOf(component, system)[0]
      : `${component.name} is no system component: an app component's file says origin "app"`;
  }
  if (system) {
    return `${component.name} is a system component's name: an app component takes another`;
  }
  const own = appProblemOf(component);
  if (own) {
    return own;
  }
  const apps = [
    ...others.filter(
      (c): c is AppComponentFile =>
        c.origin === "app" && c.name !== component.name
    ),
    component,
  ];
  // A way round another component is its file's problem, never this one's.
  const cycle = appComponentCycle(apps, component.name);
  return cycle
    ? `${cycle.join(" places ")}: a component cannot place itself`
    : undefined;
};

/**
 * What is wrong with a component's file once a change is made to `before`, the file as it was,
 * that `before` was not wrong with, or nothing. A look whose file did not read can be changed
 * one thing at a time, its problems taken out one by one; no change adds one.
 */
export const problemAddedBy = (
  after: ComponentFile,
  before: ComponentFile | undefined,
  others: readonly ComponentFile[]
): string | undefined => {
  const meta = systemComponentOf(after.name);
  if (!(meta && after.origin === "system" && before?.origin === "system")) {
    return problemOf(after, others);
  }
  const had = new Set(systemProblemsOf(before, meta));
  return systemProblemsOf(after, meta).find((p) => !had.has(p));
};

// ---- The tree ----

/** What a node shows of a property's kind, which the property's default stands for. */
const shownBy = (
  node: DesignNode | null,
  kind: string
): JsonValue | undefined => {
  if (!node) {
    return undefined;
  }
  if (kind === "boolean") {
    return node.hidden !== true;
  }
  if (kind === "image") {
    return node.type === "image" ? node.src : undefined;
  }
  return kind === "text" && (node.type === "text" || node.type === "instance")
    ? node.text
    : undefined;
};

/**
 * A property whose node was edited in the tree: its default is what the node shows now, so a
 * text edited in place is the text every instance that sets none draws.
 */
const followTree = (
  property: ComponentProperty,
  before: DesignNode,
  after: DesignNode
): ComponentProperty => {
  for (const target of property.targets ?? []) {
    if (target.prop !== undefined) {
      continue;
    }
    const was = shownBy(findNode(before, target.node), property.kind);
    const now = shownBy(findNode(after, target.node), property.kind);
    if (now !== undefined && now !== was) {
      return { ...property, default: now };
    }
  }
  return property;
};

/**
 * An app component's file with its tree edited in place: a property whose node changed what it
 * shows starts from it, and the properties and slots that named a node gone no longer name it.
 */
export const withTree = (
  file: AppComponentFile,
  tree: DesignNode
): AppComponentFile => {
  const ids = idsOf(tree);
  return {
    ...file,
    properties: file.properties.map((p) => {
      const followed = followTree(p, file.tree, tree);
      return followed.targets
        ? {
            ...followed,
            targets: followed.targets.filter((t) => ids.has(t.node)),
          }
        : followed;
    }),
    slots: file.slots.filter((s) => ids.has(s.node)),
    tree,
  };
};

/**
 * A slot, or a node a property sets, whose node an edit of the tree took out (`withTree` lets it
 * go with its node), said with the way to take it out instead; nothing when every one is kept.
 */
export const partDroppedBy = (
  tree: DesignNode,
  file: AppComponentFile
): string | undefined => {
  const ids = idsOf(tree);
  const slot = file.slots.find((s) => !ids.has(s.node));
  const [target] = file.properties.flatMap((p) =>
    (p.targets ?? []).flatMap((t) => (ids.has(t.node) ? [] : [{ p, t }]))
  );
  const lost = slot
    ? `the slot ${slot.name} is node ${slot.node}`
    : target && `the property ${target.p.name} sets node ${target.t.node}`;
  return lost
    ? `${lost}, which the edit takes out: take that out with handoff's change first`
    : undefined;
};

type Fields = Record<string, unknown>;

/** A tree with the variant keys of every node's `at` renamed, or taken out where `rename` says null. */
const withVariantKeys = (
  node: DesignNode,
  rename: (key: string) => string | null
): DesignNode => {
  const { at, ...own } = node as DesignNode & { at?: Record<string, Fields> };
  const fields: Fields = { ...own };
  if (at) {
    const kept = Object.entries(at).flatMap(([key, over]) => {
      const to = isVariantKey(key) ? rename(key) : key;
      return to === null ? [] : [[to, over] as const];
    });
    if (kept.length > 0) {
      fields.at = Object.fromEntries(kept);
    }
  }
  if ("children" in node && node.children) {
    fields.children = childrenOf(node).map((c) => withVariantKeys(c, rename));
  }
  return fields as unknown as DesignNode;
};

/** The variant key of a choice's member, split: `size=lg` is `size` and `lg`. */
const splitKey = (key: string) => {
  const at = key.indexOf("=");
  return { member: key.slice(at + 1), property: key.slice(0, at) };
};

// ---- Changes ----

/** The property named, or why there is none. */
const propertyIn = (file: AppComponentFile, name: string) =>
  file.properties.find((p) => p.name === name);

const replaceProperty = (
  file: AppComponentFile,
  name: string,
  next: ComponentProperty | null
): AppComponentFile => ({
  ...file,
  properties: file.properties.flatMap((p) => {
    if (p.name !== name) {
      return [p];
    }
    return next ? [next] : [];
  }),
});

/** A property renamed, with the variants of a choice's members its tree keeps. */
const renameProperty = (
  file: AppComponentFile,
  name: string,
  to: string
): AppComponentFile => {
  const property = propertyIn(file, name);
  if (!property) {
    return file;
  }
  const renamed = replaceProperty(file, name, { ...property, name: to });
  return {
    ...renamed,
    tree: withVariantKeys(renamed.tree, (key) => {
      const { member, property: of } = splitKey(key);
      return of === name ? variantKey(to, member) : key;
    }),
  };
};

/** A choice's member renamed, its default and the overrides its tree keeps for it with it. */
const renameMember = (
  file: AppComponentFile,
  name: string,
  member: string,
  to: string
): AppComponentFile => {
  const property = propertyIn(file, name);
  if (!property?.members?.includes(member)) {
    return file;
  }
  const renamed = replaceProperty(file, name, {
    ...property,
    default: property.default === member ? to : property.default,
    members: property.members.map((m) => (m === member ? to : m)),
  });
  const from = variantKey(name, member);
  return {
    ...renamed,
    tree: withVariantKeys(renamed.tree, (key) =>
      key === from ? variantKey(name, to) : key
    ),
  };
};

/** A choice's members as given: a member gone takes its overrides with it. */
const withMembers = (
  file: AppComponentFile,
  property: ComponentProperty,
  members: readonly string[]
): AppComponentFile => {
  const next: ComponentProperty = {
    ...property,
    default:
      typeof property.default === "string" && members.includes(property.default)
        ? property.default
        : (members[0] ?? ""),
    members,
  };
  const replaced = replaceProperty(file, property.name, next);
  return {
    ...replaced,
    tree: withVariantKeys(replaced.tree, (key) => {
      const { member, property: of } = splitKey(key);
      return of === property.name && !members.includes(member) ? null : key;
    }),
  };
};

/** A property taken out, with the overrides its tree keeps for a choice's members. */
const removeProperty = (
  file: AppComponentFile,
  name: string
): AppComponentFile => {
  const removed = replaceProperty(file, name, null);
  return {
    ...removed,
    tree: withVariantKeys(removed.tree, (key) =>
      splitKey(key).property === name ? null : key
    ),
  };
};

type Changed<F> = F | { readonly problem: string };

const missing = (file: ComponentFile, what: string, name: string) => ({
  problem: `${file.name} has no ${what} ${name}`,
});

/**
 * A component's file with a change made, or why it cannot be: a property, a slot, a part or a
 * note it does not have, a look asked of an app component or properties of a system one. A note
 * added takes `made.noteId`, which the server makes. What the result is checked for is
 * `problemOf`'s.
 */
export const changedComponent = (
  file: ComponentFile,
  change: ComponentChange,
  made: { readonly noteId?: string } = {}
): Changed<ComponentFile> => {
  switch (change.op) {
    case "addNote":
      return withNote(file, change, made.noteId ?? "note");
    case "removeNote": {
      const notes = file.notes ?? [];
      return notes.some((n) => n.id === change.id)
        ? { ...file, notes: notes.filter((n) => n.id !== change.id) }
        : missing(file, "note", change.id);
    }
    case "setStyle":
    case "setHidden":
    case "setContent":
    case "setItem":
    case "addMember":
    case "removeMember":
      return file.origin === "system"
        ? looked(file, change)
        : { problem: `${file.name} is an app component: it has no look` };
    default:
      return file.origin === "app"
        ? changedApp(file, change)
        : {
            problem: `${file.name} is a system component's look: it has no properties or slots`,
          };
  }
};

/** A note added about a part, or the whole, of either origin. */
const withNote = (
  file: ComponentFile,
  change: Extract<ComponentChange, { op: "addNote" }>,
  id: string
): Changed<ComponentFile> => {
  const text = change.text.trim();
  if (text === "") {
    return { problem: "say what the component must do" };
  }
  const { slot } = change;
  const parts = partsOf(file);
  if (slot !== undefined && !parts.includes(slot)) {
    return {
      problem: `${file.name} has no part ${slot}; its parts are ${parts.join(", ")}`,
    };
  }
  return {
    ...file,
    notes: [
      ...(file.notes ?? []),
      { id, ...(slot !== undefined && slot !== ROOT_SLOT && { slot }), text },
    ],
  };
};

/** A record with one key set, or taken out with nothing; undefined when it is left empty. */
const withKey = <V>(
  record: Readonly<Record<string, V>> | undefined,
  key: string,
  value: V | undefined
): Record<string, V> | undefined => {
  const { [key]: _old, ...rest } = record ?? {};
  const next = value === undefined ? rest : { ...rest, [key]: value };
  return Object.keys(next).length === 0 ? undefined : next;
};

/** A system component's file with `key` set to `value`, or taken out when it is undefined. */
const withField = <K extends "content" | "hidden" | "item">(
  file: SystemComponentFile,
  key: K,
  value: SystemComponentFile[K] | undefined
): SystemComponentFile => {
  const { [key]: _old, ...rest } = file;
  return (
    value === undefined ? rest : { ...rest, [key]: value }
  ) as SystemComponentFile;
};

/**
 * One part's style set at a place of a look, refused where the component lacks the part, the
 * state or the member (its own members among them, ADR 0161); an empty style takes out what a
 * file styles there that the component lacks, which is a fix.
 */
const withPartStyle = (
  file: SystemComponentFile,
  builtIn: SystemComponentMeta,
  { place, slot, style }: Extract<ComponentChange, { op: "setStyle" }>
): Changed<SystemComponentFile> => {
  const meta = styledMetaOf(builtIn, file);
  const lack = lackOf(
    meta,
    {
      ...(place.variant && place.variant),
      ...(place.state !== null && { state: place.state }),
    },
    slot
  );
  const takenOut =
    Object.keys(style).length === 0 &&
    Object.keys(styleAt(file, place, slot)).length > 0;
  if (lack === undefined || takenOut) {
    return withStyle(file, place, slot, style);
  }
  // A member it lacks is the product's own, which the look adds before it styles it.
  const member = place.variant;
  const added =
    member === null
      ? undefined
      : withMember(file, builtIn, { ...member, op: "addMember" });
  const lacksMember =
    member !== null &&
    added !== undefined &&
    !("problem" in added) &&
    axisProblemOf(builtIn, member.axis, added.members?.[member.axis] ?? {}) ===
      undefined &&
    lackOf(meta, {}, slot) === undefined;
  return {
    problem: lacksMember
      ? `${lack}. A member of the product's own is added first: {op:"addMember", axis:${JSON.stringify(member.axis)}, member:${JSON.stringify(member.member)}}`
      : lack,
  };
};

/**
 * One thing of a system component's look changed, the rest as the file has it: a part's style at
 * a place, an optional part left out or shown, a slot's content, the items' template.
 */
const looked = (
  file: SystemComponentFile,
  change: Extract<
    ComponentChange,
    {
      op:
        | "setStyle"
        | "setHidden"
        | "setContent"
        | "setItem"
        | "addMember"
        | "removeMember";
    }
  >
): Changed<SystemComponentFile> => {
  if (change.op === "setItem") {
    return withField(file, "item", change.item ?? undefined);
  }
  const builtIn = systemComponentOf(file.name);
  if (change.op === "addMember" || change.op === "removeMember") {
    return builtIn
      ? withMember(file, builtIn, change)
      : missing(file, "variant axis", change.axis);
  }
  if (change.op === "setStyle" && builtIn) {
    return withPartStyle(file, builtIn, change);
  }
  const part = change.op === "setHidden" ? change.part : change.slot;
  const parts = partsOf(file);
  if (!parts.includes(part)) {
    return {
      problem: `${file.name} has no part ${part}; its parts are ${parts.join(", ")}`,
    };
  }
  switch (change.op) {
    case "setStyle":
      return withStyle(file, change.place, change.slot, change.style);
    case "setHidden": {
      const others = (file.hidden ?? []).filter((p) => p !== part);
      const hidden = change.hidden ? [...others, part] : others;
      return withField(file, "hidden", hidden.length > 0 ? hidden : undefined);
    }
    default:
      return withField(
        file,
        "content",
        withKey(
          file.content,
          part,
          change.nodes.length > 0 ? change.nodes : undefined
        )
      );
  }
};

/** A look's members of one axis set to `next`, the axis gone when it adds and takes out none. */
const withAxis = (
  file: SystemComponentFile,
  axis: string,
  next: AxisMembers
): SystemComponentFile => {
  const kept: AxisMembers = {
    ...(next.add && next.add.length > 0 && { add: next.add }),
    ...(next.remove && next.remove.length > 0 && { remove: next.remove }),
  };
  const members = withKey(
    file.members,
    axis,
    Object.keys(kept).length > 0 ? kept : undefined
  );
  const { members: _old, ...rest } = file;
  return members ? { ...rest, members } : rest;
};

/** A look with what it styles in one member of an axis taken out, in the member and its states. */
const withoutMemberLook = (
  file: SystemComponentFile,
  axis: string,
  member: string
): SystemComponentFile => {
  type Variants = SystemComponentFile["variants"];
  type States = NonNullable<SystemComponentFile["variantStates"]>;
  const variants = withKey<Variants[string]>(
    file.variants,
    axis,
    withKey<Variants[string][string]>(file.variants[axis], member, undefined)
  );
  const variantStates = withKey<States[string]>(
    file.variantStates,
    axis,
    withKey<States[string][string]>(
      file.variantStates?.[axis],
      member,
      undefined
    )
  );
  const { variantStates: _was, ...rest } = file;
  return {
    ...rest,
    variants: variants ?? {},
    ...(variantStates && { variantStates }),
  };
};

/**
 * A variant member a look adds or takes out (ADR 0161). Added: put back when it is a built-in one
 * taken out, else after the axis's members, an axis the component lacks being the look's own.
 * Taken out: a built-in one no longer offered, what the look styles in it kept for the instances
 * that keep it; one of the look's own gone with what it styles. Whether the axis still means
 * something is the file's check's (`axisProblemOf`).
 */
const withMember = (
  file: SystemComponentFile,
  meta: SystemComponentMeta,
  {
    axis,
    member,
    op,
  }: Extract<ComponentChange, { op: "addMember" | "removeMember" }>
): Changed<SystemComponentFile> => {
  const builtIn = meta.variants[axis] ?? [];
  const { add = [], remove = [] } = file.members?.[axis] ?? {};
  if (op === "addMember") {
    if (remove.includes(member)) {
      return withAxis(file, axis, {
        add,
        remove: remove.filter((m) => m !== member),
      });
    }
    return builtIn.includes(member) || add.includes(member)
      ? { problem: hasAlready(meta, axis, member) }
      : withAxis(file, axis, { add: [...add, member], remove });
  }
  if (add.includes(member)) {
    return withoutMemberLook(
      withAxis(file, axis, {
        add: add.filter((m) => m !== member),
        remove,
      }),
      axis,
      member
    );
  }
  if (builtIn.includes(member) && !remove.includes(member)) {
    return withAxis(file, axis, { add, remove: [...remove, member] });
  }
  const offered = axesOf(meta, file)[axis]?.members ?? [];
  return {
    problem: `${meta.name}'s ${axis} offers no member ${member}; ${theyAre("members", offered)}`,
  };
};

const changedApp = (
  file: AppComponentFile,
  change: Exclude<
    ComponentChange,
    {
      op:
        | "addNote"
        | "removeNote"
        | "setStyle"
        | "setHidden"
        | "setContent"
        | "setItem"
        | "addMember"
        | "removeMember";
    }
  >
): Changed<AppComponentFile> => {
  switch (change.op) {
    case "addProperty":
      return { ...file, properties: [...file.properties, change.property] };
    case "setProperty": {
      const property = propertyIn(file, change.name);
      if (!property) {
        return missing(file, "property", change.name);
      }
      const set: ComponentProperty = {
        ...property,
        ...(change.default !== undefined && { default: change.default }),
        ...(change.targets !== undefined && { targets: change.targets }),
      };
      const next = replaceProperty(file, change.name, set);
      return change.members === undefined
        ? next
        : withMembers(next, set, change.members);
    }
    case "renameProperty":
      return propertyIn(file, change.name)
        ? renameProperty(file, change.name, change.to.trim())
        : missing(file, "property", change.name);
    case "removeProperty":
      return propertyIn(file, change.name)
        ? removeProperty(file, change.name)
        : missing(file, "property", change.name);
    case "renameMember":
      return propertyIn(file, change.property)?.members?.includes(change.member)
        ? renameMember(file, change.property, change.member, change.to.trim())
        : missing(file, `member of ${change.property}`, change.member);
    case "addSlot":
      return { ...file, slots: [...file.slots, change.slot] };
    case "removeSlot":
      return file.slots.some((s) => s.name === change.name)
        ? { ...file, slots: file.slots.filter((s) => s.name !== change.name) }
        : missing(file, "slot", change.name);
    default:
      if (
        change.name !== null &&
        !file.slots.some((s) => s.name === change.name)
      ) {
        return missing(file, "slot", change.name);
      }
      return {
        ...file,
        slots: file.slots.map((s) => {
          const { default: _was, ...rest } = s;
          return s.name === change.name ? { ...rest, default: true } : rest;
        }),
      };
  }
};

/**
 * What a change does to an instance's props (a property renamed or taken out, a member renamed
 * or gone), as `setProps` takes them; null when it does nothing to them.
 */
const propsChange = (
  change: ComponentChange,
  props: Readonly<Record<string, JsonValue>> | undefined
): Record<string, JsonValue> | null => {
  if (!props) {
    return null;
  }
  switch (change.op) {
    case "renameProperty":
      return change.name in props
        ? {
            [change.name]: null,
            [change.to.trim()]: props[change.name] ?? null,
          }
        : null;
    case "removeProperty":
      return change.name in props ? { [change.name]: null } : null;
    case "renameMember":
      return props[change.property] === change.member
        ? { [change.property]: change.to.trim() }
        : null;
    case "setProperty": {
      const value = props[change.name];
      return change.members !== undefined &&
        typeof value === "string" &&
        !change.members.includes(value)
        ? { [change.name]: null }
        : null;
    }
    default:
      return null;
  }
};

/**
 * The operations that bring a document's instances of `component` along with a change to it:
 * their props, at their base and at each breakpoint or variant they set them.
 */
export const instanceOps = (
  root: DesignNode,
  component: string,
  change: ComponentChange
): DocOp[] =>
  [...walk(root)].flatMap((node): DocOp[] => {
    if (
      node.type !== "instance" ||
      node.from !== APP_FROM ||
      node.component !== component
    ) {
      return [];
    }
    const base = propsChange(change, node.props);
    const at = Object.entries(
      (node as { at?: Record<string, { props?: Record<string, JsonValue> }> })
        .at ?? {}
    ).flatMap(([key, over]) => {
      const props = propsChange(change, over.props);
      return props
        ? [{ at: key, id: node.id, op: "setProps" as const, props }]
        : [];
    });
    return [
      ...(base ? [{ id: node.id, op: "setProps" as const, props: base }] : []),
      ...at,
    ];
  });
