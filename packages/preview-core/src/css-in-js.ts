/**
 * Styles the application's code writes as it runs (docs/PLAN-preview-sandbox.md, step 12):
 * emotion (MUI, Chakra), styled-components, goober, a scroll lock's rule. They put a `<style>` in
 * the document's head, which in the editor's page is the editor's: a component's rule never
 * reached its frame, a shadow root, and a global one (`body { outline }`) drew on the editor.
 *
 * A `<style>` the preview's code puts in the head goes into a shadow root of its own instead,
 * hidden: there it has a `sheet` its library can write to, and styles nothing. What it holds,
 * written as text (goober, emotion while developing) or rule by rule (`insertRule`, emotion and
 * styled-components in production), is written again as the page's stylesheets are
 * (`frame-css.ts`: `body` is the frame's body, a width query the frame's) into one sheet every
 * frame adopts, at most once a task, before anything is painted. Each rule is written once.
 */
import { type FrameCss, frameRule } from "./frame-css.ts";

const HOLDER_ATTRIBUTE = "data-ed-css-in-js";

/** The styles held, by element: what the library still writes to. */
const held = new WeakSet<Node>();
/** Each rule as the frames have it, written once. */
const rewritten = new WeakMap<CSSRule, FrameCss>();
let holder: ShadowRoot | null = null;
let scheduled = false;
let tell: (css: FrameCss) => void = () => undefined;
let watching = false;

const rebuild = () => {
  scheduled = false;
  const frame: string[] = [];
  const lifted: string[] = [];
  for (const style of holder?.querySelectorAll("style") ?? []) {
    for (const rule of Array.from(style.sheet?.cssRules ?? [])) {
      let css = rewritten.get(rule);
      if (!css) {
        css = frameRule(rule);
        rewritten.set(rule, css);
      }
      if (css.frame) {
        frame.push(css.frame);
      }
      if (css.document) {
        lifted.push(css.document);
      }
    }
  }
  tell({ document: lifted.join("\n"), frame: frame.join("\n") });
};

const schedule = () => {
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(rebuild);
  }
};

const holderRoot = (): ShadowRoot => {
  if (!holder) {
    const host = document.createElement("div");
    host.setAttribute(HOLDER_ATTRIBUTE, "");
    host.hidden = true;
    holder = host.attachShadow({ mode: "open" });
    document.documentElement.append(host);
    new MutationObserver(schedule).observe(holder, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
  return holder;
};

/** Whether `node` is a style the preview's code writes, which is held rather than the head's. */
export const isStyle = (node: unknown): node is HTMLStyleElement =>
  node instanceof HTMLStyleElement;

/** Whether `node` is held here. */
export const isHeld = (node: Node) => held.has(node);

/** Holds `style` before `before` (when it is held too), or last. */
export const holdStyle = (style: HTMLStyleElement, before: Node | null) => {
  const root = holderRoot();
  held.add(style);
  root.insertBefore(style, before?.parentNode === root ? before : null);
  return style;
};

/** Holds `style` first, as the head's `prepend` would have put it. */
export const holdStyleFirst = (style: HTMLStyleElement) =>
  holdStyle(style, holderRoot().firstChild);

/**
 * Tells `listener` the held styles as the frames have them, whenever they change; once. Rules
 * inserted and deleted one by one are not seen by an observer of the elements: the sheets'
 * own methods say so.
 */
export const watchHeldStyles = (listener: (css: FrameCss) => void) => {
  tell = listener;
  if (watching) {
    return;
  }
  watching = true;
  const proto = CSSStyleSheet.prototype;
  for (const name of ["insertRule", "deleteRule"] as const) {
    const native = proto[name] as (...args: unknown[]) => unknown;
    Object.defineProperty(proto, name, {
      configurable: true,
      value(this: CSSStyleSheet, ...args: unknown[]) {
        const result = native.apply(this, args);
        if (this.ownerNode && held.has(this.ownerNode)) {
          schedule();
        }
        return result;
      },
      writable: true,
    });
  }
};
