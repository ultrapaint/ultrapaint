/**
 * The document's `<html>` and `<body>`, as the preview's code writes them
 * (docs/PLAN-preview-sandbox.md, step 10). In the editor's page they are the editor's: a theme
 * provider's class and `color-scheme` landed on the editor's `<html>`, a modal's scroll lock on
 * the editor's body. What the preview's code writes to them goes to the frame's own instead, the
 * elements its stylesheet already says `html` and `body` of (`frame-css.ts`):
 *
 * - `<html>` is the frame's host (`html.dark` is `:host(.dark)`, and the host is what scrolls)
 *   and, for its classes and attributes, the frame's body element too: `.dark { … }` and
 *   `.dark *` match inside the frame only there;
 * - `<body>` is the frame's body element.
 *
 * The host is the editor's element, placed by its classes and its inline style: the page's code
 * adds and removes its own classes there, never replaces the editor's, and its whole `style`
 * written at once (`style = "…"`, `setAttribute("style")`) is dropped. What it reads is read off
 * the frame's body element, which holds the frame's theme as an application's root does.
 *
 * Patched on the two elements themselves, not their prototypes: no other element pays for it.
 */

/** The frame's stand-ins for the document's elements. */
export interface FrameElements {
  readonly body: HTMLElement;
  readonly host: HTMLElement;
}

interface Targets {
  /** What its classes and attributes are written to. */
  readonly marked: readonly HTMLElement[];
  /** What its classes and attributes are read from. */
  readonly read: HTMLElement;
  /** What its `style` is. */
  readonly styled: HTMLElement;
  /** Whether its whole style may be written at once: not the host's, which places the frame. */
  readonly wholeStyle: boolean;
}

/** The classes the page's code put on each element: what replacing its classes takes off. */
const pageClasses = new WeakMap<HTMLElement, Set<string>>();
const classesOf = (element: HTMLElement) => {
  let classes = pageClasses.get(element);
  if (!classes) {
    classes = new Set();
    pageClasses.set(element, classes);
  }
  return classes;
};

const SPACE_RE = /\s+/;
const tokensOf = (value: string) => value.split(SPACE_RE).filter(Boolean);

const addClasses = (elements: readonly HTMLElement[], tokens: string[]) => {
  for (const element of elements) {
    element.classList.add(...tokens);
    for (const token of tokens) {
      classesOf(element).add(token);
    }
  }
};

const removeClasses = (elements: readonly HTMLElement[], tokens: string[]) => {
  for (const element of elements) {
    element.classList.remove(...tokens);
    for (const token of tokens) {
      classesOf(element).delete(token);
    }
  }
};

/** The page's classes replaced by `value`, the editor's left. */
const setClasses = (elements: readonly HTMLElement[], value: string) => {
  for (const element of elements) {
    removeClasses([element], [...classesOf(element)]);
  }
  addClasses(elements, tokensOf(value));
};

/** A `DOMTokenList` over the targets: written to each, read from one. */
const tokenListOver = ({ marked, read }: Targets): DOMTokenList => {
  const list = read.classList;
  const over = {
    add: (...tokens: string[]) => addClasses(marked, tokens),
    contains: (token: string) => list.contains(token),
    entries: () => list.entries(),
    forEach: (
      callback: (value: string, key: number, parent: DOMTokenList) => void,
      thisArg?: unknown
    ) => {
      list.forEach((value, key) => {
        callback.call(thisArg, value, key, over as unknown as DOMTokenList);
      });
    },
    item: (index: number) => list.item(index),
    keys: () => list.keys(),
    get length() {
      return list.length;
    },
    remove: (...tokens: string[]) => removeClasses(marked, tokens),
    replace: (token: string, next: string) => {
      const had = list.contains(token);
      if (had) {
        removeClasses(marked, [token]);
        addClasses(marked, [next]);
      }
      return had;
    },
    supports: () => false,
    toggle: (token: string, force?: boolean) => {
      const on = force ?? !list.contains(token);
      if (on) {
        addClasses(marked, [token]);
      } else {
        removeClasses(marked, [token]);
      }
      return on;
    },
    toString: () => list.value,
    get value() {
      return list.value;
    },
    set value(next: string) {
      setClasses(marked, next);
    },
    values: () => list.values(),
    [Symbol.iterator]: () => list[Symbol.iterator](),
  };
  return over as unknown as DOMTokenList;
};

/** A `dataset` over the targets: written to each, read from one. */
const datasetOver = ({ marked, read }: Targets): DOMStringMap =>
  new Proxy({} as DOMStringMap, {
    deleteProperty: (_target, key) => {
      for (const element of marked) {
        Reflect.deleteProperty(element.dataset, key);
      }
      return true;
    },
    get: (_target, key) => Reflect.get(read.dataset, key),
    getOwnPropertyDescriptor: (_target, key) =>
      Reflect.getOwnPropertyDescriptor(read.dataset, key),
    has: (_target, key) => Reflect.has(read.dataset, key),
    ownKeys: () => Reflect.ownKeys(read.dataset),
    set: (_target, key, value) => {
      for (const element of marked) {
        Reflect.set(element.dataset, key, value);
      }
      return true;
    },
  });

/** `property`'s own descriptor on `element` or the nearest of its prototypes. */
const descriptorOf = (element: object, property: string) => {
  for (
    let proto: object | null = element;
    proto;
    proto = Object.getPrototypeOf(proto)
  ) {
    const found = Object.getOwnPropertyDescriptor(proto, property);
    if (found) {
      return found;
    }
  }
};

/** An attribute method called by the page's code, on its frame's targets. */
const attributeOnFrame = (
  targets: Targets,
  name: (typeof ATTRIBUTE_METHODS)[number],
  args: unknown[]
): unknown => {
  const attribute = String(args[0]).toLowerCase();
  const { marked, read, styled, wholeStyle } = targets;
  if (name === "getAttribute" || name === "hasAttribute") {
    return (read[name] as (...a: unknown[]) => unknown).apply(read, args);
  }
  if (attribute === "class") {
    const on =
      name === "setAttribute" ||
      (name === "toggleAttribute" && (args[1] ?? !read.hasAttribute("class")));
    setClasses(marked, on ? String(args[1] ?? "") : "");
    return name === "toggleAttribute" ? Boolean(on) : undefined;
  }
  let onto = marked;
  if (attribute === "style") {
    onto = wholeStyle ? [styled] : [];
  }
  let answer: unknown;
  for (const target of onto) {
    answer = (target[name] as (...a: unknown[]) => unknown).apply(target, args);
  }
  return answer;
};

const ATTRIBUTE_METHODS = [
  "getAttribute",
  "hasAttribute",
  "removeAttribute",
  "setAttribute",
  "toggleAttribute",
] as const;

/** Puts what the preview's code writes to `element` on its frame's targets. */
const guardElement = (
  element: HTMLElement,
  targetsOf: (frame: FrameElements) => Targets,
  frameFor: (patched: object) => FrameElements | null
) => {
  const define = (property: string, descriptor: PropertyDescriptor) =>
    Object.defineProperty(element, property, {
      configurable: true,
      enumerable: descriptorOf(element, property)?.enumerable ?? true,
      ...descriptor,
    });
  const accessors = (
    property: string,
    onFrame: {
      get: (targets: Targets) => unknown;
      set?: (targets: Targets, value: unknown) => void;
    }
  ) => {
    const native = descriptorOf(element, property);
    const get = function (this: HTMLElement) {
      const frame = frameFor(get);
      return frame ? onFrame.get(targetsOf(frame)) : native?.get?.call(this);
    };
    const set = function (this: HTMLElement, value: unknown) {
      const frame = frameFor(set);
      if (!frame) {
        native?.set?.call(this, value);
      } else if (onFrame.set) {
        onFrame.set(targetsOf(frame), value);
      }
    };
    define(property, { get, set });
  };

  accessors("classList", {
    get: tokenListOver,
    set: (targets, value) => setClasses(targets.marked, String(value)),
  });
  accessors("className", {
    get: (targets) => targets.read.className,
    set: (targets, value) => setClasses(targets.marked, String(value)),
  });
  accessors("dataset", { get: datasetOver });
  accessors("style", {
    get: (targets) => targets.styled.style,
    set: (targets, value) => {
      if (targets.wholeStyle) {
        targets.styled.style.cssText = String(value);
      }
    },
  });
  for (const name of ATTRIBUTE_METHODS) {
    const native = element[name] as (...args: unknown[]) => unknown;
    const guarded = function (this: HTMLElement, ...args: unknown[]) {
      const frame = frameFor(guarded);
      return frame
        ? attributeOnFrame(targetsOf(frame), name, args)
        : native.apply(this, args);
    };
    define(name, { value: guarded, writable: true });
  }
};

/**
 * Puts what the preview's code writes to the document's `<html>` and `<body>` on its frame's,
 * once. `frameFor` is the frame whose code calls `patched`, or null for the editor's code.
 */
export const guardDocumentElements = (
  frameFor: (patched: object) => FrameElements | null
) => {
  guardElement(
    document.documentElement,
    (frame) => ({
      marked: [frame.host, frame.body],
      read: frame.body,
      styled: frame.host,
      wholeStyle: false,
    }),
    frameFor
  );
  guardElement(
    document.body,
    (frame) => ({
      marked: [frame.body],
      read: frame.body,
      styled: frame.body,
      wholeStyle: true,
    }),
    frameFor
  );
};
