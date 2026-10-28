/**
 * Guards between the preview's code and the editor's page (`docs/PLAN-preview-sandbox.md`). The
 * repository's components run in the editor's own page (ADR 0034): one `window`, one `document`,
 * one URL. What an iframe kept apart is kept apart here at the few places the two meet, told by
 * the caller's stack, each guard by the rule of `provenance.ts` its purpose needs:
 *
 * - a listener the preview's code puts on `window` or `document` hears the keys, the pointer and
 *   the focus of its own frame only, never the editor's; it never hears the editor leave
 *   (`beforeunload`, `unload`) or move through its history (`popstate`, `hashchange`); and its
 *   `scroll` and `resize` are its frame's, the window's position answered by the frame while
 *   they run;
 * - `history` does not move the editor's address: a page pushed in a frame that takes input is
 *   the prototype following a link, anything else is dropped; `scrollTo` scrolls the frame;
 * - what goes into the head for the page's document (its `<title>`, its `<meta>`, its icons) and
 *   `document.title` are kept off the editor's, and the styles its code writes there reach its
 *   frames instead (`css-in-js.ts`);
 * - what the preview's code throws and nothing catches (in a handler, a timer, a promise) is told
 *   to its frame, which the editor shows, instead of going by in the editor's console only; a
 *   rejection is its frame's by the mark its `async` function put on it (the guard the preview's
 *   server puts in the repository's code), and the editor's alone when nothing says whose;
 * - an animation frame it asks for is its frame's, and waits while that frame is parked or off
 *   the screen: a loop on a page nobody sees costs the editor nothing; a timer it sets runs as
 *   its frame's, so what the timer throws or listens to is that frame's too;
 * - a request it makes to the editor's origin goes to the preview's server (`requests.ts`), its
 *   storage is its own (`storage.ts`), and what it writes to `<html>` and `<body>` is its frame's
 *   (`document-elements.ts`).
 *
 * Listeners, `on*` handlers, scroll, history and the head ask `windowCall`; timers and animation
 * frames `scheduling`; requests `request`; storage `storage`; `<html>` and `<body>` `domWrite`;
 * errors `thrownAt`. Which frame is the one whose turn it is (`turn.ts`), as for the window's
 * size and the popups; the kernel installs them, in its order (`kernel.ts`).
 */

import {
  GUARD_GLOBAL,
  installPageRuntime,
} from "@ultrapaint/contracts/page-runtime";
import { holdStyle, holdStyleFirst, isStyle } from "./css-in-js.ts";
import { addedNow, moduleEnds, moduleStarts } from "./hmr-leftovers.ts";
import { redirectInsertions } from "./insertions.ts";
import type { Provenance, ThrownAt } from "./provenance.ts";
import {
  askedFrame,
  carriedFrame,
  type Frame,
  type FrameError,
  frameOfHost,
  onlyFrame,
  relayedFrame,
  relaying,
  runAs,
  turnFrame,
} from "./turn.ts";

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

/**
 * Events about the editor's own page, never the preview's; `storage` tells of the editor's keys,
 * which the preview's storage is not (`storage.ts`).
 */
const DROPPED = new Set([
  "beforeunload",
  "hashchange",
  "popstate",
  "storage",
  "unload",
]);

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
  readonly owner: Frame | null;
  readonly target: EventTarget;
  readonly type: string;
}

const relayed = new Set<Relayed>();
/** The listener a guarded one was wrapped in, by target, type and capture. */
const wrapped = new WeakMap<object, Map<string, EventListener>>();
/** What the repository's `async` functions rejected with, by the frame they were called for. */
const marks = new WeakMap<object, Frame>();
const strayListeners = new Set<(error: FrameError) => void>();

/**
 * Whether a callback is the preview's, by who first scheduled it: a loop or a debounce hands the
 * same function again and again, and only the first time costs reading the stack.
 */
const previewCallbacks = new WeakMap<object, boolean>();

/** The frame a scheduling call is for: the one whose code runs, or null for the editor's. */
const schedulingFrame = (
  provenance: Provenance,
  patched: (...args: never[]) => unknown,
  callback: object
): Frame | null => {
  const carried = carriedFrame();
  const asked = askedFrame();
  if (carried || !asked) {
    return carried;
  }
  let isPreview = previewCallbacks.get(callback);
  if (isPreview === undefined) {
    isPreview = provenance.scheduling(patched);
    previewCallbacks.set(callback, isPreview);
  }
  return isPreview ? asked : null;
};

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
const frameOf = (event: Event): Frame | null => {
  for (const node of event.composedPath()) {
    const frame = frameOfHost(node);
    if (frame) {
      return frame;
    }
  }
  return null;
};

/** Tells `frame`'s window listeners of `type`, as the window would have. */
const relay = (frame: Frame, type: string) => {
  const event = new Event(type);
  relaying(frame, () => {
    for (const entry of [...relayed]) {
      if (
        entry.type === type &&
        (entry.owner === null || entry.owner === frame)
      ) {
        if (entry.once) {
          relayed.delete(entry);
        }
        runAs(frame, () => call(entry.listener, entry.target, event));
      }
    }
  });
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
    owner: askedFrame(),
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
  const owner = askedFrame();
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
    runAs(frame, () => call(listener, this, event));
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
export const guardListeners = (
  target: Window | Document,
  provenance: Provenance
) => {
  const add = target.addEventListener.bind(target) as Add;
  const remove = target.removeEventListener.bind(target) as Remove;
  target.addEventListener = (
    type: string,
    listener: Listener | null,
    options?: AddEventListenerOptions | boolean
  ) => {
    // Added by a module's top-level code, it goes when a newer version of the module runs.
    if (listener) {
      addedNow(() =>
        target.removeEventListener(type, listener, captureOf(options))
      );
    }
    if (
      !(
        listener &&
        provenance.windowCall() &&
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
export const guardHandlers = (provenance: Provenance) => {
  for (const type of DROPPED) {
    around(window, Window.prototype, `on${type}`, (get, set) => ({
      get,
      set: (value) => {
        if (!provenance.windowCall()) {
          set(value);
        }
      },
    }));
  }
};

/** While a frame's `scroll` is told, the window's position is the frame's. */
export const guardScroll = (provenance: Provenance) => {
  for (const [property, side] of [
    ["scrollY", "scrollTop"],
    ["pageYOffset", "scrollTop"],
    ["scrollX", "scrollLeft"],
    ["pageXOffset", "scrollLeft"],
  ] as const) {
    around(window, Window.prototype, property, (get) => ({
      get: () => {
        const told = relayedFrame();
        return told ? told.host[side] : get();
      },
    }));
  }
  for (const name of ["scroll", "scrollTo", "scrollBy"] as const) {
    const native = window[name].bind(window) as (...args: unknown[]) => void;
    window[name] = ((...args: unknown[]) => {
      if (!provenance.windowCall()) {
        native(...args);
        return;
      }
      // A frame that is a picture is not scrolled by its page; the editor never is.
      const frame = askedFrame();
      if (frame?.interactive()) {
        (frame.host[name] as (...a: unknown[]) => void)(...args);
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
export const guardHistory = (provenance: Provenance) => {
  const { history } = window;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (data, unused, url) => {
    if (!provenance.windowCall()) {
      push(data, unused, url);
      return;
    }
    const route = routeOf(url);
    const frame = askedFrame();
    if (route !== null && frame?.interactive()) {
      frame.navigate(route, false);
    }
  };
  history.replaceState = (data, unused, url) => {
    if (!provenance.windowCall()) {
      replace(data, unused, url);
    }
  };
  for (const name of ["back", "forward", "go"] as const) {
    const native = history[name].bind(history) as (...args: unknown[]) => void;
    history[name] = ((...args: unknown[]) => {
      if (!provenance.windowCall()) {
        native(...args);
      }
    }) as never;
  }
};

/**
 * The page's document's title, meta and icons are kept off the editor's head, and the styles its
 * code writes go where the frames get them from (`css-in-js.ts`).
 */
export const guardHead = (provenance: Provenance) => {
  /** Where they go instead: no document, so they do nothing, and their owner can remove them. */
  const aside = document.createElement("head");
  const documentOnly = (node: Node) =>
    node instanceof Element &&
    (DOCUMENT_ONLY.has(node.tagName) ||
      (node.tagName === "LINK" &&
        DOCUMENT_LINK_RE.test(node.getAttribute("rel") ?? "")));
  redirectInsertions(document.head, (node, at) => {
    if (isStyle(node) && provenance.windowCall()) {
      if (at === "first") {
        holdStyleFirst(node);
      } else {
        holdStyle(node, at);
      }
      return true;
    }
    if (!(documentOnly(node) && provenance.windowCall())) {
      return false;
    }
    if (at === "first") {
      aside.prepend(node);
    } else {
      aside.appendChild(node);
    }
    return true;
  });
  around(document, Document.prototype, "title", (get, set) => ({
    get,
    set: (value) => {
      if (!provenance.windowCall()) {
        set(value);
      }
    },
  }));
};

/**
 * What nothing caught, thrown in the preview's own modules: told to the frame it was thrown for.
 * A click's handler and a timer run as their frame's; a rejection is its frame's by the mark its
 * `async` function put on it, or, with one frame drawn, that frame's. A rejection nothing says
 * the frame of is not given to the frame that happens to be running when it surfaces: it is told
 * to the editor alone (`onStrayError`). The console still has it.
 */
export const reportUncaught = (provenance: Provenance) => {
  const told = (error: unknown, fallback: string) => {
    const stack = error instanceof Error ? error.stack : undefined;
    const where = provenance.thrownAt(stack);
    return where
      ? {
          error: {
            file: where.file,
            line: where.line,
            message: error instanceof Error ? error.message : fallback,
            stack,
          },
          where,
        }
      : null;
  };
  /** Told once its line is the source's. */
  const tell = (
    found: { error: FrameError; where: ThrownAt },
    to: (error: FrameError) => void
  ) => {
    const { error, where } = found;
    provenance.sourceLine(where).then(
      (line) => to({ ...error, line }),
      () => to(error)
    );
  };
  window.addEventListener("error", (event) => {
    const found = told(event.error, event.message);
    const frame = askedFrame();
    if (found && frame) {
      tell(found, frame.error);
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    const { reason } = event;
    const found = told(reason, String(reason));
    if (!found) {
      return;
    }
    const marked =
      typeof reason === "object" && reason !== null
        ? marks.get(reason)
        : undefined;
    const frame = marked ?? onlyFrame();
    tell(found, (error) => {
      if (frame) {
        frame.error(error);
        return;
      }
      for (const listener of strayListeners) {
        listener(error);
      }
    });
  });
};

/** Hears what the preview's code threw that no frame can be told of. */
export const onStrayError = (listener: (error: FrameError) => void) => {
  strayListeners.add(listener);
  return () => {
    strayListeners.delete(listener);
  };
};

/**
 * What the guard in the repository's code asks (`virtual:ultrapaint/guard`): the frame an
 * `async` function is called for, and the mark on what it rejects with.
 */
export const answerGuard = () => {
  installPageRuntime<Frame>({
    [GUARD_GLOBAL]: {
      frame: turnFrame,
      mark: (error, frame) => {
        if (!marks.has(error)) {
          marks.set(error, frame);
        }
      },
      moduleEnds,
      moduleStarts,
    },
  });
};

// ---- Animation frames and timers ----

/** Ids of the animation frames asked for by the preview: apart from the browser's own. */
const FIRST_FRAME_ID = 2 ** 30;
let nextFrameId = FIRST_FRAME_ID;
/** An animation frame the preview's code asked for: the browser's, or held while unseen. */
interface Scheduled {
  readonly callback: FrameRequestCallback;
  readonly frame: Frame;
  native: number | null;
}
const scheduled = new Map<number, Scheduled>();
/** Frames off the screen or parked: their animation frames wait. */
const unseen = new WeakSet<Frame>();
let nativeFrame: typeof requestAnimationFrame = (callback) =>
  requestAnimationFrame(callback);
let nativeCancel: typeof cancelAnimationFrame = (id) =>
  cancelAnimationFrame(id);

/** Asks the browser for `id`'s animation frame, or holds it while its frame is unseen. */
const place = (id: number, entry: Scheduled) => {
  if (unseen.has(entry.frame)) {
    entry.native = null;
    return;
  }
  entry.native = nativeFrame((time) => {
    if (scheduled.get(id) !== entry) {
      return;
    }
    if (unseen.has(entry.frame)) {
      entry.native = null;
      return;
    }
    scheduled.delete(id);
    runAs(entry.frame, () => entry.callback(time));
  });
};

/** `frame` is seen again: what it held is asked for. */
const release = (frame: Frame) => {
  for (const [id, entry] of scheduled) {
    if (entry.frame === frame && entry.native === null) {
      place(id, entry);
    }
  }
};

export const guardAnimationFrames = (provenance: Provenance) => {
  nativeFrame = window.requestAnimationFrame.bind(window);
  nativeCancel = window.cancelAnimationFrame.bind(window);
  const request = (callback: FrameRequestCallback): number => {
    const frame = schedulingFrame(provenance, request, callback);
    if (!frame) {
      return nativeFrame(callback);
    }
    nextFrameId += 1;
    const entry: Scheduled = { callback, frame, native: null };
    scheduled.set(nextFrameId, entry);
    place(nextFrameId, entry);
    return nextFrameId;
  };
  window.requestAnimationFrame = request;
  window.cancelAnimationFrame = (id: number) => {
    const entry = scheduled.get(id);
    if (!entry) {
      nativeCancel(id);
      return;
    }
    scheduled.delete(id);
    if (entry.native !== null) {
      nativeCancel(entry.native);
    }
  };
};

/** A timer the preview's code sets runs as its frame's code. */
export const guardTimers = (provenance: Provenance) => {
  for (const name of ["setTimeout", "setInterval"] as const) {
    const native = window[name].bind(window) as (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => number;
    const set = (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): number => {
      const frame =
        typeof handler === "function"
          ? schedulingFrame(provenance, set, handler)
          : null;
      const run = handler as (...a: unknown[]) => unknown;
      const id = frame
        ? native(
            (...a: unknown[]) => runAs(frame, () => run(...a)),
            timeout,
            ...args
          )
        : native(handler, timeout, ...args);
      // Started by a module's top-level code, it stops when a newer version of the module runs.
      if (name === "setInterval") {
        addedNow(() => clearInterval(id));
      }
      return id;
    };
    window[name] = set as never;
  }
};

/**
 * Guards `frame` from now on: its `scroll` and `resize` are told to its listeners, its animation
 * frames wait while it is not seen. Returns what forgets it.
 */
export const guardFrame = (frame: Frame) => {
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
  // Off the screen or parked, it is not seen: its animation frames wait until it is.
  const seen = new IntersectionObserver(([entry]) => {
    if (frame.still || entry?.isIntersecting) {
      unseen.delete(frame);
      release(frame);
    } else {
      unseen.add(frame);
    }
  });
  seen.observe(frame.host);
  return {
    unmount: () => {
      resize.disconnect();
      seen.disconnect();
      for (const [id, entry] of scheduled) {
        if (entry.frame === frame) {
          scheduled.delete(id);
          if (entry.native !== null) {
            nativeCancel(entry.native);
          }
        }
      }
      frame.host.removeEventListener("scroll", onScroll);
      for (const entry of relayed) {
        if (entry.owner === frame) {
          relayed.delete(entry);
        }
      }
    },
  };
};
