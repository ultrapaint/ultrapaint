/**
 * A reference to one node of the designs, to paste to an agent or keep: `/orders#c_8x2k1q` is
 * the node `c_8x2k1q` of the page at `/orders`. A page without a URL is named by its file inside
 * the canvas instead: `drafts/orders.page.json#c_8x2k1q`. `canvas#id` is a node on the canvas
 * beside the pages, and a canvas other than the only one comes first: `marketing:/pricing#id`.
 * Node ids are kept in the page's file, so a reference lasts as long as the node does.
 */
export interface NodeRef {
  /** Absent when the project has one canvas and no canvas was written. */
  readonly canvas?: string;
  readonly nodeId: string;
  /**
   * The page: its URL (`/orders`), or its file inside the canvas when it has none
   * (`orders.page.json`); null for the canvas beside the pages.
   */
  readonly page: string | null;
}

const CANVAS = "canvas";
const REF_RE =
  /^(?:([\w.-]+):)?(\/[^#\s]*|canvas|[^\s#/:][^\s#:]*\.page\.json)#([\w-]+)$/;

export const formatNodeRef = (ref: NodeRef): string =>
  `${ref.canvas ? `${ref.canvas}:` : ""}${ref.page ?? CANVAS}#${ref.nodeId}`;

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
    page: where === CANVAS ? null : where,
    ...(canvas ? { canvas } : {}),
  };
};
