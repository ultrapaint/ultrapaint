/**
 * Reading a `.fig` file. Figma keeps a design as a flat list of node changes in a kiwi message
 * inside a zip; `openfig-core` decodes that. This module turns the list into what an import
 * needs: the pages and the frames on them, the components (Figma calls them symbols) with their
 * variants and properties, the instances that use them, and the images. Pure and synchronous.
 */
import {
  type FigDocument,
  type FigGuid,
  type FigNode,
  nodeId,
  parseFig,
} from "openfig-core";

export type { FigGuid, FigNode } from "openfig-core";

export const guidOf = (guid: FigGuid | undefined): string | null =>
  guid ? `${guid.sessionID}:${guid.localID}` : null;

/** A node's id as Figma shows it, `12:345`. */
export const idOf = (node: FigNode): string => nodeId(node) ?? "";

/** A component of the file: one symbol, or a set of variants under a state group. */
export interface FigComponent {
  readonly description: string | undefined;
  /** Unique across the file. */
  readonly key: string;
  readonly name: string;
  readonly page: string;
  readonly props: readonly FigPropDef[];
  /** One symbol per variant; a plain component has one. */
  readonly symbols: readonly FigNode[];
  readonly uses: number;
  readonly variants: Readonly<Record<string, readonly string[]>>;
}

/** A component property (text, boolean, instance swap); variants are read from symbol names. */
export interface FigPropDef {
  readonly id: string;
  /** Without the `#12:34` Figma appends to keep names unique. */
  readonly name: string;
  readonly type: "text" | "boolean" | "instance" | "other";
}

export interface FigPage {
  readonly frames: readonly FigNode[];
  readonly id: string;
  readonly name: string;
}

export interface FigFile {
  /** The nodes under a node, in layer order, with the deleted ones left out. */
  readonly childrenOf: (id: string) => readonly FigNode[];
  /** The component an instance is of, or null when its symbol is not in the file. */
  readonly componentOf: (instance: FigNode) => FigComponent | null;
  readonly components: readonly FigComponent[];
  readonly doc: FigDocument;
  readonly images: ReadonlyMap<string, Uint8Array>;
  readonly node: (id: string) => FigNode | undefined;
  readonly pages: readonly FigPage[];
  /** The variant a symbol is, `{Size: "Large"}`, from its name; empty for a plain component. */
  readonly variantOf: (symbol: FigNode) => Readonly<Record<string, string>>;
}

const PROP_SUFFIX_RE = /#\d+:\d+$/;
const VARIANT_RE = /^([^=]+)=(.*)$/;

/** `Label#12:3` is `Label`. */
export const propName = (name: string) => name.replace(PROP_SUFFIX_RE, "");

const propType = (type: string | undefined): FigPropDef["type"] => {
  switch (type) {
    case "TEXT":
      return "text";
    case "BOOL":
      return "boolean";
    case "INSTANCE_SWAP":
      return "instance";
    default:
      return "other";
  }
};

/** `Size=Large, State=Hover` → `{Size: "Large", State: "Hover"}`. */
export const parseVariant = (name: string): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const part of name.split(",")) {
    const match: RegExpExecArray | null = VARIANT_RE.exec(part.trim());
    if (match !== null) {
      const [, property = "", value = ""] = match;
      values[property.trim()] = value.trim();
    }
  }
  return values;
};

const isAlive = (node: FigNode) => node.phase !== "REMOVED";

const isStateGroup = (node: FigNode) =>
  node.type === "FRAME" && node.isStateGroup === true;

/** What counts as a frame on a page: anything drawn, but not a component's definition. */
const isFrameLike = (node: FigNode) =>
  node.type !== "SYMBOL" &&
  !isStateGroup(node) &&
  node.type !== "SECTION" &&
  node.size !== undefined;

const byPosition = (a: FigNode, b: FigNode) => {
  const pa = a.parentIndex?.position ?? "";
  const pb = b.parentIndex?.position ?? "";
  if (pa < pb) {
    return -1;
  }
  return pa > pb ? 1 : 0;
};

const propDefsOf = (node: FigNode): FigPropDef[] =>
  ((node.componentPropDefs ?? []) as readonly Record<string, unknown>[])
    .filter((def) => def.isDeleted !== true && def.type !== "VARIANT")
    .flatMap((def) => {
      const id = guidOf(def.id as FigGuid | undefined);
      return id === null
        ? []
        : [
            {
              id,
              name: propName(String(def.name ?? "")),
              type: propType(def.type as string | undefined),
            },
          ];
    });

interface Index {
  readonly children: ReadonlyMap<string, readonly FigNode[]>;
  readonly nodes: ReadonlyMap<string, FigNode>;
}

/** The live nodes by id, and each one's children in layer order. */
const indexNodes = (doc: FigDocument): Index => {
  const nodes = new Map<string, FigNode>();
  const children = new Map<string, FigNode[]>();
  for (const node of doc.nodes) {
    const id = nodeId(node);
    if (id === null || !isAlive(node)) {
      continue;
    }
    nodes.set(id, node);
    const parent = guidOf(node.parentIndex?.guid);
    if (parent !== null) {
      const list = children.get(parent) ?? [];
      list.push(node);
      children.set(parent, list);
    }
  }
  for (const list of children.values()) {
    list.sort(byPosition);
  }
  return { children, nodes };
};

const pageOf = (index: Index, node: FigNode): FigNode | null => {
  let current: FigNode | undefined = node;
  while (current && current.type !== "CANVAS") {
    const parent = guidOf(current.parentIndex?.guid);
    current = parent === null ? undefined : index.nodes.get(parent);
  }
  return current ?? null;
};

interface Draft {
  readonly definition: FigNode;
  readonly symbols: readonly FigNode[];
}

/** Every symbol, grouped under its state group when it is a variant of one. */
const draftsOf = (index: Index): Draft[] => {
  const groups = new Map<string, FigNode[]>();
  const plain: Draft[] = [];
  for (const symbol of index.nodes.values()) {
    if (symbol.type !== "SYMBOL") {
      continue;
    }
    const parentId = guidOf(symbol.parentIndex?.guid);
    const parent = parentId === null ? undefined : index.nodes.get(parentId);
    if (parent && isStateGroup(parent)) {
      const id = nodeId(parent) ?? "";
      groups.set(id, [...(groups.get(id) ?? []), symbol]);
    } else {
      plain.push({ definition: symbol, symbols: [symbol] });
    }
  }
  return [
    ...[...groups].map(([id, list]) => ({
      definition: index.nodes.get(id) as FigNode,
      symbols: list,
    })),
    ...plain,
  ].sort((a, b) =>
    (nodeId(a.definition) ?? "").localeCompare(nodeId(b.definition) ?? "")
  );
};

const usesOf = (index: Index) => {
  const uses = new Map<string, number>();
  for (const node of index.nodes.values()) {
    if (node.type === "INSTANCE") {
      const symbolId = guidOf(node.symbolData?.symbolID as FigGuid | undefined);
      if (symbolId !== null) {
        uses.set(symbolId, (uses.get(symbolId) ?? 0) + 1);
      }
    }
  }
  return uses;
};

const variantsOf = (definition: FigNode, symbols: readonly FigNode[]) => {
  const variants: Record<string, Set<string>> = {};
  if (isStateGroup(definition)) {
    for (const symbol of symbols) {
      for (const [property, value] of Object.entries(
        parseVariant(symbol.name)
      )) {
        variants[property] ??= new Set();
        variants[property].add(value);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(variants).map(([property, values]) => [
      property,
      [...values],
    ])
  );
};

/** One key per name; a second component of the same name gets its id appended. */
const makeKeys = () => {
  const keys = new Set<string>();
  return (name: string, definition: FigNode) => {
    const base = name || "Component";
    const key = keys.has(base) ? `${base} (${nodeId(definition) ?? ""})` : base;
    keys.add(key);
    return key;
  };
};

const componentOf = (
  index: Index,
  { definition, symbols }: Draft,
  key: string,
  uses: ReadonlyMap<string, number>
): FigComponent => {
  const props = new Map<string, FigPropDef>();
  for (const owner of [definition, ...symbols]) {
    for (const def of propDefsOf(owner)) {
      if (!props.has(def.name)) {
        props.set(def.name, def);
      }
    }
  }
  const description = String(
    definition.description ?? definition.symbolDescription ?? ""
  ).trim();
  return {
    description: description || undefined,
    key,
    name: definition.name.trim(),
    page: pageOf(index, definition)?.name ?? "",
    props: [...props.values()],
    symbols,
    uses: symbols.reduce(
      (sum, symbol) => sum + (uses.get(nodeId(symbol) ?? "") ?? 0),
      0
    ),
    variants: variantsOf(definition, symbols),
  };
};

const pagesOf = (index: Index): FigPage[] => {
  const childrenOf = (id: string) => index.children.get(id) ?? [];
  const document = [...index.nodes.values()].find((n) => n.type === "DOCUMENT");
  return childrenOf(document ? (nodeId(document) ?? "0:0") : "0:0")
    .filter(
      (canvas) => canvas.type === "CANVAS" && canvas.internalOnly !== true
    )
    .map((canvas) => {
      const id = nodeId(canvas) ?? "";
      // A section only files frames; what it holds is what the page shows.
      const frames = childrenOf(id).flatMap((child) => {
        if (child.type === "SECTION") {
          return childrenOf(nodeId(child) ?? "").filter(isFrameLike);
        }
        return isFrameLike(child) ? [child] : [];
      });
      return { frames, id, name: canvas.name };
    });
};

/** Reads a `.fig` file's bytes. Throws when the bytes are not a Figma file. */
export const readFig = (bytes: Uint8Array): FigFile => {
  const doc = parseFig(bytes);
  const index = indexNodes(doc);
  const uses = usesOf(index);
  const keyFor = makeKeys();
  const bySymbol = new Map<string, FigComponent>();
  const components = draftsOf(index).map((draft) => {
    const component = componentOf(
      index,
      draft,
      keyFor(draft.definition.name.trim(), draft.definition),
      uses
    );
    for (const symbol of draft.symbols) {
      bySymbol.set(nodeId(symbol) ?? "", component);
    }
    return component;
  });
  return {
    childrenOf: (id) => index.children.get(id) ?? [],
    componentOf: (instance) => {
      const symbolId = guidOf(
        instance.symbolData?.symbolID as FigGuid | undefined
      );
      return symbolId === null ? null : (bySymbol.get(symbolId) ?? null);
    },
    components,
    doc,
    images: doc.images,
    node: (id) => index.nodes.get(id),
    pages: pagesOf(index),
    variantOf: (symbol) => {
      const parentId = guidOf(symbol.parentIndex?.guid);
      const parent = parentId === null ? undefined : index.nodes.get(parentId);
      return parent && isStateGroup(parent) ? parseVariant(symbol.name) : {};
    },
  };
};

/** Every node below one, depth first, itself left out. */
export const descendantsOf = (file: FigFile, id: string): FigNode[] => {
  const out: FigNode[] = [];
  const visit = (parent: string) => {
    for (const child of file.childrenOf(parent)) {
      out.push(child);
      visit(nodeId(child) ?? "");
    }
  };
  visit(id);
  return out;
};
