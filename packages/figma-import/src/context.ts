/**
 * What an instance changes in the component it is of. Figma keeps a component's layers once,
 * under the symbol; an instance carries overrides addressed by the override keys of those
 * layers, and values for the component's properties (a label's text, a part's visibility).
 * Converting an instance is converting the symbol's layers with these in effect.
 */
import type { FigGuid, FigNode } from "openfig-core";
import { nodeId } from "openfig-core";
import { type FigFile, guidOf } from "./fig.ts";

/** A change an instance makes to one node of its component, addressed by override keys. */
export interface Override {
  readonly change: FigNode;
  readonly path: readonly string[];
}

export interface Context {
  /** Component property values in effect, by property definition id. */
  readonly assignments: ReadonlyMap<string, Record<string, unknown>>;
  readonly depth: number;
  readonly overrides: readonly Override[];
}

const STRUCTURAL = new Set([
  "derivedSymbolData",
  "guid",
  "guidPath",
  "guidPathTag",
  "guidTag",
  "parentIndex",
  "parentIndexTag",
  "phase",
  "phaseTag",
  "type",
  "typeTag",
]);

/** The fields a change carries, without the ones that say which node it is about. */
export const fieldsOf = (change: FigNode): Partial<FigNode> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(change)) {
    if (!STRUCTURAL.has(key) && value !== undefined) {
      out[key] = value;
    }
  }
  return out as Partial<FigNode>;
};

const keyOf = (node: FigNode) =>
  guidOf(node.overrideKey as FigGuid | undefined) ?? nodeId(node) ?? "";

const overridesOf = (instance: FigNode): Override[] =>
  ((instance.symbolData?.symbolOverrides ?? []) as FigNode[]).flatMap(
    (change) => {
      const guids = (change.guidPath?.guids ?? []) as FigGuid[];
      const path = guids.map((guid) => guidOf(guid) ?? "");
      return path.length === 0 ? [] : [{ change, path }];
    }
  );

const assignmentsOf = (instance: FigNode) => {
  const map = new Map<string, Record<string, unknown>>();
  for (const assignment of (instance.componentPropAssignments ?? []) as Record<
    string,
    unknown
  >[]) {
    const id = guidOf(assignment.defID as FigGuid | undefined);
    if (id !== null && assignment.value) {
      map.set(id, assignment.value as Record<string, unknown>);
    }
  }
  return map;
};

/** A component's default property values, from its definitions. */
export const defaultsOf = (owners: readonly FigNode[]) => {
  const map = new Map<string, Record<string, unknown>>();
  for (const owner of owners) {
    for (const def of (owner.componentPropDefs ?? []) as Record<
      string,
      unknown
    >[]) {
      const id = guidOf(def.id as FigGuid | undefined);
      if (id !== null && def.initialValue && !map.has(id)) {
        map.set(id, def.initialValue as Record<string, unknown>);
      }
    }
  }
  return map;
};

export const symbolOf = (
  file: FigFile,
  instance: FigNode
): FigNode | undefined => {
  const id = guidOf(instance.symbolData?.symbolID as FigGuid | undefined);
  return id === null ? undefined : file.node(id);
};

/** Where a symbol's properties are defined: on it, and on the state group it is a variant of. */
export const ownersOf = (file: FigFile, symbol: FigNode): FigNode[] => {
  const parentId = guidOf(symbol.parentIndex?.guid);
  const parent = parentId === null ? undefined : file.node(parentId);
  return parent ? [symbol, parent] : [symbol];
};

/** The context inside an instance: the overrides that reach it, then its own on top. */
export const contextFor = (
  file: FigFile,
  instance: FigNode,
  outer: Context,
  symbol: FigNode
): Context => {
  const key = keyOf(instance);
  const inherited = outer.overrides.flatMap((override) =>
    override.path.length > 1 && override.path[0] === key
      ? [{ change: override.change, path: override.path.slice(1) }]
      : []
  );
  const assignments = new Map(defaultsOf(ownersOf(file, symbol)));
  for (const [id, value] of assignmentsOf(instance)) {
    assignments.set(id, value);
  }
  return {
    assignments,
    depth: outer.depth + 1,
    overrides: [...inherited, ...overridesOf(instance)],
  };
};

const withOverrides = (node: FigNode, context: Context): FigNode => {
  const key = keyOf(node);
  let effective = node;
  for (const override of context.overrides) {
    if (override.path.length === 1 && override.path[0] === key) {
      effective = { ...effective, ...fieldsOf(override.change) };
    }
  }
  return effective;
};

/** One property value written into the field of the node that refers to the property. */
const withPropValue = (
  node: FigNode,
  field: unknown,
  value: Record<string, unknown>
): FigNode => {
  switch (field) {
    case "TEXT_DATA": {
      const characters = (
        value.textValue as { characters?: string } | undefined
      )?.characters;
      return characters === undefined
        ? node
        : { ...node, textData: { ...node.textData, characters } };
    }
    case "VISIBLE":
      return typeof value.boolValue === "boolean"
        ? { ...node, visible: value.boolValue }
        : node;
    case "OVERRIDDEN_SYMBOL_ID":
      return value.guidValue
        ? {
            ...node,
            symbolData: { ...node.symbolData, symbolID: value.guidValue },
          }
        : node;
    default:
      return node;
  }
};

const withPropValues = (node: FigNode, context: Context): FigNode => {
  let effective = node;
  for (const ref of (node.componentPropRefs ?? []) as Record<
    string,
    unknown
  >[]) {
    const id = guidOf(ref.defID as FigGuid | undefined);
    const value = id === null ? undefined : context.assignments.get(id);
    if (value && ref.isDeleted !== true) {
      effective = withPropValue(effective, ref.componentPropNodeField, value);
    }
  }
  return effective;
};

/** The node as the instance being converted shows it. */
export const applyContext = (node: FigNode, context: Context): FigNode =>
  withPropValues(withOverrides(node, context), context);
