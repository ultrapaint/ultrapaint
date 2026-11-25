/**
 * Copying an element's style and pasting it onto others: its style fields (design-document's
 * `style-fields`), taken as the view it is copied in draws it and written where an inspector edit
 * in the view it is pasted in would land (ADR 0036), on a layer of an instance as the instance's
 * overrides (ADR 0114), all the nodes in one undo step. The style copied is kept for the editor's
 * session alone: never on the system clipboard, and apart from the nodes Copy keeps
 * (`clipboard.ts`). A page's root is the page, whose look is never copied or pasted (ADR 0075).
 */

import {
  type CopiedStyle,
  styleFor,
  styleOf,
} from "@ultrapaint/design-document/style-fields";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { toast } from "sonner";
import { create } from "zustand";
import { nodeIn, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { asDrawnIn, editedFrameOf, inspected } from "../state/selection.ts";
import { isPageRoot } from "./menu-model.ts";
import { actedOn, updateNodesWith } from "./node-actions.ts";

export const useCopiedStyle = create<{ style: CopiedStyle | null }>(() => ({
  style: null,
}));

/** The node as the view it is looked at in draws it. */
const drawn = (target: Selection) => {
  const { canvas, selection } = useEditor.getState();
  const node = nodeIn(
    useDocuments.getState().docs,
    canvas,
    target.frame,
    target.nodeId
  );
  return node && asDrawnIn(node, editedFrameOf(selection, target.frame));
};

/**
 * Copies the style of the node, or of the one the inspector shows; false when there is none to
 * copy, or it is a page's root.
 */
export const copyStyle = (target?: Selection): boolean => {
  const node = target ? drawn(target) : inspected()?.node;
  if (!node || isPageRoot(node)) {
    return false;
  }
  useCopiedStyle.setState({ style: styleOf(node) });
  toast(`Copied the style of ${nodeLabel(node)}`);
  return true;
};

/**
 * Pastes the style copied onto the nodes an action on `target` is for, each taking what its type
 * has of it; false when nothing is copied or there is nothing to paste onto.
 */
export const pasteStyle = (target?: Selection) => {
  const { style } = useCopiedStyle.getState();
  const { canvas } = useEditor.getState();
  const { docs } = useDocuments.getState();
  const targets = actedOn(target).filter((t) => {
    const node = nodeIn(docs, canvas, t.frame, t.nodeId);
    return node !== null && !isPageRoot(node);
  });
  if (!style || targets.length === 0) {
    return false;
  }
  return updateNodesWith(
    targets,
    (node) => styleFor(style, node.type),
    "Paste style"
  );
};
