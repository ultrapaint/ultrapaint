/**
 * A frame's host and body element, which two write (ADR 0034, 0039): the editor, which shows the
 * frame (its host's class, style, title, whether it takes input, whether it is away; the body's
 * defaults, `frame.ts`), and the page's code, whose `<html>` and `<body>` they stand for
 * (`document-elements.ts`). Each writer's classes and style properties are kept apart and merged
 * on the element, the page's properties over the editor's, so neither takes the other's off: the
 * editor showing a parked frame again leaves the page's `dark` class and `color-scheme`, and the
 * page replacing its classes leaves the editor's.
 *
 * Only what changed is written: the host carries every `:host` rule of the page's stylesheet, and
 * a write that changes nothing would style it again for nothing.
 */
import type { FrameShown } from "@ultrapaint/framework-api/browser";

/** Who writes: the editor, or the page's code. */
export type Writer = "editor" | "page";

/** What one writer put on an element. */
interface Layer {
  readonly classes: Set<string>;
  /** Its style properties, on an element of its own nobody sees. */
  readonly style: CSSStyleDeclaration;
}

/**
 * An element's writers, and the classes and style properties last written on it: one either
 * writer takes off goes when the other does not have it.
 */
interface Written {
  classes: ReadonlySet<string>;
  readonly editor: Layer;
  readonly page: Layer;
  style: ReadonlySet<string>;
}

const written = new WeakMap<HTMLElement, Written>();

const SPACE_RE = /\s+/;

const layer = (): Layer => ({
  classes: new Set(),
  style: document.createElement("div").style,
});

const writtenOf = (element: HTMLElement): Written => {
  let found = written.get(element);
  if (!found) {
    found = {
      classes: new Set(),
      editor: layer(),
      page: layer(),
      style: new Set(),
    };
    written.set(element, found);
  }
  return found;
};

/** Writes on `element` what its writers want, and takes off what neither does any more. */
const paint = (element: HTMLElement) => {
  const w = writtenOf(element);
  const classes = new Set([...w.editor.classes, ...w.page.classes]);
  const gone = [...w.classes].filter((name) => !classes.has(name));
  if (gone.length > 0) {
    element.classList.remove(...gone);
  }
  const missing = [...classes].filter(
    (name) => !element.classList.contains(name)
  );
  if (missing.length > 0) {
    element.classList.add(...missing);
  }
  w.classes = classes;

  const style = new Map<string, { priority: string; value: string }>();
  for (const { style: declared } of [w.editor, w.page]) {
    for (let i = 0; i < declared.length; i += 1) {
      const name = declared.item(i);
      style.set(name, {
        priority: declared.getPropertyPriority(name),
        value: declared.getPropertyValue(name),
      });
    }
  }
  const shown = element.style;
  for (const name of w.style) {
    if (!style.has(name)) {
      shown.removeProperty(name);
    }
  }
  for (const [name, { priority, value }] of style) {
    if (
      shown.getPropertyValue(name) !== value ||
      shown.getPropertyPriority(name) !== priority
    ) {
      shown.setProperty(name, value, priority);
    }
  }
  w.style = new Set(style.keys());
};

/** `writer`'s classes on `element` are `classes` from now on. */
export const writeClasses = (
  element: HTMLElement,
  writer: Writer,
  classes: Iterable<string>
) => {
  const own = writtenOf(element)[writer].classes;
  own.clear();
  for (const name of classes) {
    own.add(name);
  }
  paint(element);
};

/** `writer` adds `classes` to `element`, or takes them off. */
export const toggleClasses = (
  element: HTMLElement,
  writer: Writer,
  classes: readonly string[],
  on: boolean
) => {
  const own = writtenOf(element)[writer].classes;
  for (const name of classes) {
    if (on) {
      own.add(name);
    } else {
      own.delete(name);
    }
  }
  paint(element);
};

/** `writer`'s style on `element` is `style` from now on: a style attribute's text, or properties. */
export const writeStyle = (
  element: HTMLElement,
  writer: Writer,
  style: string | Readonly<Record<string, string>>
) => {
  const own = writtenOf(element)[writer].style;
  if (typeof style === "string") {
    own.cssText = style;
  } else {
    own.cssText = "";
    Object.assign(own, style);
  }
  paint(element);
};

const pageStyles = new WeakMap<HTMLElement, CSSStyleDeclaration>();

/**
 * `element`'s style as the page's code has it: read, it is the element's; written, a property at
 * a time, it is the page's own, over the editor's. Its whole style written at once replaces the
 * page's own when `whole`, and is dropped otherwise.
 */
export const pageStyleOf = (
  element: HTMLElement,
  whole: boolean
): CSSStyleDeclaration => {
  const found = pageStyles.get(element);
  if (found) {
    return found;
  }
  const own = writtenOf(element).page.style;
  const shown = element.style;
  const proxy = new Proxy(shown, {
    get: (target, key) => {
      if (key === "setProperty") {
        return (name: string, value: string | null, priority?: string) => {
          own.setProperty(name, value, priority);
          paint(element);
        };
      }
      if (key === "removeProperty") {
        return (name: string) => {
          const before = target.getPropertyValue(name);
          own.removeProperty(name);
          paint(element);
          return before;
        };
      }
      const read = Reflect.get(target, key, target) as unknown;
      return typeof read === "function" ? read.bind(target) : read;
    },
    set: (_target, key, value) => {
      if (key === "cssText") {
        if (whole) {
          own.cssText = String(value);
          paint(element);
        }
      } else {
        Reflect.set(own, key, value);
        paint(element);
      }
      return true;
    },
  });
  pageStyles.set(element, proxy);
  return proxy;
};

/**
 * Shows the frame on its host as the editor asks: its class and style, its title, and whether it
 * takes input (otherwise the pointer goes past it) and is away (kept as it is, skipped by the
 * browser).
 */
export const showHost = (host: HTMLElement, shown: FrameShown) => {
  const { editor } = writtenOf(host);
  editor.classes.clear();
  for (const name of shown.className.split(SPACE_RE)) {
    if (name) {
      editor.classes.add(name);
    }
  }
  editor.style.cssText = shown.style;
  editor.style.pointerEvents = shown.interactive ? "auto" : "none";
  if (shown.away) {
    editor.style.contentVisibility = "hidden";
  }
  paint(host);
  if (host.title !== shown.title) {
    host.title = shown.title;
  }
};
