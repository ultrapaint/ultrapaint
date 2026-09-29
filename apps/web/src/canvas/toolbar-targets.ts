/** The nodes the Vibe toolbar's controls change, shared by the toolbar and its popovers. */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { createContext, useContext } from "react";
import { nodeIn, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";

/** The selection the controls change: one node or several. */
export const Targets = createContext<readonly Selection[]>([]);

/** The nodes the toolbar changes, as the documents have them now. */
export const useTargetNodes = (): readonly DesignNode[] => {
  const targets = useContext(Targets);
  const docs = useDocuments((s) => s.docs);
  const space = useEditor((s) => s.space);
  return targets.flatMap((t) => {
    const node = nodeIn(docs, space, t.frame, t.nodeId);
    return node ? [node] : [];
  });
};
