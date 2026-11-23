/**
 * The layers of an app component's instance, as a page reaches them (ADR 0114). A layer is named by
 * the way to it, the page's instance first: `shell/side` is the layer `side` of the instance
 * `shell`, `shell/nav/label` the layer `label` of the instance `nav` in it. The page's document
 * holds none of them: each is the component's layer as the instance draws it, its overrides laid
 * over it (`expandAppInstance`), the same object each time while the instance and the component's
 * file stay the same, so a selection of one compares as unchanged.
 *
 * Pure, and free of the catalogue: the server, the renderer and the editor share it.
 */

import type { JsonValue } from "@ultrapaint/contracts/base";
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type {
  AppComponentFile,
  ComponentProperty,
} from "@ultrapaint/contracts/components";
import type {
  DesignNode,
  DocOp,
  InstanceNode,
} from "@ultrapaint/contracts/document";
import { expandAppInstance } from "./app-components.ts";
import { childrenOf, findNode, findPath, isRecord } from "./tree.ts";

/** What separates an instance from its layer in a layer's id. */
export const LAYER_SEPARATOR = "/";

/** An app component's file by its name, when it has one. */
export type AppFileOf = (name: string) => AppComponentFile | undefined;

/** Whether an id names a layer of an instance rather than a node of the document. */
export const isInstanceLayer = (id: string): boolean =>
  id.includes(LAYER_SEPARATOR);

/**
 * Whether an id names a layer of an instance in this tree: the way to one, and no node of the
 * tree's own, which keeps any id it was given, a slash in it or not.
 */
export const isLayerOf = (
  root: DesignNode | null | undefined,
  id: string
): boolean => isInstanceLayer(id) && findPath(root, id) === null;

/**
 * A layer's instance in the document and the layer's key among that instance's overrides:
 * `shell/nav/label` is `nav/label` of `shell`.
 */
export const instanceLayerOf = (
  id: string
): { readonly instance: string; readonly layer: string } | null => {
  const at = id.indexOf(LAYER_SEPARATOR);
  return at === -1
    ? null
    : { instance: id.slice(0, at), layer: id.slice(at + 1) };
};

/** The id a layer `layer` of the instance `instance` is drawn and selected by. */
export const layerIdOf = (instance: string, layer: string): string =>
  `${instance}${LAYER_SEPARATOR}${layer}`;

/** A layer's own id in its component's tree: the last of the way to it. */
export const componentLayerOf = (id: string): string =>
  id.slice(id.lastIndexOf(LAYER_SEPARATOR) + 1);

const drawn = new WeakMap<
  InstanceNode,
  WeakMap<AppComponentFile, DesignNode>
>();

/**
 * The tree an app component's instance draws, its layers named by the way to them from the
 * instance (`layerIdOf`); the instance's children in its slots keep their own ids. The same tree
 * while the instance and the file are the same objects.
 */
export const instanceLayers = (
  file: AppComponentFile,
  instance: InstanceNode
): DesignNode => {
  let byFile = drawn.get(instance);
  const known = byFile?.get(file);
  if (known) {
    return known;
  }
  const { tree } = expandAppInstance(file, instance, (id) =>
    layerIdOf(instance.id, id)
  );
  if (!byFile) {
    byFile = new WeakMap();
    drawn.set(instance, byFile);
  }
  byFile.set(file, tree);
  return tree;
};

/** The app component an instance places, when it is one. */
const appOf = (node: DesignNode | undefined, fileOf: AppFileOf) =>
  node?.type === "instance" && node.from === APP_FROM
    ? fileOf(node.component)
    : undefined;

/**
 * The way down to a node of the document or to a layer of an instance, the root first. A layer's
 * way goes through its instances and the component's layers around it, each as its instance
 * draws it; the instance's own root layer is the instance itself, never on the way.
 */
export const layerPath = (
  root: DesignNode | null | undefined,
  id: string,
  fileOf: AppFileOf
): DesignNode[] | null => {
  const direct = findPath(root, id);
  if (direct || !isInstanceLayer(id)) {
    return direct;
  }
  const steps = id.split(LAYER_SEPARATOR);
  let path = findPath(root, steps[0] ?? "");
  for (let i = 1; path && i < steps.length; i += 1) {
    const instance = path.at(-1);
    const file = appOf(instance, fileOf);
    if (!file) {
      return null;
    }
    const tree = instanceLayers(file, instance as InstanceNode);
    const inside = findPath(tree, steps.slice(0, i + 1).join(LAYER_SEPARATOR));
    path = inside ? [...path, ...inside.slice(1)] : null;
  }
  return path;
};

/** A node of the document, or a layer of an instance, by id. */
export const findLayer = (
  root: DesignNode | null | undefined,
  id: string,
  fileOf: AppFileOf
): DesignNode | null => layerPath(root, id, fileOf)?.at(-1) ?? null;

/**
 * The instance a layer is drawn by, innermost first: `shell/nav/label`'s is the instance
 * `shell/nav`, as `shell` draws it. Null for a node of the document.
 */
export const layerOwner = (
  root: DesignNode | null | undefined,
  id: string,
  fileOf: AppFileOf
): InstanceNode | null => {
  if (!isInstanceLayer(id)) {
    return null;
  }
  const owner = layerPath(
    root,
    id.slice(0, id.lastIndexOf(LAYER_SEPARATOR)),
    fileOf
  )?.at(-1);
  return owner?.type === "instance" ? owner : null;
};

/** The field of a layer a property of each kind sets, when it sets the layer's own. */
export const FIELD_OF_KIND: Readonly<Record<string, string>> = {
  boolean: "hidden",
  image: "src",
  text: "text",
};

/** A field's value as its property's: a layer hidden is its boolean property off. */
export const asPropertyValue = (kind: string, value: JsonValue): JsonValue => {
  if (value === null) {
    // Given back: the property's own default, not a value of its own.
    return null;
  }
  return kind === "boolean" ? value !== true : value;
};

/** The property of `file` that sets `field` of its layer `layer`, when one does. */
const propertyOfField = (
  file: AppComponentFile,
  layer: string,
  field: string
): ComponentProperty | undefined =>
  file.properties.find(
    (p) =>
      FIELD_OF_KIND[p.kind] === field &&
      p.targets?.some((t) => t.node === layer && t.prop === undefined)
  );

/**
 * A layer's fields set apart: those a property of the component sets, as that property's values,
 * and the rest, the layer's instance override's. A null gives back what the instance override
 * holds (`held`), set before the field was a property: it is the override's to clear.
 */
const splitByProperty = (
  file: AppComponentFile,
  layer: string,
  given: Readonly<Record<string, JsonValue>>,
  held: Readonly<Record<string, unknown>> | undefined
) => {
  const props: Record<string, JsonValue> = {};
  const set: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(given)) {
    const property = propertyOfField(file, layer, key);
    if (property && !(value === null && held?.[key] !== undefined)) {
      props[property.name] = asPropertyValue(property.kind, value);
    } else {
      set[key] = value;
    }
  }
  return { props, set };
};

/** An instance's props set, from a breakpoint on when one is named. */
const setPropsOp = (
  id: string,
  props: Record<string, JsonValue>,
  at: string | undefined
): DocOp => ({ id, op: "setProps", props, ...(at !== undefined && { at }) });

/**
 * Edits of instances' layers made what they are for (ADR 0114): a field a property of the
 * component sets (a text, a layer shown, a picture, a nested instance's prop) is set as that
 * property on the instance that draws the layer, through every instance that exposes it in turn;
 * the rest stay the layer's overrides. Every other operation is left as it is.
 */
export const throughProperties = (
  ops: readonly DocOp[],
  root: DesignNode | null | undefined,
  fileOf: AppFileOf
): DocOp[] => {
  /**
   * What the page's instance's override of a layer holds, a breakpoint's when one is named: the
   * fields set on the layer itself, which a property exposed since does not hold.
   */
  const heldOverride = (id: string, at: string | undefined) => {
    const way = instanceLayerOf(id);
    const instance = way ? findNode(root, way.instance) : null;
    const over =
      way && instance?.type === "instance"
        ? instance.overrides?.[way.layer]
        : undefined;
    if (at === undefined) {
      return over;
    }
    const byBreakpoint = over?.at;
    const atOver = isRecord(byBreakpoint) ? byBreakpoint[at] : undefined;
    return isRecord(atOver) ? (atOver as Record<string, JsonValue>) : undefined;
  };
  /** The instance drawing a layer, and the component it places, when it is an app component's. */
  const ownerOf = (id: string) => {
    const owner = layerOwner(root, id, fileOf);
    const file = owner ? appOf(owner, fileOf) : undefined;
    return owner && file ? { file, owner } : null;
  };
  const setProps = (
    id: string,
    props: Record<string, JsonValue>,
    at: string | undefined
  ): DocOp[] => {
    const found = isInstanceLayer(id) ? ownerOf(id) : null;
    if (!found) {
      return [setPropsOp(id, props, at)];
    }
    const layer = componentLayerOf(id);
    const outer: Record<string, JsonValue> = {};
    const own: Record<string, JsonValue> = {};
    const heldProps = heldOverride(id, at)?.props;
    for (const [key, value] of Object.entries(props)) {
      const property = found.file.properties.find((p) =>
        p.targets?.some((t) => t.node === layer && t.prop === key)
      );
      const held =
        value === null && isRecord(heldProps) && heldProps[key] !== undefined;
      if (property && !held) {
        outer[property.name] = value;
      } else {
        own[key] = value;
      }
    }
    return [
      ...(Object.keys(outer).length > 0
        ? setProps(found.owner.id, outer, at)
        : []),
      ...(Object.keys(own).length > 0 ? [setPropsOp(id, own, at)] : []),
    ];
  };
  return ops.flatMap((given): DocOp[] => {
    // A node of the document keeps its own id, slash or not.
    if (!("id" in given && isLayerOf(root, given.id))) {
      return [given];
    }
    // A layer removed is hidden there, through the property that shows it when one does.
    const op: DocOp =
      given.op === "remove"
        ? { id: given.id, op: "update", set: { hidden: true } }
        : given;
    if (op.op === "setProps") {
      return setProps(op.id, op.props, op.at);
    }
    if (op.op !== "update") {
      return [op];
    }
    const found = ownerOf(op.id);
    if (!found) {
      return [op];
    }
    const { props, set } = splitByProperty(
      found.file,
      componentLayerOf(op.id),
      op.set,
      heldOverride(op.id, op.at)
    );
    return [
      ...(Object.keys(props).length > 0
        ? setProps(found.owner.id, props, op.at)
        : []),
      ...(Object.keys(set).length > 0 ? [{ ...op, set }] : []),
    ];
  });
};

/**
 * A breakpoint's part of an instance override as operations on the main component's layer: its
 * props set one by one, the main's other props there kept, then its other fields.
 */
const breakpointOps = (
  layer: string,
  at: string,
  set: Readonly<Record<string, unknown>>
): DocOp[] => {
  const { props, ...rest } = set as Record<string, JsonValue>;
  return [
    ...(Object.keys(rest).length > 0
      ? [{ at, id: layer, op: "update", set: rest } as DocOp]
      : []),
    ...(isRecord(props)
      ? [
          {
            at,
            id: layer,
            op: "setProps",
            props: props as Record<string, JsonValue>,
          } as DocOp,
        ]
      : []),
  ];
};

/**
 * An instance's instance overrides as operations on its component's own document (ADR 0114,
 * "Apply to main component"): each layer's fields set on the layer, a breakpoint's at it, a nested instance's
 * props as its props; a nested instance's layer as that instance's override in the component.
 */
export const overridesAsMainOps = (
  overrides: NonNullable<InstanceNode["overrides"]>
): DocOp[] =>
  Object.entries(overrides).flatMap(([layer, entry]): DocOp[] => {
    const { at, props, ...own } = entry as Record<string, JsonValue>;
    const ops: DocOp[] = [];
    if (Object.keys(own).length > 0) {
      ops.push({ id: layer, op: "update", set: own });
    }
    if (isRecord(props)) {
      ops.push({
        id: layer,
        op: "setProps",
        props: props as Record<string, JsonValue>,
      });
    }
    if (isRecord(at)) {
      for (const [name, set] of Object.entries(at)) {
        if (isRecord(set)) {
          ops.push(...breakpointOps(layer, name, set));
        }
      }
    }
    return ops;
  });

/**
 * The layers an app component's instance draws of its own, as Layers lists them under it (ADR
 * 0114): the component's layers as the instance draws them, without the instance's own children
 * in its slots, which are listed beside them as the page's. None for any other node.
 */
export const ownLayersOf = (
  node: DesignNode,
  fileOf: AppFileOf
): readonly DesignNode[] => {
  const file = appOf(node, fileOf);
  if (!file) {
    return [];
  }
  const given = new Set(childrenOf(node).map((child) => child.id));
  const without = (layer: DesignNode): DesignNode => {
    const kids = childrenOf(layer);
    const kept = kids
      .filter((child) => !given.has(child.id))
      .map((child) => without(child));
    return kept.length === kids.length && kept.every((k, i) => k === kids[i])
      ? layer
      : ({ ...layer, children: kept } as DesignNode);
  };
  return childrenOf(instanceLayers(file, node as InstanceNode))
    .filter((layer) => !given.has(layer.id))
    .map(without);
};
