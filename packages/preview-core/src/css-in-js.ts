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
 *
 * A `<link rel="stylesheet">` it adds is held the same way and read once loaded (step 16); one of
 * another site, whose rules a page may not read, is fetched instead, and left to the editor's
 * head, as before, when its site does not allow that either. Its relative URLs (a font, an
 * image) are made absolute: the frames' sheet is not where the file was.
 */
import { type FrameCss, frameCss, frameRule } from "./frame-css.ts";

const HOLDER_ATTRIBUTE = "data-ed-css-in-js";

/** What is held: a style a library writes to, a stylesheet it links. */
type Held = HTMLLinkElement | HTMLStyleElement;

/** The styles held, by element: what the library still writes to. */
const held = new WeakSet<Node>();
/** Each rule as the frames have it, written once. */
const rewritten = new WeakMap<CSSRule, FrameCss>();
/** Another site's stylesheet, fetched: as the frames have it, or why it is not there. */
const fetched = new WeakMap<HTMLLinkElement, FrameCss | "failed" | "pending">();

const URL_RE = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;
const KEPT_URL_RE = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;
const STYLESHEET_RE = /(?:^|\s)stylesheet(?:\s|$)/i;

/** `css` with its relative URLs made absolute against `base`, the stylesheet's own address. */
const absolute = (css: FrameCss, base: string | null): FrameCss => {
  if (!base) {
    return css;
  }
  const fix = (text: string) =>
    text.replace(URL_RE, (whole, quote: string, url: string) =>
      KEPT_URL_RE.test(url)
        ? whole
        : `url(${quote}${new URL(url, base).href}${quote})`
    );
  return { document: fix(css.document), frame: fix(css.frame) };
};

/** The rules of `element`'s sheet; null when there are none yet, undefined when they may not be read. */
const rulesOf = (element: Held): CSSRuleList | null | undefined => {
  try {
    return element.sheet?.cssRules ?? null;
  } catch {
    // Another site's stylesheet: its rules are not the page's to read.
    return undefined;
  }
};

/** Fetches another site's stylesheet `link` once; left to the editor's head if it cannot be. */
const fetchSheet = (link: HTMLLinkElement) => {
  fetched.set(link, "pending");
  fetch(link.href, { credentials: "omit", mode: "cors" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      return response.text();
    })
    .then(
      (text) => {
        fetched.set(link, absolute(frameCss(text), link.href));
        schedule();
      },
      () => {
        fetched.set(link, "failed");
        held.delete(link);
        document.head.append(link);
      }
    );
};
let holder: ShadowRoot | null = null;
let scheduled = false;
let tell: (css: FrameCss) => void = () => undefined;

const rebuild = () => {
  scheduled = false;
  const frame: string[] = [];
  const lifted: string[] = [];
  const add = (css: FrameCss) => {
    if (css.frame) {
      frame.push(css.frame);
    }
    if (css.document) {
      lifted.push(css.document);
    }
  };
  for (const element of holder?.querySelectorAll<Held>("style, link") ?? []) {
    const rules = rulesOf(element);
    if (rules === undefined && element instanceof HTMLLinkElement) {
      const sheet = fetched.get(element);
      if (sheet === undefined) {
        fetchSheet(element);
      } else if (typeof sheet === "object") {
        add(sheet);
      }
      continue;
    }
    for (const rule of Array.from(rules ?? [])) {
      let css = rewritten.get(rule);
      if (!css) {
        css = absolute(frameRule(rule), rule.parentStyleSheet?.href ?? null);
        rewritten.set(rule, css);
      }
      add(css);
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

/** Whether `node` is a style or a stylesheet's link, held rather than the head's when the preview's. */
export const isStyle = (node: unknown): node is Held =>
  node instanceof HTMLStyleElement ||
  (node instanceof HTMLLinkElement &&
    STYLESHEET_RE.test(node.rel) &&
    node.hasAttribute("href"));

/** Whether `node` is held here. */
export const isHeld = (node: Node) => held.has(node);

/** Holds `style` before `before` (when it is held too), or last. */
export const holdStyle = (style: Held, before: Node | null) => {
  const root = holderRoot();
  held.add(style);
  if (style instanceof HTMLLinkElement) {
    // Its rules come when it has loaded.
    style.addEventListener("load", schedule);
  }
  root.insertBefore(style, before?.parentNode === root ? before : null);
  return style;
};

/** Holds `style` first, as the head's `prepend` would have put it. */
export const holdStyleFirst = (style: Held) =>
  holdStyle(style, holderRoot().firstChild);

/**
 * Tells `listener` the held styles as the frames have them, whenever they change. Rules
 * inserted and deleted one by one are not seen by an observer of the elements: the sheets'
 * own methods say so. Installed once, by the kernel; the holder itself is made with the first
 * style held, so a page that writes none adds nothing to the editor's document.
 */
export const watchHeldStyles = (listener: (css: FrameCss) => void) => {
  tell = listener;
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
