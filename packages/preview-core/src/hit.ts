/**
 * Hit-testing that answers with what is painted rather than with what would be clicked.
 *
 * A component library that opens a popup covers the page to catch the click that dismisses it.
 * Base UI drops a transparent `position: fixed` sheet over the viewport and marks everything
 * outside the popup `inert`, which takes those elements out of hit-testing altogether; Radix
 * turns pointer events off on the body. The browser then answers every point outside the popup
 * with the sheet or the document element — right for a click, useless for a canvas, where
 * hovering is how the design is read. A lookup here undoes all of it for the instant it takes,
 * so an open dropdown can be inspected in select mode and the screen behind it stays selectable.
 *
 * The same is true one element at a time. A design system turns pointer events off on every
 * icon it draws, so that a click on the tick of a menu item still lands on the item; a design
 * turns them off on a decoration, so that it is not in the way. Neither is a reason for a
 * canvas not to show them.
 */
import { paintsNothing } from "./dom.ts";

const INERT = "inert";

let sheet: CSSStyleSheet | null | undefined;

/** `pointer-events: none` is what a lock on the body is made of; a lookup is not a click. */
const pointerEventsSheet = () => {
  if (sheet === undefined) {
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync("*{pointer-events:auto!important}");
    } catch {
      // No constructable stylesheets: a page that locks the body stays as the browser sees it.
      sheet = null;
    }
  }
  return sheet;
};

/**
 * Where a lookup happens: a document, or a frame's shadow root in the editor's page,
 * whose points are the screen's and whose size is the frame's.
 */
export interface HitScope {
  readonly root: Document | ShadowRoot;
  /** The window's size, in the points' units: what a sheet covering it measures. */
  readonly viewport: () => { readonly height: number; readonly width: number };
}

const documentScope: HitScope = {
  root:
    typeof document === "undefined" ? (null as unknown as Document) : document,
  viewport: () => ({ height: window.innerHeight, width: window.innerWidth }),
};

/**
 * Runs the lookup with the page's own defences down. Both changes are undone before anything
 * else can observe them: nothing here yields, and neither affects what is painted.
 */
const unblocked = <T>(scope: HitScope, read: () => T): T => {
  const { root } = scope;
  const inert = Array.from(root.querySelectorAll(`[${INERT}]`));
  for (const el of inert) {
    el.removeAttribute(INERT);
  }
  const overlay = pointerEventsSheet();
  if (overlay) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, overlay];
  }
  try {
    return read();
  } finally {
    if (overlay) {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
        (s) => s !== overlay
      );
    }
    for (const el of inert) {
      el.setAttribute(INERT, "");
    }
  }
};

/**
 * The sheet a popup puts over the page to catch the click that dismisses it: it covers the
 * viewport, paints nothing and holds nothing. Nothing in a design looks like that, so the
 * lookup goes through it to whatever is underneath. A dimmed dialog overlay paints, and stays
 * selectable like any other element.
 */
const isDismissLayer = (scope: HitScope, el: Element): boolean => {
  const style = getComputedStyle(el);
  if (style.position !== "fixed" && style.position !== "absolute") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  const viewport = scope.viewport();
  if (
    rect.width < viewport.width * 0.9 ||
    rect.height < viewport.height * 0.9
  ) {
    return false;
  }
  return paintsNothing(el, style);
};

/**
 * The elements under a point that belong to the scope: a shadow root answers with the editor's
 * own elements over it too, which are no part of the page.
 */
const stackAt = (scope: HitScope, x: number, y: number) => {
  const stack = scope.root.elementsFromPoint(x, y);
  return scope.root === document
    ? stack
    : stack.filter((el) => scope.root.contains(el));
};

const pick = (scope: HitScope, stack: readonly Element[]): Element | null =>
  stack.find((el) => !isDismissLayer(scope, el)) ?? null;

/** Whether a lookup landed on nothing in particular, and is worth a second try. */
const empty = (el: Element | null) =>
  el === null ||
  el === document.documentElement ||
  el === document.body ||
  el.hasAttribute("data-ed-body") ||
  el.id === "root";

export const elementAt = (
  x: number,
  y: number,
  scope: HitScope = documentScope
): Element | null => {
  // The plain lookup first: it is what the page itself would answer, and on a leaf it is the
  // whole answer, since nothing can hide inside an element that holds nothing.
  const direct = pick(scope, stackAt(scope, x, y));
  if (!empty(direct) && direct?.childElementCount === 0) {
    return direct;
  }
  const open = unblocked(scope, () => pick(scope, stackAt(scope, x, y)));
  if (empty(direct)) {
    return open ?? direct;
  }
  // What the page kept from the lookup inside its own answer is taken — the tick of a menu
  // item, the icon in a button — and what it kept on top of it is left where it is: a
  // decoration spread over a screen is not what a point in the middle of it means.
  return open && direct?.contains(open) ? open : direct;
};
