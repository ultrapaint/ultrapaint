/**
 * A link to a node opens the editor on it: once the canvas's documents are read, the node is
 * selected in the page the URL's route serves, or on the canvas beside the pages, and brought
 * into view. The parameter is then dropped: the selection is the editor's state, not the link's.
 */
import { useEffect, useRef } from "react";
import { frameOfCanvasNode, nodeIn, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { clearNodeParam, readUrl } from "../state/url.ts";
import { viewportSize } from "./shortcuts.ts";

export const useOpenNodeLink = () => {
  const wanted = useRef(readUrl().node);
  const loaded = useDocuments((s) => s.loaded);
  const activePage = useEditor((s) => s.activePage);
  const canvas = useEditor((s) => s.canvas);
  useEffect(() => {
    const nodeId = wanted.current;
    if (!(nodeId && loaded) || canvas === null) {
      return;
    }
    const { docs } = useDocuments.getState();
    const inPage =
      activePage !== null && nodeIn(docs, canvas, activePage, nodeId)
        ? activePage
        : null;
    const frame = inPage ?? frameOfCanvasNode(docs, canvas, nodeId);
    wanted.current = null;
    clearNodeParam();
    if (!frame) {
      return;
    }
    const editor = useEditor.getState();
    editor.select({ frame, nodeId });
    // The frame's size is known a moment after its page is laid out.
    requestAnimationFrame(() =>
      useEditor.getState().zoomToSelection(viewportSize())
    );
  }, [loaded, activePage, canvas]);
};
