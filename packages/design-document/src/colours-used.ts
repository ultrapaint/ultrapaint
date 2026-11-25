/**
 * The colours a selection uses (the inspector's **Colours used**): every colour its trees set,
 * one entry per distinct value with each of its uses, and the operations that change one of them
 * everywhere it is used.
 *
 * The fields read are a node's `fill`, a text's `color`, an image's `tint` and its border's
 * `color`, at its own level and at each breakpoint of its `at` (ADR 0036), and, on an app
 * component's instance, its overrides by layer and theirs at a breakpoint (ADR 0114). A layer of
 * an instance selected reads that instance's overrides of it and of the layers under it, a nested
 * instance's included. A fill in layers (ADR 0134) is read colour by colour; a value that is no
 * colour (`currentColor`, an image, a variable) is not listed. A main component's tree, a shadow,
 * a text style and an instance's props, which are its component's API, are not read.
 *
 * A token is one value by its name, raw colours one value when they are the same colour
 * (`sameValue`): `#fff` and `#ffffff` are one entry, `$color-primary` and its `#2563eb` two. Pure.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import {
  type Comparable,
  comparable,
  isColor,
  sameAs,
} from "@ultrapaint/contracts/token-value";
import { type FillLayer, fillCss, layerColours, layeredFill } from "./fill.ts";
import {
  type AppFileOf,
  findLayer,
  instanceLayerOf,
  isLayerOf,
  LAYER_SEPARATOR,
  layerIdOf,
} from "./instance-layers.ts";
import { isToken, tokenName } from "./tokens.ts";
import { childrenOf, findNode, isRecord, walk } from "./tree.ts";

/** The fields a colour is read from. */
export type ColourField = "fill" | "color" | "tint" | "border.color";

/** One field holding a colour used. */
export interface ColourUse {
  /** The breakpoint whose `at` holds the field; none for the node's own. */
  readonly at?: string;
  readonly field: ColourField;
  /** What the field holds: the colour, the fill it is a colour of, or the border it is the colour of. */
  readonly holds: JsonValue;
  /** The layer of the instance `node` whose override holds the field, by its key in the overrides. */
  readonly layer?: string;
  /** The node's id: the instance's for one of its overrides. */
  readonly node: string;
}

/** A colour the selection uses, with every field that holds it. */
export interface ColourUsed {
  readonly uses: readonly ColourUse[];
  /** As its first use writes it: `$color-primary`, `#2563eb`. */
  readonly value: string;
}

type Fields = Readonly<Record<string, JsonValue | undefined>>;

/** What a value is matched by: a token by its name, a raw colour by what it comes to. */
type Key =
  | { readonly token: string }
  | { readonly colour: Comparable; readonly token?: undefined };

const keyOf = (value: string): Key => {
  const text = value.trim();
  return isToken(text)
    ? { token: tokenName(text) }
    : { colour: comparable(text) };
};

const sameKey = (a: Key, b: Key): boolean =>
  a.token !== undefined || b.token !== undefined
    ? a.token === b.token
    : sameAs(a.colour, b.colour);

const isColourValue = (value: string) => isToken(value) || isColor(value);

/** The colours a field's value holds: a fill's colour by colour, anything else as it is. */
const coloursIn = (field: ColourField, value: string): string[] => {
  const layers = field === "fill" ? layeredFill(value) : null;
  const colours = layers ? layerColours(layers) : [value];
  return colours.filter(isColourValue);
};

/** A colour a field holds, and the use of it the field is. */
interface ColourFound {
  readonly colour: string;
  readonly use: ColourUse;
}

/** The colour fields of one level of a node: its own, a breakpoint's, or an override's. */
const levelFields = (
  fields: Fields,
  where: Pick<ColourUse, "at" | "layer" | "node">
): ColourFound[] => {
  const found: ColourFound[] = [];
  const read = (field: ColourField, value: unknown, holds: JsonValue) => {
    if (typeof value !== "string") {
      return;
    }
    for (const colour of coloursIn(field, value)) {
      found.push({ colour, use: { ...where, field, holds } });
    }
  };
  for (const field of ["fill", "color", "tint"] as const) {
    read(field, fields[field], fields[field] ?? null);
  }
  const { border } = fields;
  if (isRecord(border)) {
    read("border.color", border.color, border as JsonValue);
  }
  return found;
};

/** A level of a node and each of its breakpoints'. */
const withBreakpoints = (
  fields: Fields,
  where: Pick<ColourUse, "layer" | "node">
): ColourFound[] => [
  ...levelFields(fields, where),
  ...(isRecord(fields.at)
    ? Object.entries(fields.at).flatMap(([at, over]) =>
        isRecord(over) ? levelFields(over as Fields, { ...where, at }) : []
      )
    : []),
];

/** An instance's overrides of the layers `included` lets through, each with its breakpoints. */
const overridesOf = (
  instance: DesignNode,
  included: (layer: string) => boolean = () => true
): ColourFound[] =>
  instance.type === "instance" && instance.overrides
    ? Object.entries(instance.overrides).flatMap(([layer, fields]) =>
        included(layer)
          ? withBreakpoints(fields as Fields, { layer, node: instance.id })
          : []
      )
    : [];

/** Every colour field of a tree of the document, an instance's overrides among them. */
const treeFields = (node: DesignNode): ColourFound[] => [
  ...withBreakpoints(node as unknown as Fields, { node: node.id }),
  ...overridesOf(node),
  ...childrenOf(node).flatMap(treeFields),
];

/**
 * The colour fields of a layer of an instance and the layers under it: the instance's overrides of
 * each, by the keys its drawn tree names them by, a nested instance's layers under its own key, and
 * the nodes in its slots as the document holds them.
 */
const layerFields = (
  root: DesignNode,
  id: string,
  fileOf: AppFileOf
): ColourFound[] => {
  const way = instanceLayerOf(id);
  const instance = way ? findNode(root, way.instance) : null;
  const drawn = findLayer(root, id, fileOf);
  if (!(way && instance && drawn)) {
    return [];
  }
  const prefix = `${way.instance}${LAYER_SEPARATOR}`;
  const keys = new Set<string>();
  const slotted: DesignNode[] = [];
  const visit = (node: DesignNode) => {
    if (!node.id.startsWith(prefix)) {
      const own = findNode(root, node.id);
      if (own) {
        slotted.push(own);
      }
      return;
    }
    keys.add(node.id.slice(prefix.length));
    childrenOf(node).forEach(visit);
  };
  visit(drawn);
  // A layer of a nested instance is its own key under the nested instance's: `nav/label`.
  const under = (layer: string) => {
    const steps = layer.split(LAYER_SEPARATOR);
    return steps.some((_, i) =>
      keys.has(steps.slice(0, i + 1).join(LAYER_SEPARATOR))
    );
  };
  return [...overridesOf(instance, under), ...slotted.flatMap(treeFields)];
};

const fieldOf = (use: ColourUse) =>
  [use.node, use.layer ?? "", use.at ?? "", use.field].join("\u0000");

/**
 * The colours the nodes `ids` of a page's tree use, and their trees: one entry per distinct value
 * in the order the page first uses it, each use of a field once however often it is selected.
 */
export const coloursUsed = (
  root: DesignNode,
  ids: readonly string[],
  fileOf: AppFileOf
): ColourUsed[] => {
  const entries: {
    key: Key;
    seen: Set<string>;
    uses: ColourUse[];
    value: string;
  }[] = [];
  // In the page's order, whatever the order of selecting; a layer where its instance is.
  const order = new Map<string, number>();
  for (const node of walk(root)) {
    order.set(node.id, order.size);
  }
  const placeOf = (id: string) =>
    order.get(instanceLayerOf(id)?.instance ?? id) ?? order.size;
  const inOrder = [...ids].sort((a, b) => placeOf(a) - placeOf(b));
  for (const id of inOrder) {
    const node = isLayerOf(root, id) ? null : findNode(root, id);
    const found = node ? treeFields(node) : layerFields(root, id, fileOf);
    for (const { colour, use } of found) {
      const key = keyOf(colour);
      let entry = entries.find((e) => sameKey(e.key, key));
      if (!entry) {
        entry = { key, seen: new Set(), uses: [], value: colour.trim() };
        entries.push(entry);
      }
      const k = fieldOf(use);
      // A field selected twice, or holding the colour twice (a gradient's stops), is one use.
      if (!entry.seen.has(k)) {
        entry.seen.add(k);
        entry.uses.push(use);
      }
    }
  }
  return entries.map(({ uses, value }) => ({ uses, value }));
};

/** A fill with each of its colours that is `from` changed to `to`. */
const recolouredFill = (fill: string, from: Key, to: string): string => {
  const layers = layeredFill(fill);
  if (!layers) {
    return to;
  }
  const swap = (colour: string) => (sameKey(keyOf(colour), from) ? to : colour);
  return (
    fillCss(
      layers.map((layer): FillLayer => {
        if (layer.kind === "color") {
          return { ...layer, color: swap(layer.color) };
        }
        return layer.kind === "gradient"
          ? {
              ...layer,
              stops: layer.stops.map((stop) => ({
                ...stop,
                color: swap(stop.color),
              })),
            }
          : layer;
      })
    ) ?? to
  );
};

/**
 * One `update` for every use of a colour, setting it to `to` where the use is stored: at its
 * breakpoint, and on an instance's layer by the layer's id (`shell/side`). A border keeps the rest
 * of itself; a fill in layers changes only the colours that were this one.
 */
export const recolourOps = (used: ColourUsed, to: string): DocOp[] => {
  const from = keyOf(used.value);
  return used.uses.map((use): DocOp => {
    const id =
      use.layer === undefined ? use.node : layerIdOf(use.node, use.layer);
    let set: Record<string, JsonValue>;
    if (use.field === "border.color") {
      set = {
        border: { ...(use.holds as Record<string, JsonValue>), color: to },
      };
    } else if (use.field === "fill" && typeof use.holds === "string") {
      set = { fill: recolouredFill(use.holds, from, to) };
    } else {
      set = { [use.field]: to };
    }
    return {
      ...(use.at !== undefined && { at: use.at }),
      id,
      op: "update",
      set,
    };
  });
};
