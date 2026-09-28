/**
 * What the editor does to the selected node, from the keyboard, the layers panel, the inspector
 * and the palette alike. Each is one request to the server and one undo step.
 */

import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import { canvasDocOf, isContainer } from "@ultrapaint/design-document/tree";
import { holdsChildren } from "../state/catalogue.ts";
import {
  applyOps,
  docOfFrame,
  frameOfCanvasNode,
  nodeIn,
  pathIn,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";

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
  label = "Change"
) => {
  const current = selected();
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

export const setHidden = (hidden: boolean) =>
  updateSelection({ hidden: hidden ? true : null }, hidden ? "Hide" : "Show");

/** The root of a page cannot be deleted or duplicated: the page can. */
const isPageRoot = (node: DesignNode) => node.type === "page";

export const deleteSelection = async () => {
  const current = selected();
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

export const duplicateSelection = async () => {
  const current = selected();
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
export const wrapSelection = async (type: "row" | "column" | "group") => {
  const current = selected();
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

export const unwrapSelection = async () => {
  const current = selected();
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
const selectCreated = (doc: string, frame: string, id: string) => {
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

/** Inserts a node where `insertTarget` says, and selects it. */
export const insertNode = async (node: DesignNode) => {
  const target = insertTarget();
  if (!target) {
    return;
  }
  const op: DocOp = {
    ...(target.index !== undefined && { index: target.index }),
    node,
    op: "insert",
    parent: target.parent,
  };
  const result = await applyOps(target.doc, [op], "Insert");
  const id = result?.created[0];
  if (id) {
    selectCreated(target.doc, target.frame, id);
  }
};
