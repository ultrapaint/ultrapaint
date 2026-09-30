/**
 * A reference to one node of the designs, to paste to an agent or keep: `/orders#c_8x2k1q` is
 * the node `c_8x2k1q` of the page at `/orders`. `canvas#id` is a node on the canvas beside the
 * pages, and a canvas other than the only one comes first: `marketing:/pricing#id`. Node ids are
 * kept in the page's file, so a reference lasts as long as the node does.
 */
export interface NodeRef {
  /** Absent when the project has one canvas and no canvas was written. */
  readonly canvas?: string;
  readonly nodeId: string;
  /** The page's route, or null for the canvas beside the pages. */
  readonly route: string | null;
}

const CANVAS = "canvas";
const REF_RE = /^(?:([\w.-]+):)?(\/[^#\s]*|canvas)#([\w-]+)$/;

export const formatNodeRef = (ref: NodeRef): string =>
  `${ref.canvas ? `${ref.canvas}:` : ""}${ref.route ?? CANVAS}#${ref.nodeId}`;

/** The reference a text is, or null when it is not one. */
export const parseNodeRef = (text: string): NodeRef | null => {
  const match: RegExpExecArray | null = REF_RE.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, canvas, where, nodeId] = match;
  if (where === undefined || nodeId === undefined) {
    return null;
  }
  return {
    nodeId,
    route: where === CANVAS ? null : where,
    ...(canvas ? { canvas } : {}),
  };
};
