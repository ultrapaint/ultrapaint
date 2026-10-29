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
  type ComponentChange,
  ComponentFile,
  type ComponentProperty,
  componentFileOf,
  isVariantKey,
  type SystemComponentFile,
  variantKey,
} from "@ultrapaint/contracts/components";
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import { appComponentCycle } from "@ultrapaint/design-document/app-components";
import { serialise } from "@ultrapaint/design-document/factories";
import {
  childrenOf,
  findNode,
  idsOf,
  walk,
} from "@ultrapaint/design-document/tree";
import {
  type SystemComponentMeta,
  systemComponentOf,
} from "@ultrapaint/system-components/catalogue";
import { Schema } from "effect";

const decodeComponent = Schema.decodeUnknownResult(ComponentFile);

const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

/** A file's text as a component, or why it is not one. */
export type ComponentRead =
  | { readonly component: ComponentFile }
  | { readonly problem: string };

/** What a writer gives (a file's JSON, an editor's or an agent's) as a component, or why it is not one. */
export const componentOf = (json: unknown): ComponentRead => {
  const result = decodeComponent(json);
  return result._tag === "Success"
    ? { component: result.success }
    : { problem: result.failure.message };
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

/**
 * What is wrong with a system component's look against its catalogue entry, or nothing: it leaves
 * out only optional parts, gives content only to slots, and a template only to a Select's or a
 * Menu's items.
 */
const systemProblemOf = (
  component: SystemComponentFile,
  meta: SystemComponentMeta
): string | undefined => {
  const parts = new Map(meta.slots.map((s) => [s.name, s]));
  const fixed = (component.hidden ?? []).find((p) => !parts.get(p)?.optional);
  if (fixed !== undefined) {
    const optional = meta.slots.filter((s) => s.optional).map((s) => s.name);
    return `${component.name} cannot leave out ${fixed}: ${optional.length > 0 ? `its optional parts are ${optional.join(", ")}` : "it has no optional part"}`;
  }
  const notSlot = Object.keys(component.content ?? {}).find(
    (slot) => parts.get(slot)?.holds === undefined
  );
  if (notSlot !== undefined) {
    return `${component.name} has no slot ${notSlot} to give content: its slots are ${meta.slots.flatMap((s) => (s.holds ? [s.name] : [])).join(", ") || "none"}`;
  }
  const { item } = component;
  if (item && !meta.templatedItems) {
    return `${component.name} has no items to draw with a template: a Select's and a Menu's have`;
  }
  const ids = item ? idsOf(item.tree) : new Set<string>();
  const unbound = [item?.label, item?.image].find(
    (id) => id !== undefined && !ids.has(id)
  );
  return unbound === undefined
    ? undefined
    : `the item template shows the item in node ${unbound}, which its tree does not have`;
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
      ? systemProblemOf(component, system)
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
  const cycle = appComponentCycle(apps);
  return cycle?.includes(component.name)
    ? `${cycle.join(" places ")}: a component cannot place itself`
    : undefined;
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
export const renameProperty = (
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
export const renameMember = (
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
export const removeProperty = (
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
 * A component's file with a change made, or why it cannot be: a property, a slot or a note it
 * does not have, a look asked of an app component or properties of a system one. What the result
 * is checked for is `problemOf`'s.
 */
export const changedComponent = (
  file: ComponentFile,
  change: ComponentChange
): Changed<ComponentFile> => {
  if (change.op === "removeNote") {
    const notes = file.notes ?? [];
    return notes.some((n) => n.id === change.id)
      ? { ...file, notes: notes.filter((n) => n.id !== change.id) }
      : missing(file, "note", change.id);
  }
  if (change.op === "setLook") {
    if (file.origin !== "system") {
      return { problem: `${file.name} is an app component: it has no look` };
    }
    const { content: _c, hidden: _h, item: _i, ...envelope } = file;
    return { ...envelope, ...change.look };
  }
  if (file.origin !== "app") {
    return {
      problem: `${file.name} is a system component's look: it has no properties or slots`,
    };
  }
  return changedApp(file, change);
};

const changedApp = (
  file: AppComponentFile,
  change: Exclude<ComponentChange, { op: "removeNote" | "setLook" }>
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
