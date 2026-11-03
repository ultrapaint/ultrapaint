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

/** What a link to the editor names: a page (its URL or its id), maybe one node of it. */
export interface EditorLink {
  readonly canvas?: string;
  readonly nodeId?: string;
  /** The page's URL or id; null for the canvas beside the pages, which a node's link says. */
  readonly page: string | null;
}

const NODE_ID_RE = /^[\w-]+$/;

/** An http(s) URL with a query: the query, before any fragment. */
const LINK_RE = /^https?:\/\/[^\s?#]+\?([^\s#]*)(?:#\S*)?$/;

/** A query's parameters, decoded; null when one cannot be. */
const queryOf = (query: string): Map<string, string> | null => {
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    const [key = "", value = ""] = pair.split("=");
    try {
      params.set(
        decodeURIComponent(key.replace(/\+/g, " ")),
        decodeURIComponent(value.replace(/\+/g, " "))
      );
    } catch {
      // A malformed escape: no link.
      return null;
    }
  }
  return params;
};

/**
 * What a link the editor copies says (`…/?canvas=redesign&route=/vibe&node=c_1`, `page=` for a
 * page without a URL), so that it is taken wherever a reference is: pasted to an agent inside the
 * editor or outside it. A node's link with neither route nor page is a node beside the pages.
 * Null for any other text, a URL of anything else included.
 */
export const parseEditorLink = (text: string): EditorLink | null => {
  const match: RegExpExecArray | null = LINK_RE.exec(text.trim());
  if (!match?.[1]) {
    return null;
  }
  const at = queryOf(match[1]);
  if (!at) {
    return null;
  }
  const nodeId = at.get("node");
  const page = at.get("route") ?? at.get("page") ?? null;
  if (nodeId !== undefined && !NODE_ID_RE.test(nodeId)) {
    return null;
  }
  if (nodeId === undefined && page === null) {
    return null;
  }
  const canvas = at.get("canvas");
  return {
    page,
    ...(canvas ? { canvas } : {}),
    ...(nodeId === undefined ? {} : { nodeId }),
  };
};

/** The reference a text is, a link to one node the editor copies included, or null. */
export const parseNodeRef = (text: string): NodeRef | null => {
  const link = parseEditorLink(text);
  if (link?.nodeId !== undefined) {
    return {
      nodeId: link.nodeId,
      page: link.page,
      ...(link.canvas === undefined ? {} : { canvas: link.canvas }),
    };
  }
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
