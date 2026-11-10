/**
 * A frame's host and body element, as the editor shows them (ADRs 0034, 0039, 0042): the host's
 * class, style, title, whether it takes input and whether it is away, and the body's defaults
 * (`frame.ts`). The editor is their one writer: nothing of a page's code runs in a frame.
 *
 * Only what changed is written: the host carries every `:host` rule of the frames' stylesheets,
 * and a write that changes nothing would style it again for nothing.
 */
import type { FrameShown } from "./preview.ts";

const SPACE_RE = /\s+/;

/** The style last written on each element, as its text. */
const styles = new WeakMap<HTMLElement, string>();

/** `element`'s classes are `classes` from now on. */
export const writeClasses = (
  element: HTMLElement,
  classes: Iterable<string>
) => {
  const wanted = new Set(classes);
  const gone = [...element.classList].filter((name) => !wanted.has(name));
  if (gone.length > 0) {
    element.classList.remove(...gone);
  }
  const missing = [...wanted].filter(
    (name) => !element.classList.contains(name)
  );
  if (missing.length > 0) {
    element.classList.add(...missing);
  }
};

/** `element`'s style is `style` from now on: a style attribute's text, or properties. */
export const writeStyle = (
  element: HTMLElement,
  style: string | Readonly<Record<string, string>>
) => {
  const declared = document.createElement("div").style;
  if (typeof style === "string") {
    declared.cssText = style;
  } else {
    Object.assign(declared, style);
  }
  const text = declared.cssText;
  if (styles.get(element) !== text) {
    styles.set(element, text);
    element.style.cssText = text;
  }
};

/**
 * Shows the frame on its host as the editor asks: its class and style, its title, and whether it
 * takes input (otherwise the pointer goes past it) and is away (kept as it is, skipped by the
 * browser).
 */
export const showHost = (host: HTMLElement, shown: FrameShown) => {
  writeClasses(host, shown.className.split(SPACE_RE).filter(Boolean));
  const declared = document.createElement("div").style;
  declared.cssText = shown.style;
  declared.pointerEvents = shown.interactive ? "auto" : "none";
  if (shown.away) {
    declared.contentVisibility = "hidden";
  }
  writeStyle(host, declared.cssText);
  if (host.title !== shown.title) {
    host.title = shown.title;
  }
};

/** Takes back what `showHost` wrote: the host has no class, style or title of a frame's. */
export const clearHost = (host: HTMLElement) => {
  styles.delete(host);
  for (const name of ["class", "style", "title"]) {
    host.removeAttribute(name);
  }
};
