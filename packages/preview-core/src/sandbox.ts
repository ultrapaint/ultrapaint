/**
 * Guards between the preview's code and the editor's page (`docs/PLAN-preview-sandbox.md`). The
 * repository's components run in the editor's own page (ADR 0034): one `window`, one `document`,
 * one URL. What an iframe kept apart is kept apart here at the few places the two meet, told by
 * the caller's stack as `portals.ts` does:
 *
 * - a listener the preview's code puts on `window` or `document` hears the keys, the pointer and
 *   the focus of its own frame only, never the editor's; it never hears the editor leave
 *   (`beforeunload`, `unload`) or move through its history (`popstate`, `hashchange`); and its
 *   `scroll` and `resize` are its frame's, the window's position answered by the frame while
 *   they run;
 * - `history` does not move the editor's address: a page pushed in a frame that takes input is
 *   the prototype following a link, anything else is dropped; `scrollTo` scrolls the frame;
 * - what goes into the head for the page's document (its `<title>`, its `<meta>`, its icons) and
 *   `document.title` are kept off the editor's;
 * - what the preview's code throws and nothing catches (in a handler, a timer, a promise) is told
 *   to its frame, which the editor shows, instead of going by in the editor's console only.
 *
 * Which frame is the one that was drawing or took input, as `media.ts` tells the window's size.
 */
import { calledFromPreview, thrownInPreview } from "./portals.ts";

/** This module's own file, whose frames on the stack are the patch, not who called it. */
const OWN = import.meta.url.split("?")[0] ?? "";

/** What a frame is told of an error its page's code threw. */
export interface FrameError {
  readonly file?: string | undefined;
  readonly line?: number | undefined;
  readonly message: string;
  readonly stack?: string | undefined;
}

/** A frame as the guards know it. */
export interface GuardedFrame {
  /** The frame is asked about: what its code reads of the window answers for it. */
  readonly asking: () => void;
  /** Its page's code threw and nothing caught it. */
  readonly error: (error: FrameError) => void;
  readonly host: HTMLElement;
  /** The frame takes input: the prototype, interact mode. */
  readonly interactive: () => boolean;
  /** A page the frame's code pushed: the prototype follows it. */
  readonly navigate: (route: string, replace: boolean) => void;
}

/** Events of the page's own input: heard from inside a frame only. */
const FRAME_INPUT = new Set([
  "auxclick",
  "beforeinput",
  "change",
  "click",
  "compositionend",
  "compositionstart",
  "compositionupdate",
  "contextmenu",
  "copy",
  "cut",
  "dblclick",
  "drag",
  "dragend",
  "dragenter",
  "dragleave",
  "dragover",
  "dragstart",
  "drop",
  "focusin",
  "focusout",
  "input",
  "keydown",
  "keypress",
  "keyup",
  "mousedown",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "paste",
  "pointercancel",
  "pointerdown",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerup",
  "submit",
  "touchcancel",
  "touchend",
  "touchmove",
  "touchstart",
  "wheel",
]);

/** Events about the editor's own page, never the preview's. */
const DROPPED = new Set(["beforeunload", "hashchange", "popstate", "unload"]);

/** Events of the window the frame stands for, told from the frame's host. */
const RELAYED = new Set(["resize", "scroll"]);

/** Head elements that describe the page's document, which the editor's page is not. */
const DOCUMENT_ONLY = new Set(["BASE", "META", "TITLE"]);
const DOCUMENT_LINK_RE =
  /(?:^|\s)(?:apple-touch-icon|canonical|icon|manifest|mask-icon)(?:\s|$)/i;

type Listener = EventListenerOrEventListenerObject;

interface Relayed {
  readonly listener: Listener;
  readonly once: boolean;
  /** The frame that was drawing when it was added; null for any. */
  readonly owner: GuardedFrame | null;
  readonly target: EventTarget;
  readonly type: string;
}

const frames = new Map<HTMLElement, GuardedFrame>();
const relayed = new Set<Relayed>();
/** The listener a guarded one was wrapped in, by target, type and capture. */
const wrapped = new WeakMap<object, Map<string, EventListener>>();
let current: GuardedFrame | null = null;
/** The frame whose `scroll` or `resize` is being told: the window's position is its. */
let telling: GuardedFrame | null = null;
let installed = false;
let fromPreview = () => calledFromPreview([OWN]);
let thrownIn = thrownInPreview;

const call = (listener: Listener, self: unknown, event: Event) => {
  if (typeof listener === "function") {
    listener.call(self, event);
  } else {
    listener.handleEvent(event);
  }
};

const captureOf = (options?: AddEventListenerOptions | boolean) =>
  typeof options === "boolean" ? options : Boolean(options?.capture);

const keyOf = (target: EventTarget, type: string, capture: boolean) =>
  `${target === window ? "w" : "d"}:${type}:${capture ? 1 : 0}`;

/** The frame an event comes from: the frame host on its path. */
const frameOf = (event: Event): GuardedFrame | null => {
  for (const node of event.composedPath()) {
    const frame = frames.get(node as HTMLElement);
    if (frame) {
      return frame;
    }
  }
  return null;
};

/** Tells `frame`'s window listeners of `type`, as the window would have. */
const relay = (frame: GuardedFrame, type: string) => {
  const event = new Event(type);
  const before = telling;
  telling = frame;
  frame.asking();
  try {
    for (const entry of [...relayed]) {
      if (
        entry.type === type &&
        (entry.owner === null || entry.owner === frame)
      ) {
        if (entry.once) {
          relayed.delete(entry);
        }
        call(entry.listener, entry.target, event);
      }
    }
  } finally {
    telling = before;
  }
};

const findRelayed = (target: EventTarget, type: string, listener: Listener) =>
  [...relayed].find(
    (e) => e.target === target && e.type === type && e.listener === listener
  );

type Add = (
  type: string,
  listener: Listener | null,
  options?: AddEventListenerOptions | boolean
) => void;
type Remove = (
  type: string,
  listener: Listener | null,
  options?: EventListenerOptions | boolean
) => void;

/** A `scroll` or `resize` of the window the preview's code listens to: its frame's, told. */
const relayListener = (
  target: EventTarget,
  type: string,
  listener: Listener,
  options?: AddEventListenerOptions | boolean
) => {
  if (findRelayed(target, type, listener)) {
    return;
  }
  const entry: Relayed = {
    listener,
    once: typeof options === "object" && Boolean(options.once),
    owner: current,
    target,
    type,
  };
  relayed.add(entry);
  if (typeof options === "object") {
    options.signal?.addEventListener("abort", () => relayed.delete(entry));
  }
};

/** An input listener of the preview's code: called for its own frame's events only. */
const guardInput = (
  native: { add: Add; remove: Remove; target: EventTarget },
  type: string,
  listener: Listener,
  options?: AddEventListenerOptions | boolean
) => {
  const owner = current;
  const capture = captureOf(options);
  const byKey = wrapped.get(listener) ?? new Map<string, EventListener>();
  wrapped.set(listener, byKey);
  const key = keyOf(native.target, type, capture);
  if (byKey.has(key)) {
    return;
  }
  // `once` counts the events the frame hears, not the editor's the guard lets go by.
  const once = typeof options === "object" && Boolean(options.once);
  const forget = () => {
    byKey.delete(key);
    native.remove(type, guarded, capture);
  };
  const guarded = function (this: unknown, event: Event) {
    const frame = frameOf(event);
    if (!frame || (owner !== null && owner !== frame)) {
      return;
    }
    if (once) {
      forget();
    }
    frame.asking();
    call(listener, this, event);
  };
  byKey.set(key, guarded);
  native.add(
    type,
    guarded,
    typeof options === "object" ? { ...options, once: false } : options
  );
  if (typeof options === "object") {
    options.signal?.addEventListener("abort", forget);
  }
};

/** Puts a listener the preview's code adds to `window` or `document` behind the guard. */
const guardListeners = (target: Window | Document) => {
  const add = target.addEventListener.bind(target) as Add;
  const remove = target.removeEventListener.bind(target) as Remove;
  target.addEventListener = (
    type: string,
    listener: Listener | null,
    options?: AddEventListenerOptions | boolean
  ) => {
    if (
      !(
        listener &&
        fromPreview() &&
        (DROPPED.has(type) || RELAYED.has(type) || FRAME_INPUT.has(type))
      )
    ) {
      add(type, listener, options);
    } else if (RELAYED.has(type)) {
      relayListener(target, type, listener, options);
    } else if (FRAME_INPUT.has(type)) {
      guardInput({ add, remove, target }, type, listener, options);
    }
  };
  target.removeEventListener = (
    type: string,
    listener: Listener | null,
    options?: EventListenerOptions | boolean
  ) => {
    if (!listener) {
      remove(type, listener, options);
      return;
    }
    const entry = findRelayed(target, type, listener);
    if (entry) {
      relayed.delete(entry);
      return;
    }
    const key = keyOf(target, type, captureOf(options));
    const guarded = wrapped.get(listener)?.get(key);
    if (guarded) {
      wrapped.get(listener)?.delete(key);
      remove(type, guarded, options);
      return;
    }
    remove(type, listener, options);
  };
};

/** Defines `property` of `target` anew around its own accessor. */
const around = (
  target: object,
  proto: object,
  property: string,
  make: (
    get: () => unknown,
    set: (value: unknown) => void
  ) => PropertyDescriptor
) => {
  const descriptor =
    Object.getOwnPropertyDescriptor(target, property) ??
    Object.getOwnPropertyDescriptor(proto, property);
  if (!descriptor?.get) {
    return;
  }
  const { get, set } = descriptor;
  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    ...make(
      () => get.call(target),
      (value) => set?.call(target, value)
    ),
  });
};

/** The window's handlers the preview's code may not set: the editor's leaving and history. */
const guardHandlers = () => {
  for (const type of DROPPED) {
    around(window, Window.prototype, `on${type}`, (get, set) => ({
      get,
      set: (value) => {
        if (!fromPreview()) {
          set(value);
        }
      },
    }));
  }
};

/** While a frame's `scroll` is told, the window's position is the frame's. */
const guardScroll = () => {
  for (const [property, side] of [
    ["scrollY", "scrollTop"],
    ["pageYOffset", "scrollTop"],
    ["scrollX", "scrollLeft"],
    ["pageXOffset", "scrollLeft"],
  ] as const) {
    around(window, Window.prototype, property, (get) => ({
      get: () => (telling ? telling.host[side] : get()),
    }));
  }
  for (const name of ["scroll", "scrollTo", "scrollBy"] as const) {
    const native = window[name].bind(window) as (...args: unknown[]) => void;
    window[name] = ((...args: unknown[]) => {
      if (!fromPreview()) {
        native(...args);
        return;
      }
      // A frame that is a picture is not scrolled by its page; the editor never is.
      if (current?.interactive()) {
        (current.host[name] as (...a: unknown[]) => void)(...args);
      }
    }) as never;
  }
};

/**
 * A path pushed by the page's code: an absolute path or a URL of this origin; a query or a hash
 * alone says nothing about the page.
 */
const routeOf = (url: string | URL | null | undefined): string | null => {
  if (url === null || url === undefined) {
    return null;
  }
  const text = String(url);
  if (!(text.startsWith("/") || text.startsWith(location.origin))) {
    return null;
  }
  const parsed = new URL(text, location.origin);
  return parsed.origin === location.origin ? parsed.pathname : null;
};

/** The page's code never moves the editor's address or its history. */
const guardHistory = () => {
  const { history } = window;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (data, unused, url) => {
    if (!fromPreview()) {
      push(data, unused, url);
      return;
    }
    const route = routeOf(url);
    if (route !== null && current?.interactive()) {
      current.navigate(route, false);
    }
  };
  history.replaceState = (data, unused, url) => {
    if (!fromPreview()) {
      replace(data, unused, url);
    }
  };
  for (const name of ["back", "forward", "go"] as const) {
    const native = history[name].bind(history) as (...args: unknown[]) => void;
    history[name] = ((...args: unknown[]) => {
      if (!fromPreview()) {
        native(...args);
      }
    }) as never;
  }
};

/** The page's document's title, meta and icons are kept off the editor's head. */
const guardHead = () => {
  const { head } = document;
  /** Where they go instead: no document, so they do nothing, and their owner can remove them. */
  const aside = document.createElement("head");
  const keptAside = (node: unknown): node is Element =>
    node instanceof Element &&
    (DOCUMENT_ONLY.has(node.tagName) ||
      (node.tagName === "LINK" &&
        DOCUMENT_LINK_RE.test(node.getAttribute("rel") ?? ""))) &&
    fromPreview();
  const appendChild = head.appendChild.bind(head);
  const insertBefore = head.insertBefore.bind(head);
  const append = head.append.bind(head);
  const prepend = head.prepend.bind(head);
  Object.assign(head, {
    append(...nodes: (Node | string)[]) {
      if (nodes.length === 1 && keptAside(nodes[0])) {
        aside.append(nodes[0]);
        return;
      }
      append(...nodes);
    },
    appendChild<T extends Node>(node: T): T {
      return keptAside(node) ? aside.appendChild(node) : appendChild(node);
    },
    insertBefore<T extends Node>(node: T, child: Node | null): T {
      return keptAside(node)
        ? aside.appendChild(node)
        : insertBefore(node, child);
    },
    prepend(...nodes: (Node | string)[]) {
      if (nodes.length === 1 && keptAside(nodes[0])) {
        aside.prepend(nodes[0]);
        return;
      }
      prepend(...nodes);
    },
  });
  around(document, Document.prototype, "title", (get, set) => ({
    get,
    set: (value) => {
      if (!fromPreview()) {
        set(value);
      }
    },
  }));
};

/**
 * What nothing caught: told to the frame that was drawing or took input when it was thrown in the
 * preview's own modules. A click's handler is the clicked frame's; a timer's, the frame's that
 * last drew. The console still has it.
 */
const reportUncaught = () => {
  const report = (error: unknown, fallback: string) => {
    const stack = error instanceof Error ? error.stack : undefined;
    const where = thrownIn(stack);
    if (!(where && current)) {
      return;
    }
    current.error({
      file: where.file,
      line: where.line,
      message: error instanceof Error ? error.message : fallback,
      stack,
    });
  };
  window.addEventListener("error", (event) =>
    report(event.error, event.message)
  );
  window.addEventListener("unhandledrejection", (event) =>
    report(event.reason, String(event.reason))
  );
};

/**
 * Puts the guards in place, once. By default the stack says whether the code calling is the
 * preview's, and where an error was thrown, as `portals.ts` reads it; tests say it instead.
 */
export const installGuards = (test?: {
  readonly caller: () => boolean;
  readonly thrown: typeof thrownInPreview;
}) => {
  if (test) {
    fromPreview = test.caller;
    thrownIn = test.thrown;
  }
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  reportUncaught();
  guardListeners(window);
  guardListeners(document);
  guardHandlers();
  guardScroll();
  guardHistory();
  guardHead();
};

/**
 * Guards `frame` from now on. Returns what says it is the frame being asked about (drawing, or
 * taking input), and what forgets it.
 */
export const guardFrame = (frame: GuardedFrame) => {
  frames.set(frame.host, frame);
  const onScroll = () => relay(frame, "scroll");
  frame.host.addEventListener("scroll", onScroll, { passive: true });
  let width = frame.host.clientWidth;
  let height = frame.host.clientHeight;
  const resize = new ResizeObserver(() => {
    const { clientHeight, clientWidth } = frame.host;
    if (clientWidth === width && clientHeight === height) {
      return;
    }
    width = clientWidth;
    height = clientHeight;
    relay(frame, "resize");
  });
  resize.observe(frame.host);
  return {
    asking: () => {
      current = frame;
    },
    unmount: () => {
      resize.disconnect();
      frame.host.removeEventListener("scroll", onScroll);
      frames.delete(frame.host);
      for (const entry of relayed) {
        if (entry.owner === frame) {
          relayed.delete(entry);
        }
      }
      if (current === frame) {
        current = null;
      }
    },
  };
};
