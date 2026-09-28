/**
 * What the editor does to the selected node, from the keyboard, the layers panel, the inspector,
 * the palette and the context menu alike. Each is one request to the server and one undo step.
 * An action takes the node it is for, or the selection when it is not given one.
 */

import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import {
  canvasDocOf,
  childrenOf,
  isContainer,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import { promptDialog } from "../components/dialogs.tsx";
import { holdsChildren } from "../state/catalogue.ts";
import {
  applyOps,
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

interface Context {
  readonly activePage: string | null;
  readonly docs: ReturnType<typeof useDocuments.getState>["docs"];
  readonly selectedPage: string | null;
  readonly selection: ReturnType<typeof useEditor.getState>["selection"];
  readonly space: string | null;
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
  const { docs, selection, selectedPage, space } = ctx;
  if (selection) {
    const node = nodeIn(docs, space, selection.frame, selection.nodeId);
    return node
      ? {
          doc: docOfFrame(selection.frame, space),
          frame: selection.frame,
          node,
        }
      : null;
  }
  if (selectedPage) {
    const node = rootOfFrame(docs, space, selectedPage);
    return node ? { doc: selectedPage, frame: selectedPage, node } : null;
  }
  return null;
};

/** Sets fields of the selected node; `null` removes one. */
export const updateSelection = (
  set: Record<string, JsonValue>,
  label = "Change",
  target?: Selection
) => {
  const current = selected(nodeContext(target));
  if (!current) {
    return Promise.resolve(null);
  }
  return applyOps(
    current.doc,
    [{ id: current.node.id, op: "update", set }],
    label
  );
};

export const setPropsOfSelection = (props: Record<string, JsonValue>) => {
  const current = selected();
  if (current?.node.type !== "instance") {
    return Promise.resolve(null);
  }
  return applyOps(
    current.doc,
    [{ id: current.node.id, op: "setProps", props }],
    "Change a prop"
  );
};

export const setHidden = (hidden: boolean, target?: Selection) =>
  updateSelection(
    { hidden: hidden ? true : null },
    hidden ? "Hide" : "Show",
    target
  );

/** The root of a page cannot be deleted or duplicated: the page can. */
const isPageRoot = (node: DesignNode) => node.type === "page";

export const deleteSelection = async (target?: Selection) => {
  const current = selected(nodeContext(target));
  if (!current || isPageRoot(current.node)) {
    return;
  }
  const result = await applyOps(
    current.doc,
    [{ id: current.node.id, op: "remove" }],
    "Delete"
  );
  if (result) {
    useEditor.getState().select(null);
  }
};

export const duplicateSelection = async (target?: Selection) => {
  const current = selected(nodeContext(target));
  if (!current || isPageRoot(current.node)) {
    return;
  }
  const result = await applyOps(
    current.doc,
    [{ id: current.node.id, op: "duplicate" }],
    "Duplicate"
  );
  const id = result?.created[0];
  if (id) {
    selectCreated(current.doc, current.frame, id);
  }
};

/** Puts the selected node in a new row, column or group, where it was. */
export const wrapSelection = async (
  type: "row" | "column" | "group",
  target?: Selection
) => {
  const current = selected(nodeContext(target));
  if (!current || isPageRoot(current.node)) {
    return;
  }
  const result = await applyOps(
    current.doc,
    [{ ids: [current.node.id], op: "wrap", type }],
    `Wrap in a ${type}`
  );
  const id = result?.created[0];
  if (id) {
    selectCreated(current.doc, current.frame, id);
  }
};

export const unwrapSelection = async (target?: Selection) => {
  const current = selected(nodeContext(target));
  if (!(current && isContainer(current.node)) || isPageRoot(current.node)) {
    return;
  }
  await applyOps(
    current.doc,
    [{ id: current.node.id, op: "unwrap" }],
    "Unwrap"
  );
  useEditor.getState().select(null);
};

/** Selects a node the server just made, in whichever frame now shows it. */
export const selectCreated = (doc: string, frame: string, id: string) => {
  const { space } = useEditor.getState();
  const target =
    space !== null && doc === canvasDocOf(space)
      ? frameOfCanvasNode(useDocuments.getState().docs, space, id)
      : frame;
  if (target) {
    useEditor.getState().select({ frame: target, nodeId: id });
  }
};

/**
 * Where a node inserted from the palette goes: into the selected container, or component that
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
  const { activePage, docs, space } = ctx;
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
    const path = pathIn(docs, space, node.frame, node.node.id);
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
 * Inserts a node where `insertTarget` says, and selects it. In a page it is laid out with the
 * others: where it stood on the canvas, if it was there, no longer means anything.
 */
export const insertNode = async (
  node: DesignNode,
  ctx: Context = liveContext(),
  label = "Insert"
) => {
  const target = insertTarget(ctx);
  if (!target) {
    return;
  }
  const { x: _x, y: _y, ...unplaced } = node;
  const op: DocOp = {
    ...(target.index !== undefined && { index: target.index }),
    node: unplaced as DesignNode,
    op: "insert",
    parent: target.parent,
  };
  const result = await applyOps(target.doc, [op], label);
  const id = result?.created[0];
  if (id) {
    selectCreated(target.doc, target.frame, id);
  }
};

/**
 * Where a node sits: the node it is inside (null for the top of the canvas) and its siblings,
 * itself among them.
 */
export const placeOf = (ctx: Context = liveContext()) => {
  const current = selected(ctx);
  if (!current) {
    return null;
  }
  const { docs, space } = ctx;
  const path = pathIn(docs, space, current.frame, current.node.id);
  const parent = path?.at(-2) ?? null;
  if (parent) {
    return { current, parent, siblings: childrenOf(parent) };
  }
  // A node on the canvas is the root of its own frame; its siblings are the canvas's.
  if (isNodeFrame(current.frame)) {
    return { current, parent: null, siblings: canvasNodes(docs, space) };
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
  await applyOps(
    current.doc,
    [{ id: current.node.id, index, op: "move", parent: parent?.id ?? null }],
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

/** Names the node, which is what the layers call it. */
export const renameNode = async (target?: Selection) => {
  const current = selected(nodeContext(target));
  if (!current || isPageRoot(current.node)) {
    return;
  }
  const name = (
    await promptDialog({
      confirmLabel: "Rename",
      defaultValue: current.node.name ?? nodeLabel(current.node),
      title: "Rename layer",
    })
  )?.trim();
  if (!name || name === current.node.name) {
    return;
  }
  await applyOps(
    current.doc,
    [{ id: current.node.id, op: "update", set: { name } }],
    "Rename"
  );
};
