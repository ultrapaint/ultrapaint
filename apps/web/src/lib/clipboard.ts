/**
 * Copying and pasting nodes. What is copied is kept here, for the context menu to paste, and
 * written to the system clipboard as marked JSON, so that ⌘V brings it back in another tab too.
 * Ids are the server's to settle: an insert keeps a pasted node's ids unless they are taken.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { toast } from "sonner";
import { create } from "zustand";
import { insertAt, placementAt } from "../canvas/drag.ts";
import type { Selection } from "../state/editor.ts";
import {
  deleteSelection,
  insertNode,
  nodeContext,
  pageContext,
  selected,
} from "./node-actions.ts";
import { nodeFromText, textOfNode } from "./node-text.ts";

export const useClipboard = create<{ node: DesignNode | null }>(() => ({
  node: null,
}));

/**
 * Keeps the node to paste. `write` puts it on the system clipboard too; a copy event does that
 * itself, through its own clipboard data.
 */
const keep = (node: DesignNode, write: boolean) => {
  useClipboard.setState({ node });
  if (write) {
    navigator.clipboard?.writeText(textOfNode(node)).catch(() => undefined);
  }
  toast(`Copied ${nodeLabel(node)}`);
};

/** The node to copy: a page's root is the page, copied by duplicating it instead. */
const copyable = (target?: Selection) => {
  const current = selected(nodeContext(target));
  return current && current.node.type !== "page" ? current.node : null;
};

/** Copies the node; true when there was one to copy. */
export const copyNode = (target?: Selection, write = true) => {
  const node = copyable(target);
  if (node) {
    keep(node, write);
  }
  return node;
};

export const cutNode = (target?: Selection, write = true) => {
  const node = copyNode(target, write);
  if (node) {
    deleteSelection(target);
  }
  return node;
};

/** Pastes into the node, or after it when it holds nothing: where the palette inserts. */
export const pasteInto = (
  target?: Selection,
  node = useClipboard.getState().node
) =>
  node ? insertNode(node, nodeContext(target), "Paste") : Promise.resolve();

/** Pastes at the end of a page. */
export const pasteIntoPage = (
  pageId: string,
  node = useClipboard.getState().node
) =>
  node ? insertNode(node, pageContext(pageId), "Paste") : Promise.resolve();

/**
 * Pastes at a point of the canvas: into what is under it in a page, as a drop there would, or
 * onto the canvas itself, its top left corner at the point.
 */
export const pasteAt = async (
  at: { x: number; y: number },
  node = useClipboard.getState().node
) => {
  if (!node) {
    return;
  }
  const drop = await placementAt(at.x, at.y);
  if (drop) {
    await insertAt(drop, node, at);
  }
};

/** A copy event: the selected node goes onto the clipboard. True when it was taken. */
export const onCopyEvent = (e: ClipboardEvent, cut: boolean) => {
  const node = copyable();
  if (!(node && e.clipboardData)) {
    return false;
  }
  e.preventDefault();
  e.clipboardData.setData("text/plain", textOfNode(node));
  if (cut) {
    cutNode(undefined, false);
  } else {
    keep(node, false);
  }
  return true;
};

/** A paste event: a node of ours on the clipboard goes where the palette would insert. */
export const onPasteEvent = (e: ClipboardEvent) => {
  const node = nodeFromText(e.clipboardData?.getData("text/plain") ?? "");
  if (!node) {
    return false;
  }
  e.preventDefault();
  useClipboard.setState({ node });
  pasteInto(undefined, node);
  return true;
};
