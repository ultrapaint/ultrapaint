/**
 * A reference to one node of the designs, to paste to an agent or keep: `/orders#c_8x2k1q` is
 * the node `c_8x2k1q` of the page at `/orders`. A page without a URL is named by its file inside
 * the canvas instead: `drafts/orders.page.json#c_8x2k1q`; so is a variant's page, whose URL names
 * its base page: `pricing@bold.page.json#c_8x2k1q`. `canvas#id` is a node on the canvas beside
 * the pages, and a canvas other than the only one comes first: `marketing:/pricing#id`.
 * Node ids are kept in the page's file, so a reference lasts as long as the node does.
 */
export interface NodeRef {
  /** Absent when the project has one canvas and no canvas was written. */
  readonly canvas?: string;
  readonly nodeId: string;
  /**
   * The page: its URL (`/orders`), or its file inside the canvas when it has none or is a
   * variant's (`orders.page.json`); null for the canvas beside the pages.
   */
  readonly page: string | null;
}

const CANVAS = "canvas";

/** A directory's name in a canvas's path: it does not start with a dot, as no canvas's does. */
const CANVAS_SEGMENT = String.raw`[^\s/\\:.\0][^\s/\\:\0]*`;

/**
 * A canvas as it is written before a page (`marketing:/pricing`, `app/v2:/pricing`), as the
 * source of a pattern: the path of a directory inside the designs directory, as the contracts'
 * `CanvasId` has it, without what a reference cannot hold, the whitespace that ends it and the
 * `:` that ends its canvas. It never starts with `/`, so a page's URL is never read as one.
 */
export const CANVAS_ID_PATTERN = String.raw`${CANVAS_SEGMENT}(?:\/${CANVAS_SEGMENT})*`;

const REF_RE = new RegExp(
  String.raw`^(?:(${CANVAS_ID_PATTERN}):)?(\/[^#\s]*|canvas|[^\s#/:][^\s#:]*\.page\.json)#([\w-]+)$`
);

export const formatNodeRef = (ref: NodeRef): string =>
  `${ref.canvas ? `${ref.canvas}:` : ""}${ref.page ?? CANVAS}#${ref.nodeId}`;

/** What a link to the editor names: a page (its URL or its id), maybe one node of it. */
interface EditorLink {
  readonly canvas?: string;
  readonly nodeId?: string;
  /** The page's URL or id; null for the canvas beside the pages, which a node's link says. */
  readonly page: string | null;
  /** The variant the URL is served in: the link is to that variant's page, not the base page. */
  readonly variant?: string;
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
 * page without a URL, `variant=` for a variant's page), so that it is taken wherever a reference
 * is: pasted to an agent inside the editor or outside it. A node's link with neither route nor
 * page is a node beside the pages. Null for any other text, a URL of anything else included.
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
  const variant = at.get("variant");
  return {
    page,
    ...(canvas ? { canvas } : {}),
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(variant ? { variant } : {}),
  };
};

/**
 * The reference a text is, a link to one node the editor copies included, or null. A reference
 * names a variant's page by its file, which a link does not say: its variant is the link's alone
 * (`parseEditorLink`).
 */
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
