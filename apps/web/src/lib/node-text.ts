/**
 * A node as text on the system clipboard: JSON under a mark, so that nothing else pasted is
 * taken for a node, and checked against the format on the way back in.
 */
import { DesignNode } from "@ultrapaint/contracts/document";
import { Option, Schema } from "effect";

/** What the system clipboard holds when it holds a node of ours. */
const MARK = "ultrapaint/node";

const decodeNode = Schema.decodeUnknownOption(DesignNode);

/** A node from text on the clipboard, or null when the text is anything else. */
export const nodeFromText = (text: string): DesignNode | null => {
  if (!text.includes(MARK)) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { [MARK]?: unknown };
    return Option.getOrNull(decodeNode(parsed[MARK]));
  } catch {
    // Text that only mentions the mark is not ours.
    return null;
  }
};

export const textOfNode = (node: DesignNode) =>
  JSON.stringify({ [MARK]: node }, null, 2);
