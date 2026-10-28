/**
 * Copying and pasting nodes. What is copied is kept here, for the context menu to paste, and
 * written to the system clipboard as marked JSON, so that ⌘V brings it back in another tab too.
 * A copy takes every node selected, and a paste puts them all back, side by side, as one undo
 * step. Ids are the server's to settle: an insert keeps a pasted node's ids unless they are taken.
 */

import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import { canvasDocOf, nodeLabel } from "@ultrapaint/design-document/tree";
import { toast } from "sonner";
import { create } from "zustand";
import { type Drop, insertAt, placementAt } from "../canvas/drag.ts";
import { placeOnCanvas } from "../state/canvas-grid.ts";
import {
  applyEdits,
  docOfFrame,
  frameOfCanvasNode,
  isNodeFrame,
  nodeIn,
  useDocuments,
} from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { insertedAt } from "./breakpoint-edits.ts";
import {
  actedOn,
  deleteNodes,
  insertNodes,
  nodeContext,
  outermost,
  pageContext,
} from "./node-actions.ts";
import { nodesFromText, textOfNodes } from "./node-text.ts";

export const useClipboard = create<{ nodes: readonly DesignNode[] }>(() => ({
  nodes: [],
}));

/** How far each node pasted onto the canvas after the first lands from the one before. */
const CASCADE = 24;

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

/** Pastes into the node, or after it when it holds nothing: where the Assets panel inserts. */
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
 * Several nodes where a drop says: side by side in a container, or on the canvas each a little
 * below and to the right of the one before. Selected as they land, as many as one frame shows.
 */
const insertAllAt = async (
  drop: Drop,
  nodes: readonly DesignNode[],
  at: { x: number; y: number }
) => {
  const { canvas } = useEditor.getState();
  if (canvas === null) {
    return;
  }
  const doc =
    drop.kind === "into" ? docOfFrame(drop.frame, canvas) : canvasDocOf(canvas);
  const ops = nodes.map((node, i): DocOp => {
    if (drop.kind === "canvas") {
      const placed = {
        x: Math.round(at.x + i * CASCADE),
        y: Math.round(at.y + i * CASCADE),
      };
      return { node: { ...node, ...placed }, op: "insert", parent: null };
    }
    const { x: _x, y: _y, ...unplaced } = node;
    return {
      index: drop.index + i,
      node: insertedAt(unplaced as DesignNode, drop.frame),
      op: "insert",
      parent: drop.parent,
    };
  });
  const result = await applyEdits([{ doc, ops }], "Paste");
  if (!result) {
    return;
  }
  const { docs } = useDocuments.getState();
  const inPage = drop.kind === "into" && !isNodeFrame(drop.frame);
  useEditor.getState().selectMany(
    result.created.flatMap((id) => {
      const frame = inPage ? drop.frame : frameOfCanvasNode(docs, canvas, id);
      return frame ? [{ frame, nodeId: id }] : [];
    })
  );
};

/**
 * Pastes at a point of the canvas: into what is under it in a page, as a drop there would, or
 * onto the canvas itself, the top left corner of the first node at the point.
 */
export const pasteAt = async (
  at: { x: number; y: number },
  nodes = useClipboard.getState().nodes
) => {
  const [first] = nodes;
  if (!first) {
    return;
  }
  const drop = placementAt(at.x, at.y);
  if (!drop) {
    return;
  }
  // On the canvas it lands on the grid when the grid is on; in a page, the page places it.
  const placed = drop.kind === "canvas" ? placeOnCanvas(at) : at;
  await (nodes.length === 1
    ? insertAt(drop, first, placed)
    : insertAllAt(drop, nodes, placed));
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

/** A paste event: nodes of ours on the clipboard go where the Assets panel would insert. */
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
