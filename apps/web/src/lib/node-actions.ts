/**
 * Every edit the editor makes to nodes, from the keyboard, the layers panel, the inspector, the
 * Assets panel, the context menu, the clipboard and the canvas's drags alike: nothing else sends
 * the documents operations. Each is one request to the server and one undo step, however many
 * nodes it changes. An action takes the node it is for, and the rest of the selection with it when
 * the node is selected; the selection when it is not given one. Renaming, selecting a parent and
 * arranging are about one node: the one the inspector shows.
 *
 * A caller says which frame an edit is made in, and this module says where it lands (ADR 0036): a
 * field at the breakpoint of the view, a node inserted in a view above the base hidden below it.
 * Moving, wrapping and removing change the one tree every view draws. What an edit makes or moves
 * is selected afterwards, in the frame that shows it.
 */

import type { JsonValue } from "@ultrapaint/contracts/base";
import type {
  DesignNode,
  DocOp,
  DocumentEdit,
} from "@ultrapaint/contracts/document";
import {
  type Visibility,
  withVisibility,
} from "@ultrapaint/design-document/breakpoints";
import {
  canvasDocOf,
  childrenOf,
  isContainer,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import { promptDialog } from "../components/dialogs.tsx";
import { holdsChildren } from "../state/catalogue.ts";
import {
  applyEdits,
  canvasNodes,
  docOfFrame,
  frameOfCanvasNode,
  isNodeFrame,
  nodeIn,
  pathIn,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { requestInlineRename } from "../state/layer-rename.ts";
import {
  asDrawnIn,
  editedFrameOf,
  insertedAt,
  propsOpsAt,
  updateOpsAt,
} from "./breakpoint-edits.ts";
import { isPageRoot } from "./menu-model.ts";

interface Context {
  readonly activePage: string | null;
  readonly canvas: string | null;
  readonly docs: ReturnType<typeof useDocuments.getState>["docs"];
  readonly selectedPage: string | null;
  readonly selection: ReturnType<typeof useEditor.getState>["selection"];
}

const liveContext = (): Context => ({
  ...useEditor.getState(),
  docs: useDocuments.getState().docs,
});

/** The editor as it is, with `target` standing in for the selection when there is one. */
export const nodeContext = (target?: Selection): Context => {
  const ctx = liveContext();
  return target ? { ...ctx, selectedPage: null, selection: target } : ctx;
};

/** The editor as it is, with a page selected as a whole. */
export const pageContext = (pageId: string): Context => ({
  ...liveContext(),
  selectedPage: pageId,
  selection: null,
});

/** The selected node, its frame and its document, or null when nothing is selected. */
export const selected = (ctx: Context = liveContext()) => {
  const { docs, selection, selectedPage, canvas } = ctx;
  if (selection) {
    const node = nodeIn(docs, canvas, selection.frame, selection.nodeId);
    return node
      ? {
          doc: docOfFrame(selection.frame, canvas),
          frame: selection.frame,
          node,
        }
      : null;
  }
  if (selectedPage) {
    const node = rootOfFrame(docs, canvas, selectedPage);
    return node ? { doc: selectedPage, frame: selectedPage, node } : null;
  }
  return null;
};

/**
 * The nodes an action on `target` is for: the whole selection when the target is one of it, the
 * target alone when it is not. Without a target, every node selected, or the root of the page
 * selected as a whole.
 */
export const actedOn = (target?: Selection): Selection[] => {
  const all = allSelected();
  if (target) {
    const among = all.some(
      (s) => s.frame === target.frame && s.nodeId === target.nodeId
    );
    return among ? all : [target];
  }
  if (all.length > 0) {
    return all;
  }
  const page = selected();
  return page ? [{ frame: page.frame, nodeId: page.node.id }] : [];
};

/** Sets fields of the selected nodes, or of `target`'s; `null` removes one. */
export const updateSelection = (
  set: Record<string, JsonValue>,
  label = "Change",
  target?: Selection
) => updateNodes(actedOn(target), set, label);

/** Sets fields of each selected node, worked out from the node itself. */
export const updateSelectionWith = (
  setOf: (node: DesignNode) => Record<string, JsonValue>,
  label = "Change",
  target?: Selection
) => updateNodesWith(actedOn(target), setOf, label);

export const setPropsOfSelection = (props: Record<string, JsonValue>) =>
  setPropsOfNodes(actedOn(), props);

export const setHidden = (hidden: boolean, target?: Selection) =>
  updateSelection(
    { hidden: hidden ? true : null },
    hidden ? "Hide" : "Show",
    target
  );

/** Locks the node on the canvas, or lets it go again: the layers panel still selects it. */
export const setLocked = (locked: boolean, target?: Selection) =>
  updateSelection(
    { locked: locked ? true : null },
    locked ? "Lock" : "Unlock",
    target
  );

export const deleteSelection = (target?: Selection) =>
  deleteNodes(actedOn(target));

export const duplicateSelection = (target?: Selection) =>
  duplicateNodes(actedOn(target));

/** Puts the selected nodes in a new row, column or group, where the first of them was. */
export const wrapSelection = (
  type: "row" | "column" | "group",
  target?: Selection
) => wrapNodes(actedOn(target), type);

export const unwrapSelection = (target?: Selection) =>
  unwrapNodes(actedOn(target));

/**
 * Selects the nodes an edit made or moved, in the frame that now shows them: the frame given in a
 * page, each one's own on the canvas; as many of them as one frame shows.
 */
const selectLanded = (
  doc: string,
  frame: string | null,
  ids: readonly string[]
) => {
  const { canvas } = useEditor.getState();
  const { docs } = useDocuments.getState();
  if (ids.length === 0) {
    return;
  }
  const loose = canvas !== null && doc === canvasDocOf(canvas);
  useEditor.getState().selectMany(
    ids.flatMap((id) => {
      const shown = loose ? frameOfCanvasNode(docs, canvas, id) : frame;
      return shown ? [{ frame: shown, nodeId: id }] : [];
    })
  );
};

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Where nodes go: into a container of a frame, at an index among its children (at the end
 * without one), or onto the canvas, at a point (where they are without one) and an index among
 * its nodes. The frame is the one the edit is made in: a view's says where an insert lands.
 */
export type Place =
  | {
      readonly frame: string;
      readonly index?: number;
      readonly kind: "into";
      readonly parent: string;
    }
  | { readonly at?: Point; readonly index?: number; readonly kind: "canvas" };

const docOfPlace = (place: Place, canvas: string) =>
  place.kind === "into" ? docOfFrame(place.frame, canvas) : canvasDocOf(canvas);

/** How far each node put onto the canvas after the first lands from the one before. */
const CASCADE = 24;

/**
 * A node as it goes to a place, the `i`th of those put there together: in a page without the
 * position it had on the canvas; on the canvas at the point, each a little below and to the right
 * of the one before.
 */
const placedAt = (node: DesignNode, place: Place, i: number): DesignNode => {
  if (place.kind === "into") {
    const { x: _x, y: _y, ...unplaced } = node;
    return unplaced as DesignNode;
  }
  return place.at
    ? {
        ...node,
        x: Math.round(place.at.x + i * CASCADE),
        y: Math.round(place.at.y + i * CASCADE),
      }
    : node;
};

/**
 * Inserts nodes at a place, side by side, and selects them: something new, pasted or copied.
 * Resolves to the ids the server gave them, none when nothing was inserted.
 */
export const insertNodesAt = async (
  place: Place,
  nodes: readonly DesignNode[],
  label = "Insert"
): Promise<readonly string[]> => {
  const { canvas } = useEditor.getState();
  if (canvas === null || nodes.length === 0) {
    return [];
  }
  const doc = docOfPlace(place, canvas);
  const ops = nodes.map(
    (node, i): DocOp => ({
      ...(place.index !== undefined && { index: place.index + i }),
      // In a view above the base, it shows from the view's breakpoint up (ADR 0036).
      node:
        place.kind === "into"
          ? insertedAt(placedAt(node, place, i), place.frame)
          : placedAt(node, place, i),
      op: "insert",
      parent: place.kind === "into" ? place.parent : null,
    })
  );
  const result = await applyEdits([{ doc, ops }], label);
  const created = result?.created ?? [];
  selectLanded(doc, place.kind === "into" ? place.frame : null, created);
  return created;
};

/**
 * Moves a node to a place, in its document or out of it into another, and selects it there. A
 * node on the canvas moved to a point of it, and no other place among its nodes, only changes
 * where it is, and stays selected as it was.
 */
export const moveNode = async (target: Selection, place: Place) => {
  const { canvas } = useEditor.getState();
  const [found] = nodesOf([target]);
  if (canvas === null || !found) {
    return;
  }
  const { doc: source, node } = found;
  const { id } = node;
  const doc = docOfPlace(place, canvas);
  const at = place.kind === "canvas" ? place.at : undefined;
  const loose = canvasNodes(useDocuments.getState().docs, canvas).some(
    (n) => n.id === id
  );
  if (loose && place.kind === "canvas" && place.index === undefined) {
    if (at) {
      await applyEdits(
        [{ doc, ops: [{ id, op: "update", set: { x: at.x, y: at.y } }] }],
        "Move on the canvas"
      );
    }
    return;
  }
  const parent = place.kind === "into" ? place.parent : null;
  const index = place.index === undefined ? undefined : { index: place.index };
  const moved: DocumentEdit[] =
    source === doc
      ? [
          {
            doc,
            ops: [
              { id, ...index, op: "move", parent },
              ...(at
                ? [{ id, op: "update" as const, set: { x: at.x, y: at.y } }]
                : []),
            ],
          },
        ]
      : [
          { doc: source, ops: [{ id, op: "remove" }] },
          {
            doc,
            ops: [
              {
                ...index,
                node: placedAt(node, place, 0),
                op: "insert",
                parent,
              },
            ],
          },
        ];
  const label =
    source !== doc && place.kind === "canvas" ? "Move onto the canvas" : "Move";
  const result = await applyEdits(moved, label);
  if (result) {
    selectLanded(doc, place.kind === "into" ? place.frame : null, [
      result.created[0] ?? id,
    ]);
  }
};

/**
 * Where a node inserted from the Assets panel goes: into the selected container, or component that
 * takes children, at its end; next to the selected node otherwise; and at the end of the page on
 * screen when nothing is selected.
 */
export const insertTarget = (
  ctx: Context = liveContext()
): {
  doc: string;
  frame: string;
  index?: number;
  parent: string;
  name: string;
} | null => {
  const { activePage, docs, canvas } = ctx;
  const node = selected(ctx);
  if (node) {
    if (holdsChildren(node.node)) {
      return {
        doc: node.doc,
        frame: node.frame,
        name:
          node.node.name ??
          (node.node.type === "instance"
            ? node.node.component
            : node.node.type),
        parent: node.node.id,
      };
    }
    const path = pathIn(docs, canvas, node.frame, node.node.id);
    const parent = path?.at(-2);
    if (parent) {
      const siblings = "children" in parent ? (parent.children ?? []) : [];
      return {
        doc: node.doc,
        frame: node.frame,
        index: siblings.findIndex((c) => c.id === node.node.id) + 1,
        name: parent.name ?? parent.type,
        parent: parent.id,
      };
    }
  }
  const page = activePage ? docs[activePage]?.root : null;
  return activePage && page
    ? { doc: activePage, frame: activePage, name: "the page", parent: page.id }
    : null;
};

/**
 * Inserts nodes where `insertTarget` says, one after the other, and selects them. In a page they
 * are laid out with the others: where they stood on the canvas, if they were there, no longer
 * means anything.
 */
export const insertNodes = (
  nodes: readonly DesignNode[],
  ctx: Context = liveContext(),
  label = "Insert"
) => {
  const target = insertTarget(ctx);
  if (!target) {
    return [];
  }
  const { frame, index, parent } = target;
  return insertNodesAt(
    { frame, kind: "into", parent, ...(index !== undefined && { index }) },
    nodes,
    label
  );
};

/** Inserts a node where `insertTarget` says, and selects it. */
export const insertNode = (
  node: DesignNode,
  ctx: Context = liveContext(),
  label = "Insert"
) => insertNodes([node], ctx, label);

/**
 * Where a node sits: the node it is inside (null for the top of the canvas) and its siblings,
 * itself among them.
 */
export const placeOf = (ctx: Context = liveContext()) => {
  const current = selected(ctx);
  if (!current) {
    return null;
  }
  const { docs, canvas } = ctx;
  const path = pathIn(docs, canvas, current.frame, current.node.id);
  const parent = path?.at(-2) ?? null;
  if (parent) {
    return { current, parent, siblings: childrenOf(parent) };
  }
  // A node on the canvas is the root of its own frame; its siblings are the canvas's.
  if (isNodeFrame(current.frame)) {
    return { current, parent: null, siblings: canvasNodes(docs, canvas) };
  }
  return null;
};

export type Arrangement = "up" | "down" | "top" | "bottom";

/** Moves the node among its siblings, in the order the layers list them. */
export const arrangeNode = async (to: Arrangement, target?: Selection) => {
  const place = placeOf(nodeContext(target));
  if (!place || isPageRoot(place.current.node)) {
    return;
  }
  const { current, parent, siblings } = place;
  const at = siblings.findIndex((c) => c.id === current.node.id);
  // Indices leave the moved node out, so the last place is one less than the count.
  const last = siblings.length - 1;
  const index = {
    bottom: last,
    down: Math.min(at + 1, last),
    top: 0,
    up: Math.max(at - 1, 0),
  }[to];
  if (index === at) {
    return;
  }
  await applyToEach(
    [{ frame: current.frame, nodeId: current.node.id }],
    (node) => [{ id: node.id, index, op: "move", parent: parent?.id ?? null }],
    "Arrange"
  );
};

/** Selects what the node is inside, short of the page itself. */
export const selectParent = (target?: Selection) => {
  const place = placeOf(nodeContext(target));
  if (place?.parent && place.parent.type !== "page") {
    useEditor
      .getState()
      .select({ frame: place.current.frame, nodeId: place.parent.id });
  }
};

/**
 * Gives the node a name, which is what the layers call it. A name left empty, or the one the
 * node already goes by, changes nothing.
 */
export const renameNodeTo = async (name: string, target?: Selection) => {
  const current = selected(nodeContext(target));
  const trimmed = name.trim();
  if (
    !current ||
    isPageRoot(current.node) ||
    trimmed === "" ||
    trimmed === nodeLabel(current.node)
  ) {
    return;
  }
  await updateNodes(
    [{ frame: current.frame, nodeId: current.node.id }],
    { name: trimmed },
    "Rename"
  );
};

/**
 * Names the node: in its row of the layers panel when the panel is open, the way Figma does, and
 * in a dialog when it is not.
 */
export const renameNode = async (target?: Selection) => {
  const current = selected(nodeContext(target));
  if (!current || isPageRoot(current.node)) {
    return;
  }
  const at = { frame: current.frame, nodeId: current.node.id };
  const editor = useEditor.getState();
  if (
    editor.selection?.frame !== at.frame ||
    editor.selection.nodeId !== at.nodeId
  ) {
    editor.select(at);
  }
  if (requestInlineRename(at)) {
    return;
  }
  const name = await promptDialog({
    confirmLabel: "Rename",
    defaultValue: current.node.name ?? nodeLabel(current.node),
    title: "Rename element",
  });
  if (name !== null) {
    await renameNodeTo(name, at);
  }
};

// ---- Several nodes at once ----

/** Every node selected: the one the inspector shows first, then the others, in one frame. */
export const allSelected = (): Selection[] => {
  const { also, selection } = useEditor.getState();
  return selection ? [selection, ...also] : [];
};

/** The nodes of these selections that still exist, with their document. */
export const nodesOf = (targets: readonly Selection[]) => {
  const { docs } = useDocuments.getState();
  const { canvas } = useEditor.getState();
  return targets.flatMap((t) => {
    const node = nodeIn(docs, canvas, t.frame, t.nodeId);
    return node
      ? [{ doc: docOfFrame(t.frame, canvas), frame: t.frame, node }]
      : [];
  });
};

/**
 * The same operations for each node, one undo step for all of them. A field lands at the
 * breakpoint of the view it is edited in (ADR 0036), and what an edit works out from the node
 * (the rest of its border) is the node as drawn there; `asStored` is for the edits that name
 * their breakpoints themselves, which are worked out from the node as it is stored and sent as
 * they are.
 */
const applyToEach = (
  targets: readonly Selection[],
  opsOf: (node: DesignNode) => DocOp[],
  label: string,
  asStored = false
) => {
  const byDoc = new Map<string, DocOp[]>();
  const { selection } = useEditor.getState();
  for (const { doc, frame: named, node } of nodesOf(targets)) {
    if (asStored) {
      byDoc.set(doc, [...(byDoc.get(doc) ?? []), ...opsOf(node)]);
      continue;
    }
    const frame = editedFrameOf(selection, named);
    const ops = opsOf(asDrawnIn(node, frame)).flatMap((op): DocOp[] => {
      if (op.op === "update" && op.at === undefined) {
        return updateOpsAt(node, frame, op.set);
      }
      if (op.op === "setProps" && op.at === undefined) {
        return propsOpsAt(node, frame, op.props);
      }
      return [op];
    });
    byDoc.set(doc, [...(byDoc.get(doc) ?? []), ...ops]);
  }
  const edits = [...byDoc].flatMap(([doc, ops]) =>
    ops.length > 0 ? [{ doc, ops }] : []
  );
  return edits.length > 0 ? applyEdits(edits, label) : Promise.resolve(null);
};

/**
 * These selections less those inside another of them: what goes with its container is not
 * removed, copied or duplicated a second time.
 */
export const outermost = (targets: readonly Selection[]): Selection[] => {
  const { docs } = useDocuments.getState();
  const { canvas } = useEditor.getState();
  const ids = new Set(targets.map((t) => t.nodeId));
  return targets.filter((t) => {
    const path = pathIn(docs, canvas, t.frame, t.nodeId) ?? [];
    return !path.slice(0, -1).some((n) => ids.has(n.id));
  });
};

/** Sets fields of every one of these nodes; `null` removes one. */
export const updateNodes = (
  targets: readonly Selection[],
  set: Record<string, JsonValue>,
  label = "Change"
) =>
  applyToEach(targets, (node) => [{ id: node.id, op: "update", set }], label);

/**
 * Sets fields of each of these nodes, worked out from the node itself. A node given nothing to
 * set is left alone.
 */
export const updateNodesWith = (
  targets: readonly Selection[],
  setOf: (node: DesignNode) => Record<string, JsonValue>,
  label = "Change"
) =>
  applyToEach(
    targets,
    (node) => {
      const set = setOf(node);
      return Object.keys(set).length > 0
        ? [{ id: node.id, op: "update", set }]
        : [];
    },
    label
  );

/** Sets props of every instance among these nodes. */
export const setPropsOfNodes = (
  targets: readonly Selection[],
  props: Record<string, JsonValue>
) =>
  applyToEach(
    targets,
    (node) =>
      node.type === "instance" ? [{ id: node.id, op: "setProps", props }] : [],
    "Change a prop"
  );

/** How an undo step that acts on several nodes is named. */
const labelFor = (verb: string, count: number) =>
  count > 1 ? `${verb} ${count} elements` : verb;

export const deleteNodes = async (targets: readonly Selection[]) => {
  const gone = outermost(targets);
  const result = await applyToEach(
    gone,
    (node) => (isPageRoot(node) ? [] : [{ id: node.id, op: "remove" }]),
    labelFor("Delete", gone.length)
  );
  if (result) {
    useEditor.getState().select(null);
  }
};

/** Copies of these nodes, each beside its original, selected in their place. */
const duplicateNodes = async (targets: readonly Selection[]) => {
  const copied = outermost(targets);
  const [first] = nodesOf(copied);
  const result = await applyToEach(
    copied,
    (node) => (isPageRoot(node) ? [] : [{ id: node.id, op: "duplicate" }]),
    labelFor("Duplicate", copied.length)
  );
  if (first && result) {
    selectLanded(first.doc, first.frame, result.created);
  }
};

/** Takes the children of every container among these nodes out of it, where it was. */
const unwrapNodes = async (targets: readonly Selection[]) => {
  const result = await applyToEach(
    targets,
    (node) =>
      isContainer(node) && !isPageRoot(node)
        ? [{ id: node.id, op: "unwrap" }]
        : [],
    "Unwrap"
  );
  if (result) {
    useEditor.getState().select(null);
  }
};

/** Whether these nodes are siblings, as wrapping them together needs. */
export const areSiblings = (targets: readonly Selection[]) => {
  const { docs } = useDocuments.getState();
  const { canvas } = useEditor.getState();
  const parents = new Set(
    targets.map((t) => pathIn(docs, canvas, t.frame, t.nodeId)?.at(-2)?.id)
  );
  const [parent] = parents;
  return parents.size === 1 && parent !== undefined && targets.length > 0;
};

/** Puts sibling nodes into a new row, column or group, where the first of them was. */
export const wrapNodes = async (
  targets: readonly Selection[],
  type: "row" | "column" | "group"
) => {
  const found = nodesOf(targets).filter((f) => !isPageRoot(f.node));
  const [first] = found;
  if (!first || found.some((f) => f.doc !== first.doc)) {
    return;
  }
  const result = await applyEdits(
    [
      {
        doc: first.doc,
        ops: [{ ids: found.map((f) => f.node.id), op: "wrap", type }],
      },
    ],
    `Wrap in a ${type}`
  );
  if (result) {
    selectLanded(first.doc, first.frame, result.created.slice(0, 1));
  }
};

// ---- At a breakpoint named ----

/**
 * Takes away what a node sets for a field at a breakpoint (`props.<name>` for a prop): it shows
 * what it inherits there again, whichever view it is done from.
 */
export const resetAt = (target: Selection, at: string, field: string) =>
  applyToEach(
    [target],
    (node): DocOp[] => [
      field.startsWith("props.")
        ? {
            at,
            id: node.id,
            op: "setProps",
            props: { [field.slice("props.".length)]: null },
          }
        : { at, id: node.id, op: "update", set: { [field]: null } },
    ],
    `Reset ${field} at ${at}`,
    true
  );

/**
 * Shows a node by one rule, whichever view it is chosen in: its own `hidden` and each
 * breakpoint's are written together.
 */
export const showBy = (
  target: Selection,
  rule: Exclude<Visibility, { kind: "custom" }>,
  label: string
) =>
  applyToEach(
    [target],
    (node) => [
      {
        id: node.id,
        op: "update",
        // Plain JSON: the document's own fields, rewritten.
        set: withVisibility(node, rule) as unknown as Record<string, JsonValue>,
      },
    ],
    label,
    true
  );
