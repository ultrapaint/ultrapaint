/**
 * What a frame's id names, parsed once: a page's own frame, a view of a page (ADR 0036), a node
 * placed on the canvas beside the pages, or a board of the board view (ADR 0045). The ids are
 * strings because the stores, the preview and the URL key frames by them; everything that asks
 * what kind of frame it is asks here and switches on `kind`, so a fifth kind is one more case the
 * compiler finds rather than a "not a node, so a page" somewhere.
 *
 * Pure: the questions callers ask of a frame (does it take comments, can its nodes lead somewhere
 * in the prototype, how wide is it drawn, which document does it show) are answered from the ref
 * and what is passed in.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { canvasDocOf } from "@ultrapaint/design-document/tree";

export type FrameRef =
  /** A page's own frame, whose id is the page's. */
  | { readonly kind: "page"; readonly page: string }
  /** A view of a page: the page drawn again at another width, `<page>#<view>`. */
  | { readonly kind: "view"; readonly page: string; readonly view: string }
  /** A node placed on the canvas beside the pages, and everything inside it: `node:<id>`. */
  | { readonly kind: "node"; readonly node: string }
  /**
   * A board: a document the editor generates for the item a board view shows, which is no page
   * and no node of the canvas, `board:<view>/<item>/<name>`.
   */
  | {
      readonly item: string;
      readonly kind: "board";
      readonly name: string;
      readonly view: string;
    };

const NODE = "node:";
const BOARD = "board:";
/** What separates a page from one of its views in a view's id. */
const VIEW = "#";

/** Where a board's frame is: the board view, the item it shows, and the board's own name. */
export type BoardFrame = Omit<Extract<FrameRef, { kind: "board" }>, "kind">;

export const nodeFrameOf = (nodeId: string) => `${NODE}${nodeId}`;

export const viewFrameOf = (page: string, view: string) =>
  `${page}${VIEW}${view}`;

export const boardFrameOf = ({ item, name, view }: BoardFrame) =>
  `${BOARD}${view}/${item}/${name}`;

/**
 * A board's id, read: an item may hold a slash or a `#` (a guideline's heading), so the view is
 * before the first slash and the board's name after the last. Null when it has neither.
 */
const boardRef = (rest: string): FrameRef | null => {
  const first = rest.indexOf("/");
  const last = rest.lastIndexOf("/");
  if (first < 0 || last === first) {
    return null;
  }
  return {
    item: rest.slice(first + 1, last),
    kind: "board",
    name: rest.slice(last + 1),
    view: rest.slice(0, first),
  };
};

/** What a frame id names. An id of no other kind is a page's. */
export const frameRefOf = (id: string): FrameRef => {
  if (id.startsWith(NODE)) {
    return { kind: "node", node: id.slice(NODE.length) };
  }
  if (id.startsWith(BOARD)) {
    const board = boardRef(id.slice(BOARD.length));
    if (board) {
      return board;
    }
  }
  const at = id.indexOf(VIEW);
  return at < 0
    ? { kind: "page", page: id }
    : { kind: "view", page: id.slice(0, at), view: id.slice(at + VIEW.length) };
};

const unknownKind = (ref: never): never => ref;

/**
 * The frame a view draws again, its page's own; any other frame is its own. A selection shows in
 * every frame of one own frame, and Layers lists a view's nodes as its page's.
 */
export const ownFrameOf = (id: string): string => {
  const ref = frameRefOf(id);
  return ref.kind === "view" ? ref.page : id;
};

/** The page a frame draws: a page's own frame, or a view of it. Null for any other frame. */
export const pageOfRef = (ref: FrameRef): string | null =>
  ref.kind === "page" || ref.kind === "view" ? ref.page : null;

/** Comments are pinned on pages: a page's frame and each of its views take them. */
export const takesComments = (ref: FrameRef): boolean =>
  pageOfRef(ref) !== null;

/**
 * Whether a frame's nodes can lead somewhere in the prototype: only a page is in it. A node
 * beside the pages and a board's generated document never are.
 */
export const hasPrototypeLinks = (ref: FrameRef): boolean =>
  pageOfRef(ref) !== null;

/**
 * The document a frame shows: the page it draws, or the canvas's loose nodes. Null for a board,
 * which draws what it generates (an app component's tree edited on it is `editedAs`'s).
 */
export const documentShown = (
  ref: FrameRef,
  canvas: string | null
): string | null => {
  switch (ref.kind) {
    case "page":
    case "view":
      return ref.page;
    case "node":
      return canvasDocOf(canvas ?? "");
    case "board":
      return null;
    default:
      return unknownKind(ref);
  }
};

/**
 * The width a frame is drawn at, which says its breakpoint (ADR 0036): a page's frame and each
 * view at their box's width, a node on the canvas at its own fixed width (sized by what it holds,
 * at the base). A board is drawn at the base. Undefined when it is not known.
 */
export const widthOf = (
  ref: FrameRef,
  seen: {
    /** The frame's box, when the layout has one. */
    readonly box: { readonly width: number } | undefined;
    /** What the frame draws, for a node on the canvas. */
    readonly root: DesignNode | null;
  }
): number | undefined => {
  switch (ref.kind) {
    case "page":
    case "view":
      return seen.box?.width;
    case "node":
      return typeof seen.root?.width === "number" ? seen.root.width : undefined;
    case "board":
      return;
    default:
      return unknownKind(ref);
  }
};
