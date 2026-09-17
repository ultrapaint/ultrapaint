/** Small DOM helpers the core and the renderers share. */
import type { SourceLocation } from "@ultrapaint/contracts/base";

/** Attribute the stamping plugins write on every element of the source. */
export const STAMP = "data-ed";

/** Parses `<file>:<line>:<col>`; the file itself may contain colons. */
export const parseStamp = (value: unknown): SourceLocation | null => {
  if (typeof value !== "string") {
    return null;
  }
  const idx = value.lastIndexOf(":");
  const idx2 = value.lastIndexOf(":", idx - 1);
  if (idx < 0 || idx2 < 0) {
    return null;
  }
  const line = Number(value.slice(idx2 + 1, idx));
  const col = Number(value.slice(idx + 1));
  if (!(Number.isInteger(line) && Number.isInteger(col))) {
    return null;
  }
  return { col, file: value.slice(0, idx2), line };
};

/** Text of an element that holds only text; null as soon as it has element children. */
export const directText = (el: Element): string | null => {
  let text = "";
  let hasText = false;
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      text += n.textContent ?? "";
      hasText = true;
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      return null;
    }
  }
  return hasText ? text.trim() : null;
};

export const shorten = (s: string, max = 24) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

/** One line for the layers panel: `div.flex.gap-2 "Sign in"`. */
export const elementSummary = (el: Element, name: string): string => {
  const classes = Array.from(el.classList).slice(0, 2);
  const text = directText(el);
  let s = name;
  if (classes.length) {
    s += `.${classes.join(".")}`;
  }
  if (text) {
    s += ` "${shorten(text)}"`;
  }
  return s;
};

const TRANSPARENT =
  /^(?:transparent|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\))$/;
const BORDERS = [
  "border-bottom-width",
  "border-left-width",
  "border-right-width",
  "border-top-width",
];

/** A box of the element's own: a fill, a border, a shadow — not what its children draw. */
const drawsBox = (style: CSSStyleDeclaration) =>
  !TRANSPARENT.test(style.backgroundColor) ||
  style.backgroundImage !== "none" ||
  style.boxShadow !== "none" ||
  style.backdropFilter !== "none" ||
  BORDERS.some((p) => style.getPropertyValue(p) !== "0px");

/** Nothing of the element is drawn and nothing is inside it: it is there for behaviour alone. */
export const paintsNothing = (el: Element, style: CSSStyleDeclaration) =>
  !drawsBox(style) &&
  el.childElementCount === 0 &&
  (el.textContent ?? "").trim() === "";

/** Whether the element itself puts a box on the screen, whatever it happens to contain. */
export const drawsItsOwnBox = (el: Element) => drawsBox(getComputedStyle(el));

/**
 * Machinery a popup adds to the page rather than anything of the design: the sheet that catches
 * the click that dismisses it, the one-pixel spans parked off-screen that keep focus from
 * leaving it. All of it is `position: fixed`, paints nothing and holds nothing, and measuring a
 * component that opens one together with it reports the viewport instead of the popup.
 */
const isPopupChrome = (el: Element): boolean => {
  const style = getComputedStyle(el);
  return style.position === "fixed" && paintsNothing(el, style);
};

const boxOf = (els: readonly Element[]) => {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      continue;
    }
    x1 = Math.min(x1, r.left);
    y1 = Math.min(y1, r.top);
    x2 = Math.max(x2, r.right);
    y2 = Math.max(y2, r.bottom);
  }
  if (!Number.isFinite(x1)) {
    return { height: 0, width: 0, x: 0, y: 0 };
  }
  return { height: y2 - y1, width: x2 - x1, x: x1, y: y1 };
};

/** Whether the element takes up any of the screen: a box to measure, a box to point at. */
export const drawsOnScreen = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  // A degenerate box covers no pixel, and the root a portal appends to the body is one: a flat
  // line at the end of the page, holding a popup that floats somewhere else entirely.
  if (r.width === 0 || r.height === 0) {
    return false;
  }
  return !isPopupChrome(el);
};

export const unionRect = (els: readonly Element[]) => {
  const drawn = els.filter(drawsOnScreen);
  // An element that draws nothing is still measured when it is all there is: selecting it from
  // the layers panel should say where it sits.
  return boxOf(drawn.length > 0 ? drawn : els);
};
