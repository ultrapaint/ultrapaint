/**
 * An app component's instance as the nodes it draws (ADR 0041): the component's tree with the
 * instance's property values in it, the overrides of each choice's member laid over the nodes
 * that keep them (`at["size=lg"]`, as a breakpoint's), and the instance's children in the slots
 * they name. The renderer draws it in the instance's place; "Detach" puts it there for good, with
 * ids of its own. Nested app components stay instances: each is drawn as its own when it is.
 *
 * Pure, and free of the catalogue: the server, the renderer and the editor share it.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  APP_FROM,
  isVariantKey,
  variantKey,
} from "@ultrapaint/contracts/component-names";
import type {
  AppComponentFile,
  ComponentProperty,
} from "@ultrapaint/contracts/components";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import { type IdGenerator, idPrefix } from "./ids.ts";
import { childrenOf } from "./tree.ts";

type Fields = Record<string, unknown>;

/** What a property is drawn with: the instance's value, or the property's default. */
export const propertyValue = (
  property: ComponentProperty,
  props: InstanceNode["props"]
): JsonValue => {
  const given = props?.[property.name];
  if (given === undefined || given === null) {
    return property.default;
  }
  if (property.kind === "choice" && property.members) {
    return typeof given === "string" && property.members.includes(given)
      ? given
      : property.default;
  }
  return given;
};

/** The keys of `at` the instance's choices pick: `size=lg` for a size `lg`. */
const chosenKeys = (
  file: AppComponentFile,
  props: InstanceNode["props"]
): string[] =>
  file.properties.flatMap((p) => {
    const value = propertyValue(p, props);
    return p.kind === "choice" && typeof value === "string"
      ? [variantKey(p.name, value)]
      : [];
  });

/** A node's fields with an override's over them; an instance's props are laid over its own. */
const layOver = (into: Fields, over: Fields) => {
  for (const [key, value] of Object.entries(over)) {
    if (key === "props" && value && typeof value === "object") {
      into.props = { ...(into.props as Fields | undefined), ...value };
    } else if (value !== undefined) {
      into[key] = value;
    }
  }
};

/** A node with the chosen members' overrides laid over it, and no variant's left in its `at`. */
const withVariants = (node: DesignNode, chosen: readonly string[]): Fields => {
  const { at, ...own } = node as DesignNode & { at?: Record<string, Fields> };
  const fields: Fields = { ...own };
  if (!at) {
    return fields;
  }
  for (const key of chosen) {
    const over = at[key];
    if (over) {
      layOver(fields, over);
    }
  }
  const breakpoints = Object.entries(at).filter(([key]) => !isVariantKey(key));
  if (breakpoints.length > 0) {
    fields.at = Object.fromEntries(breakpoints);
  }
  return fields;
};

/** What setting a property's value does to a node it targets. */
const setOn = (
  fields: Fields,
  property: ComponentProperty,
  value: JsonValue,
  prop: string | undefined
) => {
  if (prop !== undefined) {
    if (fields.type === "instance") {
      fields.props = { ...(fields.props as Fields | undefined), [prop]: value };
    }
    return;
  }
  if (property.kind === "boolean") {
    fields.hidden = value !== true;
  } else if (property.kind === "text" && typeof value === "string") {
    if (fields.type === "text") {
      fields.text = value;
    } else if (fields.type === "instance" && fields.children === undefined) {
      fields.text = value;
    }
  } else if (
    property.kind === "image" &&
    typeof value === "string" &&
    fields.type === "image"
  ) {
    fields.src = value;
  }
};

/** What drawing an instance comes to. */
export interface Expanded {
  /** The ids of the instance's own children put in its slots: the page's nodes, not the component's. */
  readonly filled: ReadonlySet<string>;
  readonly tree: DesignNode;
}

/**
 * The tree an instance of `file` draws. `rename` gives the component's nodes other ids (a detach's
 * new ones); the instance's children keep theirs.
 */
export const expandAppInstance = (
  file: AppComponentFile,
  instance: InstanceNode,
  rename: (id: string) => string = (id) => id
): Expanded => {
  const chosen = chosenKeys(file, instance.props);
  const targets = new Map<
    string,
    {
      property: ComponentProperty;
      prop: string | undefined;
      value: JsonValue;
    }[]
  >();
  for (const property of file.properties) {
    const value = propertyValue(property, instance.props);
    for (const target of property.targets ?? []) {
      targets.set(target.node, [
        ...(targets.get(target.node) ?? []),
        { prop: target.prop, property, value },
      ]);
    }
  }
  const given = instance.children ?? [];
  const named = new Set(file.slots.map((s) => s.name));
  const fallback = file.slots.find((s) => s.default);
  const fills = new Map<string, DesignNode[]>();
  for (const slot of file.slots) {
    const held = given.filter((child) =>
      slot === fallback
        ? child.slot === undefined ||
          child.slot === slot.name ||
          !named.has(child.slot)
        : child.slot === slot.name
    );
    if (held.length > 0) {
      fills.set(
        slot.node,
        held.map(({ slot: _slot, ...child }) => child as DesignNode)
      );
    }
  }
  const filled = new Set<string>();
  const visit = (node: DesignNode): DesignNode => {
    const fields = withVariants(node, chosen);
    for (const { property, prop, value } of targets.get(node.id) ?? []) {
      setOn(fields, property, value, prop);
    }
    fields.id = rename(node.id);
    const fill = fills.get(node.id);
    if (fill) {
      for (const child of fill) {
        filled.add(child.id);
      }
      fields.children = fill;
      if (fields.type === "instance") {
        fields.text = undefined;
      }
    } else if ("children" in node && node.children) {
      fields.children = childrenOf(node).map(visit);
    }
    return fields as unknown as DesignNode;
  };
  return { filled, tree: visit(file.tree) };
};

/** What an instance says of where it sits, which the nodes detached from it keep. */
const PLACEMENT = [
  "height",
  "hidden",
  "link",
  "locked",
  "margin",
  "maxHeight",
  "maxWidth",
  "minHeight",
  "minWidth",
  "name",
  "slot",
  "width",
  "x",
  "y",
] as const;

/**
 * An instance detached from its component (ADR 0041): the tree it draws, with its property values,
 * its choices' overrides and its slots' contents baked in, its nodes given new ids by `next`, and
 * its root where the instance was. Nested components stay instances.
 */
export const detachedOf = (
  file: AppComponentFile,
  instance: InstanceNode,
  next: IdGenerator
): DesignNode => {
  const types = new Map<string, string>();
  const visit = (node: DesignNode) => {
    types.set(node.id, node.type);
    childrenOf(node).forEach(visit);
  };
  visit(file.tree);
  const { tree } = expandAppInstance(file, instance, (id) =>
    next(idPrefix(types.get(id) ?? "n"))
  );
  const placement = Object.fromEntries(
    PLACEMENT.flatMap((field) => {
      const value = (instance as unknown as Fields)[field];
      return value === undefined ? [] : [[field, value] as const];
    })
  );
  return { ...tree, ...placement } as DesignNode;
};

/** The app components a tree places, by name, nested ones not included. */
export const appComponentsPlaced = (root: DesignNode): Set<string> => {
  const names = new Set<string>();
  const visit = (node: DesignNode) => {
    if (node.type === "instance" && node.from === APP_FROM) {
      names.add(node.component);
    }
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(root);
  return names;
};

/**
 * A way round through the app components, when there is one: `["Card", "Row", "Card"]` for a Card
 * that places a Row that places a Card. Such a component would draw itself forever.
 */
export const appComponentCycle = (
  files: readonly AppComponentFile[]
): readonly string[] | null => {
  const byName = new Map(files.map((f) => [f.name, f]));
  const done = new Set<string>();
  const visit = (name: string, path: readonly string[]): string[] | null => {
    if (path.includes(name)) {
      return [...path.slice(path.indexOf(name)), name];
    }
    if (done.has(name)) {
      return null;
    }
    const file = byName.get(name);
    if (file) {
      for (const inner of appComponentsPlaced(file.tree)) {
        const cycle = visit(inner, [...path, name]);
        if (cycle) {
          return cycle;
        }
      }
    }
    done.add(name);
    return null;
  };
  for (const file of files) {
    const cycle = visit(file.name, []);
    if (cycle) {
      return cycle;
    }
  }
  return null;
};
