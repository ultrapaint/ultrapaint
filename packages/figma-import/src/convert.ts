/**
 * A Figma frame as a page document. Fixed rules, no judgement: auto-layout becomes rows and
 * columns, text becomes text, image fills become images, shapes become SVG pictures, and an
 * instance of a Figma component becomes what the mapping says — an instance of one of this
 * repository's components, or the nodes the Figma component is made of. Pure and synchronous;
 * what the rules cannot carry across is said in the warnings.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type {
  DesignNode,
  ImageFit,
  InstanceFrom,
  PageNode,
} from "@ultrapaint/contracts/document";
import type { ComponentMapping } from "@ultrapaint/contracts/figma";
import { type IdGenerator, idPrefix } from "@ultrapaint/design-document/ids";
import type { FigGuid, FigNode, FigPaint } from "openfig-core";
import { nodeId } from "openfig-core";
import {
  applyContext,
  type Context,
  contextFor,
  defaultsOf,
  fieldsOf,
  ownersOf,
  symbolOf,
} from "./context.ts";
import { type FigComponent, type FigFile, guidOf, propName } from "./fig.ts";
import {
  boxOf,
  type Direction,
  fixedSize,
  frameSize,
  type OwnSize,
  type Placement,
  paddingOf,
  round,
  sizeOf,
  stackFields,
} from "./layout.ts";
import { noTokens, type TokenMatcher, topPaint } from "./paint.ts";
import { isShape, isVectorOnly, svgOf } from "./svg.ts";
import { textNode } from "./text.ts";

interface ConvertOptions {
  readonly mapping: Readonly<Record<string, ComponentMapping>>;
  readonly next: IdGenerator;
  /** The origin of a component a mapping names, as the catalogue has it; a system component's when left out. */
  readonly originOf?: (component: string) => InstanceFrom;
  /** Colours the design system has a token for come out as that token. */
  readonly tokens?: TokenMatcher;
}

/** A file an image node of the result shows; written into the shared assets. */
interface ImageFile {
  readonly bytes: Uint8Array;
  /** Inside the designs directory: `assets/figma-….png`. */
  readonly src: string;
}

export interface Conversion {
  readonly images: readonly ImageFile[];
  readonly root: DesignNode;
  /** Component key → instances expanded because nothing said what they should become. */
  readonly unmapped: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

type ComponentRule = Extract<ComponentMapping, { kind: "component" }>;

const MAX_DEPTH = 24;
const ASSETS = "assets";

const MAGIC: readonly (readonly [readonly number[], string])[] = [
  [[0x89, 0x50, 0x4e, 0x47], "png"],
  [[0xff, 0xd8, 0xff], "jpg"],
  [[0x47, 0x49, 0x46], "gif"],
  [[0x52, 0x49, 0x46, 0x46], "webp"],
];

const extensionOf = (bytes: Uint8Array): string | null =>
  MAGIC.find(([magic]) => magic.every((byte, i) => bytes[i] === byte))?.[1] ??
  null;

const hex = (bytes: Uint8Array | string | undefined): string => {
  if (bytes === undefined) {
    return "";
  }
  if (typeof bytes === "string") {
    return bytes;
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const HASH_MODULUS = 2 ** 32;
const HASH_SEED = 2_166_136_261;
const HASH_STEP = 31;

/** A stable short name for an SVG made here, from its text. */
const hashOf = (text: string) => {
  let hash = HASH_SEED;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * HASH_STEP + text.charCodeAt(i)) % HASH_MODULUS;
  }
  return hash.toString(16).padStart(8, "0");
};

const scaleModeOf = (paint: FigPaint) =>
  (paint as { imageScaleMode?: string }).imageScaleMode;

const fitOf = (mode: string | undefined): ImageFit | undefined => {
  switch (mode) {
    case "FIT":
      return "contain";
    case "STRETCH":
      return "fill";
    case "FILL":
      return "cover";
    default:
      return undefined;
  }
};

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;

const positionOf = (node: FigNode) => ({
  x: node.transform?.m02 ?? 0,
  y: node.transform?.m12 ?? 0,
});

/** A first child that is a plain rectangle the size of its parent is the parent's background. */
const isBackdrop = (parent: FigNode, child: FigNode) =>
  (child.type === "RECTANGLE" || child.type === "ROUNDED_RECTANGLE") &&
  !topPaint(child.fillPaints, "IMAGE") &&
  parent.size !== undefined &&
  child.size !== undefined &&
  Math.abs(child.size.x - parent.size.x) < 1 &&
  Math.abs(child.size.y - parent.size.y) < 1 &&
  Math.abs(positionOf(child).x) < 1 &&
  Math.abs(positionOf(child).y) < 1;

/** The frame with its backdrop's looks, where it has none of its own. */
const withBackdrop = (node: FigNode, backdrop: FigNode): FigNode => ({
  ...node,
  cornerRadius: node.cornerRadius ?? backdrop.cornerRadius,
  effects: node.effects?.length ? node.effects : backdrop.effects,
  fillPaints: node.fillPaints?.length ? node.fillPaints : backdrop.fillPaints,
  strokePaints: node.strokePaints?.length
    ? node.strokePaints
    : backdrop.strokePaints,
  strokeWeight: node.strokeWeight ?? backdrop.strokeWeight,
});

const ROW_TOLERANCE = 4;

/**
 * Free layout has no order but the stacking one; reading order is the better guess. Layers are
 * put in rows first, each starting at the highest layer left and taking those within a few
 * pixels of its top, then read left to right: one order, whatever order they come in.
 */
const readingOrder = (nodes: readonly FigNode[]) => {
  const byTop = [...nodes].sort((a, b) => positionOf(a).y - positionOf(b).y);
  const rows: FigNode[][] = [];
  let top = Number.NEGATIVE_INFINITY;
  for (const node of byTop) {
    const { y } = positionOf(node);
    const row = rows.at(-1);
    if (row && y - top < ROW_TOLERANCE) {
      row.push(node);
    } else {
      rows.push([node]);
      top = y;
    }
  }
  return rows.flatMap((row) =>
    row.sort((a, b) => positionOf(a).x - positionOf(b).x)
  );
};

const directionOf = (node: FigNode): Direction => {
  switch (node.stackMode) {
    case "HORIZONTAL":
      return "row";
    case "VERTICAL":
    case "GRID":
      return "column";
    default:
      return null;
  }
};

/** The value a Figma property has on an instance, as a prop value or as text. */
const propValueOf = (
  value: Record<string, unknown>
): string | boolean | null => {
  if (typeof value.boolValue === "boolean") {
    return value.boolValue;
  }
  if (value.textValue) {
    return String(
      (value.textValue as { characters?: string }).characters ?? ""
    );
  }
  return null;
};

const PLAIN_SHAPES = new Set([
  "RECTANGLE",
  "ROUNDED_RECTANGLE",
  "ELLIPSE",
  "LINE",
]);
const CONTAINERS = new Set(["FRAME", "GROUP", "SECTION", "SYMBOL"]);
const NO_SIZE: OwnSize = { height: undefined, width: undefined };

export const convertFrame = (
  file: FigFile,
  frame: FigNode,
  options: ConvertOptions
): Conversion => {
  const converter = makeConverter(file, options);
  const context = converter.rootContext();
  // A page of Figma's lists as a frame whatever is drawn on it: an instance, a text and a shape
  // have no layers of their own to lay out, and are what a frame would hold them as.
  return converter.finish(
    CONTAINERS.has(frame.type)
      ? converter.asPage(
          converter.container(frame, context, { direction: null }),
          frame.name
        )
      : converter.alone(frame, context)
  );
};

/** A component's definition, expanded as a page would show it: what "custom" would keep. */
export const convertComponent = (
  file: FigFile,
  component: FigComponent,
  options: ConvertOptions
): Conversion => {
  const converter = makeConverter(file, options);
  const [symbol] = component.symbols;
  if (!symbol) {
    return converter.finish(converter.asPage(null, component.name));
  }
  const context: Context = {
    assignments: defaultsOf(ownersOf(file, symbol)),
    depth: 0,
    overrides: [],
  };
  const converted = converter.container(symbol, context, { direction: null });
  return converter.finish(converter.asPage(converted, symbol.name));
};

const makeConverter = (file: FigFile, options: ConvertOptions) => {
  const tokens = options.tokens ?? noTokens;
  const { next } = options;
  const warnings = new Set<string>();
  const images = new Map<string, ImageFile>();
  const unmapped: Record<string, number> = {};
  const warn = (text: string) => warnings.add(text);
  const box = (node: FigNode, placement: Placement, own: OwnSize) =>
    boxOf(node, placement, own, tokens);

  const rootContext = (): Context => ({
    assignments: new Map(),
    depth: 0,
    overrides: [],
  });

  // ---- images ----

  const imageSrc = (paint: FigPaint): string | null => {
    const hash = hex(paint.image?.hash);
    const bytes = hash ? file.images.get(hash) : undefined;
    if (!bytes) {
      return null;
    }
    const extension = extensionOf(bytes);
    if (extension === null) {
      warn(
        `an image (${hash.slice(0, 8)}) is in a format the canvas cannot show`
      );
      return null;
    }
    const src = `${ASSETS}/figma-${hash.slice(0, 12)}.${extension}`;
    images.set(src, { bytes, src });
    return src;
  };

  const svgSrc = (node: FigNode): string | null => {
    const svg = svgOf(file, node);
    if (svg === null) {
      return null;
    }
    const src = `${ASSETS}/figma-${hashOf(svg)}.svg`;
    images.set(src, { bytes: new TextEncoder().encode(svg), src });
    return src;
  };

  const imageNode = (
    node: FigNode,
    placement: Placement,
    src: string,
    fit: ImageFit | undefined
  ): DesignNode =>
    compact({
      ...box(node, placement, fixedSize(node)),
      alt: node.name || "",
      fill: undefined,
      fit,
      id: next(idPrefix("image")),
      src,
      type: "image" as const,
    });

  /** The node as a picture of its image fill, or null when it has none it can show. */
  const imageFill = (
    node: FigNode,
    placement: Placement
  ): DesignNode | null => {
    const image = topPaint(node.fillPaints, "IMAGE");
    if (!image) {
      return null;
    }
    const src = imageSrc(image);
    return src === null
      ? null
      : imageNode(node, placement, src, fitOf(scaleModeOf(image)));
  };

  /** A container whose leaves are all shapes, as one picture. */
  const icon = (node: FigNode, placement: Placement): DesignNode | null => {
    if (!isVectorOnly(file, node)) {
      return null;
    }
    const src = svgSrc(node);
    return src === null ? null : imageNode(node, placement, src, undefined);
  };

  // ---- containers ----

  /** The children a frame lays out, with its backdrop taken as its own looks. */
  const layersOf = (
    node: FigNode,
    direction: Direction,
    extra: readonly FigNode[]
  ): { readonly merged: FigNode; readonly source: readonly FigNode[] } => {
    const source = [...file.childrenOf(nodeId(node) ?? ""), ...extra];
    if (direction !== null) {
      return { merged: node, source };
    }
    const [first] = source;
    const backdrop =
      first !== undefined && source.length > 1 && isBackdrop(node, first);
    const rest = backdrop ? source.slice(1) : source;
    if (rest.filter((child) => child.visible !== false).length > 1) {
      warn(
        `"${node.name}" places its layers freely; they were stacked in reading order`
      );
    }
    return {
      merged: backdrop ? withBackdrop(node, first) : node,
      source: readingOrder(rest),
    };
  };

  const container = (
    node: FigNode,
    context: Context,
    placement: Placement,
    extra: readonly FigNode[] = []
  ): DesignNode => {
    const direction = directionOf(node);
    if (node.stackMode === "GRID") {
      warn(`"${node.name}" uses a grid layout, which became a column`);
    }
    const { merged, source } = layersOf(node, direction, extra);
    const children = source.flatMap((child) => {
      if (child.stackPositioning === "ABSOLUTE" && direction !== null) {
        warn(
          `"${child.name}" is positioned absolutely inside "${node.name}"; it was put in the flow`
        );
      }
      const converted = convert(child, context, { direction });
      return converted ? [converted] : [];
    });
    const fields = box(merged, placement, frameSize(merged));
    if (direction === null) {
      return {
        ...fields,
        children,
        id: next(idPrefix("group")),
        type: "group",
      };
    }
    return compact({
      ...fields,
      ...stackFields(node),
      children,
      id: next(idPrefix(direction)),
      padding: paddingOf(node),
      type: direction,
    });
  };

  // ---- instances ----

  /** The text layers an instance shows, in order, with overrides applied. */
  const textLayers = (
    parent: FigNode,
    context: Context,
    into: string[]
  ): void => {
    for (const child of file.childrenOf(nodeId(parent) ?? "")) {
      const effective = applyContext(child, context);
      if (effective.visible === false) {
        continue;
      }
      if (effective.type === "TEXT") {
        into.push(String(effective.textData?.characters ?? "").trim());
      } else if (effective.type === "INSTANCE") {
        const nested = symbolOf(file, effective);
        if (nested && context.depth < MAX_DEPTH) {
          textLayers(
            nested,
            contextFor(file, effective, context, nested),
            into
          );
        }
      } else {
        textLayers(effective, context, into);
      }
    }
  };

  /** The text an instance shows. */
  const textOf = (symbol: FigNode, context: Context): string => {
    const parts: string[] = [];
    textLayers(symbol, context, parts);
    return parts.filter(Boolean).join(" ");
  };

  /** Every property of an instance by name: its variant, then its text and boolean props. */
  const propsOf = (
    symbol: FigNode,
    context: Context
  ): Record<string, string | boolean> => {
    const values: Record<string, string | boolean> = {
      ...file.variantOf(symbol),
    };
    for (const owner of ownersOf(file, symbol)) {
      for (const def of (owner.componentPropDefs ?? []) as Record<
        string,
        unknown
      >[]) {
        const id = guidOf(def.id as FigGuid | undefined);
        const assigned = id === null ? undefined : context.assignments.get(id);
        const value = assigned ? propValueOf(assigned) : null;
        if (
          value !== null &&
          def.isDeleted !== true &&
          def.type !== "VARIANT"
        ) {
          values[propName(String(def.name ?? ""))] = value;
        }
      }
    }
    return values;
  };

  /** One rule of the mapping applied to one value: a prop, or the text, or a warning. */
  const applyRule = (
    mapping: ComponentRule,
    figmaProp: string,
    value: string | boolean,
    props: Record<string, JsonValue>
  ): string | undefined => {
    const rule = mapping.propMap?.[figmaProp];
    if (!rule) {
      return undefined;
    }
    if (rule.text) {
      return String(value);
    }
    if (rule.prop === undefined) {
      return undefined;
    }
    const mapped = rule.values?.[String(value)];
    if (mapped !== undefined) {
      props[rule.prop] = mapped;
    } else if (rule.values === undefined) {
      props[rule.prop] = value;
    } else {
      warn(
        `${mapping.component}: no value for ${figmaProp}=${String(value)} in the mapping`
      );
    }
    return undefined;
  };

  const mappedInstance = (
    node: FigNode,
    symbol: FigNode,
    mapping: ComponentRule,
    context: Context,
    placement: Placement
  ): DesignNode => {
    const values = propsOf(symbol, context);
    const props: Record<string, JsonValue> = { ...(mapping.props ?? {}) };
    let label: string | undefined;
    for (const [figmaProp, value] of Object.entries(values)) {
      label = applyRule(mapping, figmaProp, value, props) ?? label;
    }
    if (mapping.text === "children") {
      label = textOf(symbol, context) || undefined;
    } else if (mapping.text !== undefined && mapping.text in values) {
      label = String(values[mapping.text]);
    }
    return compact({
      ...sizeOf(node, placement, NO_SIZE),
      component: mapping.component,
      from: options.originOf?.(mapping.component) ?? SYSTEM_FROM,
      id: next(idPrefix("instance")),
      name: node.name || undefined,
      props: Object.keys(props).length > 0 ? props : undefined,
      text: label,
      type: "instance" as const,
    });
  };

  /** An instance as the layers of its component, with what the instance changed in them. */
  const expandedInstance = (
    node: FigNode,
    symbol: FigNode,
    context: Context,
    placement: Placement
  ): DesignNode => {
    const asIcon = icon(symbol, placement);
    if (asIcon) {
      return {
        ...asIcon,
        ...sizeOf(node, placement, fixedSize(node)),
        name: node.name,
      };
    }
    // The instance's own fields are what it changes about the component's root.
    const effective: FigNode = {
      ...symbol,
      ...fieldsOf(node),
      guid: symbol.guid,
      name: node.name,
      symbolData: undefined,
      type: "FRAME",
    };
    const converted = container(
      effective,
      context,
      placement,
      file.childrenOf(nodeId(node) ?? "")
    );
    return { ...converted, name: node.name || "Instance" };
  };

  const instance = (
    node: FigNode,
    context: Context,
    placement: Placement
  ): DesignNode | null => {
    const component = file.componentOf(node);
    const mapping = component ? options.mapping[component.key] : undefined;
    if (mapping?.kind === "skip") {
      return null;
    }
    const symbol = symbolOf(file, node);
    if (!symbol) {
      warn(
        `"${node.name}" is an instance of a component that is not in the file; it is empty`
      );
      return compact({
        ...box(node, placement, fixedSize(node)),
        children: [],
        id: next(idPrefix("group")),
        type: "group" as const,
      });
    }
    if (context.depth >= MAX_DEPTH) {
      warn(`"${node.name}" nests instances too deep; the rest was left out`);
      return null;
    }
    const inner = contextFor(file, node, context, symbol);
    if (mapping?.kind === "component") {
      return mappedInstance(node, symbol, mapping, inner, placement);
    }
    if (component && mapping === undefined) {
      unmapped[component.key] = (unmapped[component.key] ?? 0) + 1;
    }
    return expandedInstance(node, symbol, inner, placement);
  };

  // ---- shapes ----

  /** A box, a circle or a rule: what a group with a fill draws. */
  const plainShape = (node: FigNode, placement: Placement): DesignNode => {
    const fields = box(node, placement, fixedSize(node));
    const line = node.type === "LINE";
    return compact({
      ...fields,
      border: line ? undefined : fields.border,
      children: [],
      fill: line ? fields.border?.color : fields.fill,
      height: line ? round(node.strokeWeight ?? 1) : fields.height,
      id: next(idPrefix("group")),
      radius: node.type === "ELLIPSE" ? "50%" : fields.radius,
      type: "group" as const,
    });
  };

  const shape = (node: FigNode, placement: Placement): DesignNode | null => {
    if (!isShape(node)) {
      return null;
    }
    if (topPaint(node.fillPaints, "IMAGE")) {
      return imageFill(node, placement);
    }
    if (PLAIN_SHAPES.has(node.type)) {
      return plainShape(node, placement);
    }
    const src = svgSrc(node);
    if (src === null) {
      warn(
        `"${node.name}" is a ${node.type.toLowerCase()} that could not be drawn`
      );
      return null;
    }
    return imageNode(node, placement, src, undefined);
  };

  // ---- one node ----

  const frameLike = (
    node: FigNode,
    context: Context,
    placement: Placement
  ): DesignNode | null => {
    const children = file.childrenOf(nodeId(node) ?? "");
    if (children.length === 0 && topPaint(node.fillPaints, "IMAGE")) {
      return imageFill(node, placement);
    }
    if (topPaint(node.fillPaints, "IMAGE")) {
      warn(`"${node.name}" has an image background, which was dropped`);
    }
    return (
      (children.length > 0 ? icon(node, placement) : null) ??
      container(node, context, placement)
    );
  };

  const convert = (
    raw: FigNode,
    context: Context,
    placement: Placement
  ): DesignNode | null => {
    const node = applyContext(raw, context);
    if (node.visible === false) {
      return null;
    }
    if (node.type === "TEXT") {
      return textNode(node, placement, { next, tokens, warn });
    }
    if (node.type === "INSTANCE") {
      return instance(node, context, placement);
    }
    if (CONTAINERS.has(node.type)) {
      return frameLike(node, context, placement);
    }
    return shape(node, placement);
  };

  /**
   * The converted frame as a page: a row's or a column's fields lift onto the page, which is the
   * screen's container (ADR 0075), a row's as its direction; a free layout is its child.
   */
  const asPage = (converted: DesignNode | null, name: string): PageNode => {
    if (converted === null) {
      return { children: [], id: "root", name, type: "page" };
    }
    if (converted.type === "column" || converted.type === "row") {
      const { at, height, id, type, width, ...fields } = converted;
      return compact({
        ...fields,
        ...(type === "row" && { direction: "row" as const }),
        id: "root",
        name,
        type: "page",
      });
    }
    // A free layout is the page's one child; its fill is the page's background too.
    const child = compact({
      ...converted,
      height: undefined,
      width: "fill" as const,
    }) as DesignNode;
    return compact({
      children: [child],
      fill: converted.fill,
      id: "root",
      name,
      type: "page",
    });
  };

  /**
   * What is no frame as a page's one child, at the size it has in Figma: a page stretches what
   * says no width, so one that has none hugs. Its fill stays its own.
   */
  const alone = (node: FigNode, context: Context): PageNode => {
    const converted = convert(node, context, { direction: null });
    if (converted === null) {
      const component =
        node.type === "INSTANCE" ? file.componentOf(node) : undefined;
      if (component && options.mapping[component.key]?.kind === "skip") {
        warn(
          `"${node.name}" is an instance of a component the mapping skips; its page is empty`
        );
      }
      return asPage(null, node.name);
    }
    const child = {
      ...converted,
      width: converted.width ?? ("hug" as const),
    } as DesignNode;
    return { children: [child], id: "root", name: node.name, type: "page" };
  };

  const finish = (root: DesignNode): Conversion => ({
    images: [...images.values()],
    root,
    unmapped,
    warnings: [...warnings],
  });

  return { alone, asPage, container, finish, rootContext };
};
