/**
 * The operations every change to a document is made of, applied the same way wherever they
 * run: in the server for the editor and for agents, and in tests. Pure: an operation that does
 * not fit the tree throws a `DocumentOpError`, which the server turns into a wire error. Types of
 * field values are not checked here; the server decodes the result against the schema.
 */
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import { FIXED_FIELDS } from "./breakpoints.ts";
import { type IdGenerator, idPrefix, withNewIds } from "./ids.ts";
import { instanceLayerOf } from "./instance-layers.ts";
import { acceptsChildren, findPath, idsOf, isContainer, walk } from "./tree.ts";

export class DocumentOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentOpError";
  }
}

type Draft = Record<string, unknown> & {
  children?: Draft[];
  id: string;
  type: string;
  x?: number;
  y?: number;
};

/** Fields an `update` may not touch: they are the tree itself. */
const STRUCTURAL = new Set(["id", "children"]);
const CONTAINER_TYPES = new Set(["group", "row", "column"]);

/**
 * Sets fields of a node from a breakpoint on (ADR 0036), in its `at`; `null` takes the
 * breakpoint's value away, and what is left empty goes with it. Only a row or a column changes
 * its type at a breakpoint, into the other.
 */
const setAt = (node: Draft, name: string, set: Record<string, unknown>) => {
  const at = { ...(node.at as Record<string, Record<string, unknown>>) };
  const over = { ...at[name] };
  for (const [key, value] of Object.entries(set)) {
    if (FIXED_FIELDS.has(key)) {
      fail(`${key} is the same at every breakpoint: set it without "at"`);
    }
    if (
      key === "type" &&
      value !== null &&
      !(
        (node.type === "row" || node.type === "column") &&
        (value === "row" || value === "column")
      )
    ) {
      fail("only a row or a column can become the other at a breakpoint");
    }
    if (value === null) {
      delete over[key];
    } else {
      over[key] = value;
    }
  }
  if (Object.keys(over).length > 0) {
    at[name] = over;
  } else {
    delete at[name];
  }
  if (Object.keys(at).length > 0) {
    node.at = at;
  } else {
    node.at = undefined;
  }
};

/** How far a copy on the canvas lands from its original. */
/** What a layer of an instance may have set: any field, but its structure or its kind. */
const checkLayerFields = (set: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(set)) {
    if (STRUCTURAL.has(key)) {
      fail(
        `${key} of a layer of an instance cannot be set: change its main component`
      );
    }
    if (
      key === "type" &&
      value !== null &&
      !(typeof value === "string" && CONTAINER_TYPES.has(value))
    ) {
      fail("only a group, a row or a column can become another of the three");
    }
  }
};

/** A field set or taken out of `fields`: `null` takes it out. */
const setOrDrop = (
  fields: Record<string, unknown>,
  set: Record<string, unknown>
) => {
  for (const [key, value] of Object.entries(set)) {
    if (value === null) {
      delete fields[key];
    } else {
      fields[key] = value;
    }
  }
};

/**
 * The kind an instance override's draft is set on as, while the override gives the layer no kind
 * of its own: a row, which a breakpoint may turn into a column, as it may a layer of the main.
 */
const DRAFT_KIND = "row";

const DUPLICATE_OFFSET = 40;

interface ApplyOptions {
  /** The document is a canvas: its top-level nodes have a position. */
  readonly canvas: boolean;
  /**
   * The kind of a layer of an instance as the instance draws it (ADR 0114), when the components
   * are known: what its kind may be turned into, as a node's may.
   */
  readonly kindOf?: ((layer: string) => string | undefined) | undefined;
  readonly next: IdGenerator;
}

interface Applied {
  /** Ids of the nodes the operations created: inserted, duplicated, wrapped. */
  readonly created: string[];
  readonly root: DesignNode;
}

/** Documents are JSON: a copy through JSON is a deep copy. */
export const cloneJson = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const fail = (message: string): never => {
  throw new DocumentOpError(message);
};

const pathTo = (root: Draft, id: string): Draft[] =>
  (findPath(root as unknown as DesignNode, id) as unknown as Draft[] | null) ??
  fail(`no node ${id} in this document`);

const slotOf = (node: Draft): Draft[] => {
  if (!acceptsChildren(node as unknown as DesignNode)) {
    return fail(`a ${node.type} cannot hold other nodes`);
  }
  if (!node.children) {
    node.children = [];
  }
  return node.children;
};

/** The fields of a text node that says nothing but its words: what an instance's text becomes. */
const PLAIN_TEXT = new Set(["id", "role", "text", "type"]);

const isPlainText = (node: Draft | undefined): node is Draft =>
  node?.type === "text" &&
  node.role === "paragraph" &&
  Object.keys(node).every((key) => PLAIN_TEXT.has(key));

/**
 * What `arrival` does, undone: an instance left holding a plain text node alone shows those
 * words as its text again. Only on the way out, so a text node put in on purpose stays a node.
 */
const foldText = (parent: Draft) => {
  const [only, ...rest] = parent.children ?? [];
  if (parent.type === "instance" && rest.length === 0 && isPlainText(only)) {
    parent.text = only.text;
    parent.children = undefined;
  }
};

const clampIndex = (index: number | undefined, length: number) =>
  index === undefined || index < 0 || index > length ? length : index;

export const applyOps = (
  root: DesignNode,
  ops: readonly DocOp[],
  options: ApplyOptions
): Applied => {
  const draft = cloneJson(root) as unknown as Draft;
  const created: string[] = [];
  const { canvas, kindOf, next } = options;

  const parentId = (parent: string | null) => parent ?? draft.id;
  /** On the canvas's top level a node has a position; anywhere else it has none. */
  const place = (node: Draft, parent: Draft, at?: { x: number; y: number }) => {
    if (canvas && parent === draft) {
      node.x = Math.round(node.x ?? at?.x ?? 0);
      node.y = Math.round(node.y ?? at?.y ?? 0);
    } else {
      node.x = undefined;
      node.y = undefined;
    }
  };

  /** The node where it is, with the list holding it and its index there. */
  const locate = (id: string) => {
    if (id === draft.id) {
      return fail("the root of a document cannot be moved or removed");
    }
    const path = pathTo(draft, id);
    const parent = path.at(-2) as Draft;
    const siblings = parent.children as Draft[];
    const index = siblings.findIndex((c) => c.id === id);
    return { index, node: siblings[index] as Draft, parent, siblings };
  };

  /**
   * The list a node arriving in `parent` joins, and where in it. An instance that shows text and
   * holds nothing would stop showing the text once it holds a node, so the text becomes its first
   * child, and what arrives goes after it: the index counted children that were not there.
   */
  const arrival = (parent: Draft, index: number | undefined) => {
    const slot = slotOf(parent);
    if (
      parent.type === "instance" &&
      slot.length === 0 &&
      typeof parent.text === "string"
    ) {
      slot.push({
        id: next(idPrefix("text")),
        role: "paragraph",
        text: parent.text,
        type: "text",
      });
      parent.text = undefined;
      return { at: slot.length, slot };
    }
    return { at: clampIndex(index, slot.length), slot };
  };

  /** The inserted tree keeps its ids unless one is already taken in the document. */
  const fresh = (node: DesignNode): Draft => {
    const taken = idsOf(draft as unknown as DesignNode);
    const clash = Array.from(walk(node)).some((n) => taken.has(n.id));
    const inserted = clash ? withNewIds(node, next) : node;
    return cloneJson(inserted) as unknown as Draft;
  };

  const insertOp = (op: Extract<DocOp, { op: "insert" }>) => {
    const [parent] = pathTo(draft, parentId(op.parent)).slice(-1) as [Draft];
    const { at, slot } = arrival(parent, op.index);
    const node = fresh(op.node);
    place(node, parent);
    slot.splice(at, 0, node);
    created.push(node.id);
  };

  const replaceOp = (op: Extract<DocOp, { op: "replace" }>) => {
    // Each node once: an id named twice would be taken out twice.
    const ids = [...new Set(op.ids)];
    const found = ids.map(locate);
    const [first] = found;
    if (!first || found.some((f) => f.parent !== first.parent)) {
      return fail(
        "only nodes side by side in the same parent can be replaced together"
      );
    }
    const { node: was, parent, siblings } = first;
    // Where the first of them was, counting the siblings left before it.
    const at = Math.min(...found.map((f) => f.index));
    for (const id of ids) {
      siblings.splice(
        siblings.findIndex((c) => c.id === id),
        1
      );
    }
    // Taken out first: the node may keep an id of one it replaces.
    const node = fresh(op.node);
    place(node, parent, { x: Number(was.x ?? 0), y: Number(was.y ?? 0) });
    siblings.splice(at, 0, node);
    created.push(node.id);
  };

  const removeOp = (op: Extract<DocOp, { op: "remove" }>) => {
    const { parent, siblings, index } = locate(op.id);
    siblings.splice(index, 1);
    foldText(parent);
  };

  const moveOp = (op: Extract<DocOp, { op: "move" }>) => {
    const { node, parent, siblings, index } = locate(op.id);
    const targetPath = pathTo(draft, parentId(op.parent));
    if (targetPath.some((n) => n.id === op.id)) {
      fail("a node cannot be moved into itself");
    }
    const target = targetPath.at(-1) as Draft;
    const { at, slot } = arrival(target, op.index);
    siblings.splice(index, 1);
    place(node, target);
    slot.splice(at, 0, node);
    if (parent !== target) {
      foldText(parent);
    }
  };

  const updateOp = (op: Extract<DocOp, { op: "update" }>) => {
    const [node] = pathTo(draft, op.id).slice(-1) as [Draft];
    if (op.at !== undefined) {
      setAt(node, op.at, op.set);
      return;
    }
    for (const [key, value] of Object.entries(op.set)) {
      if (STRUCTURAL.has(key)) {
        fail(`${key} cannot be set; move or insert nodes instead`);
      }
      if (
        key === "type" &&
        !(
          CONTAINER_TYPES.has(node.type) &&
          typeof value === "string" &&
          CONTAINER_TYPES.has(value)
        )
      ) {
        fail("only a group, a row or a column can become another of the three");
      }
      if (value === null) {
        delete node[key];
      } else {
        node[key] = value;
      }
    }
  };

  const setPropsOp = (op: Extract<DocOp, { op: "setProps" }>) => {
    const [node] = pathTo(draft, op.id).slice(-1) as [Draft];
    if (node.type !== "instance") {
      fail(`${op.id} is a ${node.type}, not an instance: it has no props`);
    }
    if (op.at !== undefined) {
      const over = (node.at as Record<string, Draft> | undefined)?.[op.at];
      const props = {
        ...(over?.props as Record<string, unknown> | undefined),
      };
      for (const [key, value] of Object.entries(op.props)) {
        if (value === null) {
          delete props[key];
        } else {
          props[key] = value;
        }
      }
      setAt(node, op.at, {
        props: Object.keys(props).length > 0 ? props : null,
      });
      return;
    }
    const props = { ...(node.props as Record<string, unknown> | undefined) };
    for (const [key, value] of Object.entries(op.props)) {
      if (value === null) {
        delete props[key];
      } else {
        props[key] = value;
      }
    }
    if (Object.keys(props).length === 0) {
      node.props = undefined;
    } else {
      node.props = props;
    }
  };

  const wrapOp = (op: Extract<DocOp, { op: "wrap" }>) => {
    // Each node once: an id named twice would be wrapped twice.
    const located = [...new Set(op.ids)].map(locate);
    const [first] = located;
    if (!first) {
      return;
    }
    if (located.some((l) => l.parent !== first.parent)) {
      fail(
        "only nodes side by side in the same parent can be wrapped together"
      );
    }
    const { parent, siblings } = first;
    const ordered = [...located].sort((a, b) => a.index - b.index);
    const at = (ordered[0] as { index: number }).index;
    const position =
      canvas && parent === draft
        ? {
            x: Math.min(...ordered.map((l) => l.node.x ?? 0)),
            y: Math.min(...ordered.map((l) => l.node.y ?? 0)),
          }
        : undefined;
    for (const l of ordered.toReversed()) {
      siblings.splice(siblings.indexOf(l.node), 1);
    }
    const container: Draft = {
      children: ordered.map((l) => l.node),
      id: next(idPrefix(op.type)),
      type: op.type,
    };
    for (const child of container.children as Draft[]) {
      place(child, container);
    }
    place(container, parent, position);
    siblings.splice(at, 0, container);
    created.push(container.id);
  };

  const unwrapOp = (op: Extract<DocOp, { op: "unwrap" }>) => {
    const { node, parent, siblings, index } = locate(op.id);
    if (!CONTAINER_TYPES.has(node.type)) {
      fail(`a ${node.type} has nothing to unwrap`);
    }
    const inner = node.children ?? [];
    inner.forEach((child, i) => {
      place(child, parent, {
        x: (node.x ?? 0) + i * DUPLICATE_OFFSET,
        y: (node.y ?? 0) + i * DUPLICATE_OFFSET,
      });
    });
    siblings.splice(index, 1, ...inner);
  };

  const duplicateOp = (op: Extract<DocOp, { op: "duplicate" }>) => {
    const { node, parent, siblings, index } = locate(op.id);
    const copy = cloneJson(
      withNewIds(node as unknown as DesignNode, next)
    ) as unknown as Draft;
    if (canvas && parent === draft) {
      const width = typeof node.width === "number" ? node.width : 0;
      copy.x = (node.x ?? 0) + width + DUPLICATE_OFFSET;
      copy.y = node.y ?? 0;
    }
    siblings.splice(index + 1, 0, copy);
    created.push(copy.id);
  };

  /**
   * A layer of an instance (ADR 0114) is changed as the instance's instance override of it: `set`
   * laid over it (or its `at`'s breakpoint), `null` giving a field back to the main component, an
   * instance override left empty taken out.
   */
  const overrideOp = (
    id: string,
    set: Record<string, unknown>,
    at: string | undefined
  ) => {
    const { instance, layer } = instanceLayerOf(id) ?? fail(`no layer ${id}`);
    const [node] = pathTo(draft, instance).slice(-1) as [Draft];
    if (node.type !== "instance") {
      fail(`${instance} is a ${node.type}: only an instance has layers`);
    }
    checkLayerFields(set);
    const kind = kindOf?.(id);
    if (
      at === undefined &&
      typeof set.type === "string" &&
      kind !== undefined &&
      !CONTAINER_TYPES.has(kind)
    ) {
      fail(`a ${kind} layer cannot become a ${set.type}`);
    }
    const overrides = {
      ...(node.overrides as
        | Record<string, Record<string, unknown>>
        | undefined),
    };
    // A draft to set fields on as a node's are: the layer's key, and the kind its instance
    // override gives it, or a stand-in that is dropped again.
    const own = overrides[layer];
    const ownKind = typeof own?.type === "string" ? own.type : undefined;
    const over: Draft = {
      ...own,
      id: layer,
      type: ownKind ?? kind ?? DRAFT_KIND,
    };
    if (at === undefined) {
      setOrDrop(over, set);
    } else {
      setAt(over, at, set);
    }
    const { id: _id, type, ...fields } = over;
    const setsKind = at === undefined && typeof set.type === "string";
    if (type !== undefined && (ownKind !== undefined || setsKind)) {
      fields.type = type;
    }
    const kept = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined)
    );
    if (Object.keys(kept).length > 0) {
      overrides[layer] = kept;
    } else {
      delete overrides[layer];
    }
    node.overrides = Object.keys(overrides).length > 0 ? overrides : undefined;
  };

  /** A nested instance's props set for this instance alone, as its instance override's `props`. */
  const setLayerProps = (
    id: string,
    props: Record<string, unknown>,
    at: string | undefined
  ) => {
    const { instance, layer } = instanceLayerOf(id) ?? fail(`no layer ${id}`);
    const [node] = pathTo(draft, instance).slice(-1) as [Draft];
    const over = (
      node.overrides as Record<string, Record<string, unknown>> | undefined
    )?.[layer];
    const held =
      at === undefined
        ? over?.props
        : (over?.at as Record<string, Record<string, unknown>> | undefined)?.[
            at
          ]?.props;
    const merged = { ...(held as Record<string, unknown> | undefined) };
    for (const [key, value] of Object.entries(props)) {
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    overrideOp(
      id,
      { props: Object.keys(merged).length > 0 ? merged : null },
      at
    );
  };

  /**
   * Whether an id names a layer of an instance (ADR 0114): the way to it, and no node of the
   * document's own, which keeps any id it was given.
   */
  const isLayer = (id: string) =>
    instanceLayerOf(id) !== null &&
    findPath(draft as unknown as DesignNode, id) === null;

  /** What only a document's own nodes take: a layer of an instance is the main component's. */
  const ownNodes = (op: DocOp) => {
    const named = [
      ...("id" in op ? [op.id] : []),
      ...("ids" in op ? op.ids : []),
      ...("parent" in op && op.parent !== null ? [op.parent] : []),
    ];
    const layer = named.find(isLayer);
    if (layer !== undefined) {
      fail(
        `${layer} is a layer of an instance: it is moved, wrapped or given nodes in its main component`
      );
    }
  };

  for (const op of ops) {
    if ((op.op === "update" || op.op === "remove") && isLayer(op.id)) {
      overrideOp(
        op.id,
        op.op === "update" ? op.set : { hidden: true },
        op.op === "update" ? op.at : undefined
      );
      continue;
    }
    if (op.op === "setProps" && isLayer(op.id)) {
      setLayerProps(op.id, op.props, op.at);
      continue;
    }
    ownNodes(op);
    switch (op.op) {
      case "insert":
        insertOp(op);
        break;
      case "remove":
        removeOp(op);
        break;
      case "move":
        moveOp(op);
        break;
      case "update":
        updateOp(op);
        break;
      case "setProps":
        setPropsOp(op);
        break;
      case "wrap":
        wrapOp(op);
        break;
      case "unwrap":
        unwrapOp(op);
        break;
      case "duplicate":
        duplicateOp(op);
        break;
      case "replace":
        replaceOp(op);
        break;
      default:
        break;
    }
  }

  if (!isContainer(draft as unknown as DesignNode)) {
    fail("the root of a document must stay a container");
  }
  // Through JSON once more: a field an operation cleared is gone, not `undefined`.
  return { created, root: cloneJson(draft) as unknown as DesignNode };
};

/**
 * The nodes a batch of operations left changed: what it set, moved or made, not what it removed,
 * nor the document's root. What the canvas shows as an agent's work.
 */
export const touchedBy = (
  ops: readonly DocOp[],
  created: readonly string[],
  after: DesignNode
): string[] => {
  const ids = new Set(created);
  const present = idsOf(after);
  for (const op of ops) {
    if (
      op.op === "update" ||
      op.op === "setProps" ||
      op.op === "move" ||
      op.op === "remove"
    ) {
      // A layer of an instance is changed on its instance (ADR 0114).
      const layer = present.has(op.id) ? null : instanceLayerOf(op.id);
      if (layer) {
        ids.add(layer.instance);
      } else if (op.op !== "remove") {
        ids.add(op.id);
      }
    }
  }
  return [...ids].filter((id) => id !== after.id && present.has(id));
};
