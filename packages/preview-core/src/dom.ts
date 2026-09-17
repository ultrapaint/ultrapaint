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

export const unionRect = (els: readonly Element[]) => {
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
