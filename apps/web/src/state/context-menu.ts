/**
 * The one context menu of the editor. Whatever is right-clicked — a node on the canvas or its
 * row in the layers, a page, a comment, a token — asks for the menu of a target, and
 * `<ContextMenuHost />` draws it. The same target gives the same menu wherever it was clicked.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { MouseEvent as ReactMouseEvent } from "react";
import { create } from "zustand";

/** A point in a frame's own coordinates, or on the canvas. */
export interface Point {
  x: number;
  y: number;
}

/** What a design token can be applied to, by the kind of value it holds. */
export type TokenKind =
  | "color"
  | "font"
  | "radius"
  | "shadow"
  | "size"
  | "spacing";

export type MenuTarget =
  /** A node of a frame; `at` is where in the frame it was clicked. */
  | { kind: "node"; frame: string; nodeId: string; at?: Point }
  /** A page as a whole; `at` is where in its frame it was clicked. */
  | { kind: "page"; pageId: string; at?: Point }
  /** The empty canvas, at a point of the canvas. */
  | { kind: "canvas"; at: Point }
  /** A route of the Pages panel that only has pages under it. */
  | { kind: "route"; route: string }
  | { kind: "comment"; commentId: string }
  | { kind: "token"; name: string; value: string; tokenKind: TokenKind }
  | { kind: "textStyle"; name: string }
  /** An entry of the palette: a primitive, or a component of the design system. */
  | {
      kind: "component";
      name: string;
      /** A design system component, as opposed to one of the format's own nodes. */
      isComponent: boolean;
      make: () => DesignNode;
    }
  | { kind: "thread"; threadId: string };

/** Where the menu opens: a point of the window, or against an element (a ⋮ button). */
export type MenuAnchor = Point | Element;

interface Request {
  anchor: MenuAnchor;
  id: number;
  target: MenuTarget;
}

// `open` is kept apart from `request` so the content stays while the menu animates out.
export const useContextMenu = create<{
  open: boolean;
  request: Request | null;
}>(() => ({ open: false, request: null }));

let nextId = 1;

export const showMenu = (target: MenuTarget, anchor: MenuAnchor) => {
  const id = nextId;
  nextId += 1;
  useContextMenu.setState({ open: true, request: { anchor, id, target } });
};

export const closeMenu = () => useContextMenu.setState({ open: false });

/**
 * The browser's own menu is kept away at once, and the target's opens at the pointer. The event
 * does not go on: a row inside another row, a node inside a frame, is the one that was meant.
 */
export const openMenuAt = (
  e: ReactMouseEvent | MouseEvent,
  target: MenuTarget
) => {
  e.preventDefault();
  e.stopPropagation();
  showMenu(target, { x: e.clientX, y: e.clientY });
};

/** Keeps the browser's menu away while the target is still being worked out. */
export const holdMenu = (e: ReactMouseEvent | MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  return { x: e.clientX, y: e.clientY };
};
