/**
 * Tells the server what is selected, as it changes (`editor.select`, ADR 0083): an agent outside
 * the editor asked about "what I've selected" reads it from `get_context`. Each node goes by the
 * reference the tools take and its name. A selection held a moment is said once, and said again
 * when the connection opens anew: a server that restarted has forgotten it.
 */
import type { SelectedNode } from "@ultrapaint/contracts/rpc";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { nodeRefText } from "../lib/node-links.ts";
import { api, useConnection } from "./connection.ts";
import { nodeIn, useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";

/** How long a selection stays put before it is said: a drag across the layers says one. */
const SETTLE_MS = 200;

/** The nodes selected now, first the one the inspector shows. */
export const selectedNodes = (): SelectedNode[] => {
  const { also, canvas, selection } = useEditor.getState();
  if (!selection) {
    return [];
  }
  const { docs } = useDocuments.getState();
  return [selection, ...also].map((target) => {
    const node = nodeIn(docs, canvas, target.frame, target.nodeId);
    return {
      name: node ? nodeLabel(node) : target.nodeId,
      ref: nodeRefText(target),
    };
  });
};

/** Starts saying the selection to the server; the returned function stops it. */
export const startSelectionReport = () => {
  let said = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const say = () => {
    const nodes = selectedNodes();
    const text = JSON.stringify(nodes);
    if (text === said) {
      return;
    }
    said = text;
    api()
      .request("editor.select", { nodes })
      // Not taken: said again with the next change, or when the connection opens anew.
      .catch(() => {
        said = "";
      });
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(say, SETTLE_MS);
  };
  const stopEditor = useEditor.subscribe((now, before) => {
    if (now.selection !== before.selection || now.also !== before.also) {
      later();
    }
  });
  const stopConnection = useConnection.subscribe((now, before) => {
    if (now.state === "open" && before.state !== "open") {
      said = "";
      later();
    }
  });
  return () => {
    clearTimeout(timer);
    stopEditor();
    stopConnection();
  };
};
