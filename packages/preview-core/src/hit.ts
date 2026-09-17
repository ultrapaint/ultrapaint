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
 * Runs the lookup with the page's own defences down. Both changes are undone before anything
 * else can observe them: nothing here yields, and neither affects what is painted.
 */
const unblocked = <T>(read: () => T): T => {
  const inert = Array.from(document.querySelectorAll(`[${INERT}]`));
  for (const el of inert) {
    el.removeAttribute(INERT);
  }
  const overlay = pointerEventsSheet();
  if (overlay) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, overlay];
  }
  try {
    return read();
  } finally {
    if (overlay) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
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
const isDismissLayer = (el: Element): boolean => {
  const style = getComputedStyle(el);
  if (style.position !== "fixed" && style.position !== "absolute") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (
    rect.width < window.innerWidth * 0.9 ||
    rect.height < window.innerHeight * 0.9
  ) {
    return false;
  }
  return paintsNothing(el, style);
};

const pick = (stack: readonly Element[]): Element | null =>
  stack.find((el) => !isDismissLayer(el)) ?? null;

/** Whether a lookup landed on nothing in particular, and is worth a second try. */
const empty = (el: Element | null) =>
  el === null || el === document.documentElement || el === document.body;

export const elementAt = (x: number, y: number): Element | null => {
  // The plain lookup first: on a screen with nothing open it is the whole answer, and the page
  // keeps whatever `pointer-events` the design itself asked for.
  const direct = pick(document.elementsFromPoint(x, y));
  if (!empty(direct)) {
    return direct;
  }
  return unblocked(() => pick(document.elementsFromPoint(x, y))) ?? direct;
};
