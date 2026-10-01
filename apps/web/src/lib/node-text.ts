/**
 * Nodes as text on the system clipboard: JSON under a mark, so that nothing else pasted is
 * taken for a node, and checked against the format on the way back in. One node is written on
 * its own, as it always was; several as a list.
 */
import { DesignNode } from "@ultrapaint/contracts/document";
import { Option, Schema } from "effect";

/** What the system clipboard holds when it holds nodes of ours. */
const MARK = "ultrapaint/node";

const decodeNodes = Schema.decodeUnknownOption(
  Schema.Union([DesignNode, Schema.Array(DesignNode)])
);

/** The nodes in text on the clipboard, or null when the text is anything else. */
export const nodesFromText = (text: string): readonly DesignNode[] | null => {
  if (!text.includes(MARK)) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { [MARK]?: unknown };
    const nodes = Option.getOrNull(decodeNodes(parsed[MARK]));
    if (nodes === null) {
      return null;
    }
    const list: readonly DesignNode[] = Array.isArray(nodes) ? nodes : [nodes];
    return list.length > 0 ? list : null;
  } catch {
    // Text that only mentions the mark is not ours.
    return null;
  }
};

export const textOfNodes = (nodes: readonly DesignNode[]) =>
  JSON.stringify({ [MARK]: nodes.length === 1 ? nodes[0] : nodes }, null, 2);
