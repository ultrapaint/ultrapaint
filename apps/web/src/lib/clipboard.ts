/**
 * Copying and pasting nodes. What is copied is kept here, for the context menu to paste, and
 * written to the system clipboard as marked JSON, so that ⌘V brings it back in another tab too.
 * A copy takes every node selected, and a paste puts them all back, side by side, as one undo
 * step. Ids are the server's to settle: an insert keeps a pasted node's ids unless they are taken.
 */

import type { DesignNode } from "@ultrapaint/contracts/document";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { toast } from "sonner";
import { create } from "zustand";
import { placementAt, placeOfDrop } from "../canvas/drag.ts";
import { placeOnCanvas } from "../state/canvas-grid.ts";
import { nodeIn, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import {
  actedOn,
  deleteNodes,
  insertNodes,
  insertNodesAt,
  nodeContext,
  outermost,
  pageContext,
} from "./node-actions.ts";
import { nodesFromText, textOfNodes } from "./node-text.ts";

export const useClipboard = create<{ nodes: readonly DesignNode[] }>(() => ({
  nodes: [],
}));

/**
 * Keeps the nodes to paste. `write` puts them on the system clipboard too; a copy event does
 * that itself, through its own clipboard data.
 */
const keep = (nodes: readonly DesignNode[], write: boolean) => {
  useClipboard.setState({ nodes });
  if (write) {
    navigator.clipboard?.writeText(textOfNodes(nodes)).catch(() => undefined);
  }
  const [first] = nodes;
  toast(
    nodes.length === 1 && first
      ? `Copied ${nodeLabel(first)}`
      : `Copied ${nodes.length} elements`
  );
};

/**
 * The selections to copy, and their nodes: a page's root is the page, copied by duplicating it
 * instead, and a node inside another copied goes with it.
 */
const copyable = (target?: Selection) => {
  const { docs } = useDocuments.getState();
  const { canvas } = useEditor.getState();
  const targets = outermost(actedOn(target)).flatMap((t) => {
    const node = nodeIn(docs, canvas, t.frame, t.nodeId);
    return node && node.type !== "page" ? [{ node, target: t }] : [];
  });
  return {
    nodes: targets.map((t) => t.node),
    targets: targets.map((t) => t.target),
  };
};

/** Copies the nodes; the ones copied, none when there was nothing to copy. */
export const copyNode = (target?: Selection, write = true) => {
  const { nodes } = copyable(target);
  if (nodes.length > 0) {
    keep(nodes, write);
  }
  return nodes;
};

export const cutNode = (target?: Selection, write = true) => {
  const { nodes, targets } = copyable(target);
  if (nodes.length > 0) {
    keep(nodes, write);
    deleteNodes(targets);
  }
  return nodes;
};

/** Pastes into the node, or after it when it holds nothing: where the Library inserts. */
export const pasteInto = (
  target?: Selection,
  nodes = useClipboard.getState().nodes
) => insertNodes(nodes, nodeContext(target), "Paste");

/** Pastes at the end of a page. */
export const pasteIntoPage = (
  pageId: string,
  nodes = useClipboard.getState().nodes
) => insertNodes(nodes, pageContext(pageId), "Paste");

/**
 * Pastes at a point of the canvas: into what is under it in a page, as a drop there would, or
 * onto the canvas itself, the top left corner of the first node at the point.
 */
export const pasteAt = async (
  at: { x: number; y: number },
  nodes = useClipboard.getState().nodes
) => {
  const drop = nodes.length > 0 ? placementAt(at.x, at.y) : null;
  if (!drop) {
    return;
  }
  // On the canvas it lands on the grid when the grid is on, each a little below and to the right
  // of the one before; in a page, side by side where the page places them.
  const placed = drop.kind === "canvas" ? placeOnCanvas(at) : at;
  await insertNodesAt(placeOfDrop(drop, placed), nodes, "Paste");
};

/** A copy event: the selected nodes go onto the clipboard. True when they were taken. */
export const onCopyEvent = (e: ClipboardEvent, cut: boolean) => {
  const { nodes } = copyable();
  if (!(nodes.length > 0 && e.clipboardData)) {
    return false;
  }
  e.preventDefault();
  e.clipboardData.setData("text/plain", textOfNodes(nodes));
  if (cut) {
    cutNode(undefined, false);
  } else {
    keep(nodes, false);
  }
  return true;
};

/** A paste event: nodes of ours on the clipboard go where the Library would insert. */
export const onPasteEvent = (e: ClipboardEvent) => {
  const nodes = nodesFromText(e.clipboardData?.getData("text/plain") ?? "");
  if (!nodes) {
    return false;
  }
  e.preventDefault();
  useClipboard.setState({ nodes });
  pasteInto(undefined, nodes);
  return true;
};
