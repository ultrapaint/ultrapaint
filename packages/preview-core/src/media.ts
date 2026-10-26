/**
 * The window's size, as the preview's own code asks for it, is the frame's (ADR 0034, 0036). A
 * stylesheet's media queries are turned into the frame's container queries (`frame-css.ts`);
 * this does the same for what a component asks in JavaScript: `matchMedia("(min-width: 768px)")`
 * and `innerWidth` answer for the frame the component is drawn in, and the query's listeners are
 * told when that frame is resized across it. Anything else (a hover, a colour scheme, the
 * editor's own code) is the window's, as it was.
 *
 * Which frame is asking is the one that is drawing (the renderer says so as it draws and as its
 * effects run) or the one that last took input: the same frame a popup is put in.
 */

import { containerCondition, FRAME_CONTAINER } from "./frame-css.ts";
import { calledFromPreview } from "./portals.ts";

/** This module's own file, whose frames on the stack are the patch, not who called it. */
const OWN = import.meta.url.split("?")[0] ?? "";
const PROBE_ATTRIBUTE = "data-ed-media";

/** One query asked in one frame: a `MediaQueryList` of the frame's size. */
class FrameQuery extends EventTarget {
  readonly media: string;
  onchange:
    | ((this: MediaQueryList, event: MediaQueryListEvent) => unknown)
    | null = null;
  readonly #read: () => boolean;
  #last: boolean;

  constructor(media: string, read: () => boolean) {
    super();
    this.media = media;
    this.#read = read;
    this.#last = read();
  }

  get matches(): boolean {
    this.#last = this.#read();
    return this.#last;
  }

  /** The frame was resized: its listeners are told when the answer changed. */
  recheck() {
    const before = this.#last;
    if (this.matches === before) {
      return;
    }
    const event = new Event("change") as Event & {
      matches: boolean;
      media: string;
    };
    Object.assign(event, { matches: this.#last, media: this.media });
    this.dispatchEvent(event);
    this.onchange?.call(
      this as unknown as MediaQueryList,
      event as unknown as MediaQueryListEvent
    );
  }

  /** What libraries written before `addEventListener` call. */
  addListener(listener: ((event: MediaQueryListEvent) => void) | null) {
    if (listener) {
      this.addEventListener("change", listener as EventListener);
    }
  }

  removeListener(listener: ((event: MediaQueryListEvent) => void) | null) {
    if (listener) {
      this.removeEventListener("change", listener as EventListener);
    }
  }
}

/** A frame's answers: its queries, the probe that evaluates them, and its size. */
interface FrameMedia {
  readonly host: HTMLElement;
  readonly probe: HTMLElement;
  readonly queries: Map<string, FrameQuery>;
  readonly sheet: HTMLStyleElement;
  /** Container conditions by query, each read off the probe as a custom property of its own. */
  readonly slots: Map<string, string>;
}

let current: FrameMedia | null = null;
let installed = false;

/**
 * Whether `condition` holds in the frame: the probe, inside it, gets a custom property from a
 * container query, so the browser evaluates the query exactly as it does the stylesheet's.
 */
const holds = (frame: FrameMedia, condition: string): boolean => {
  let slot = frame.slots.get(condition);
  if (slot === undefined) {
    slot = `--ed-media-${frame.slots.size}`;
    frame.slots.set(condition, slot);
    frame.sheet.textContent += `@container ${FRAME_CONTAINER} ${condition} { [${PROBE_ATTRIBUTE}] { ${slot}: 1; } }\n`;
  }
  return getComputedStyle(frame.probe).getPropertyValue(slot).trim() === "1";
};

/** The frame the preview's code is asking for, or null: the editor, or no frame drawing. */
const asking = (): FrameMedia | null =>
  current?.host.isConnected && calledFromPreview([OWN]) ? current : null;

const install = () => {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  const native = window.matchMedia.bind(window);
  window.matchMedia = (media: string): MediaQueryList => {
    const frame = asking();
    const condition = frame ? containerCondition(media) : null;
    if (!(frame && condition)) {
      return native(media);
    }
    let query = frame.queries.get(media);
    if (!query) {
      query = new FrameQuery(media, () => holds(frame, condition));
      frame.queries.set(media, query);
    }
    return query as unknown as MediaQueryList;
  };
  for (const [property, size] of [
    ["innerWidth", "clientWidth"],
    ["innerHeight", "clientHeight"],
  ] as const) {
    const descriptor =
      Object.getOwnPropertyDescriptor(window, property) ??
      Object.getOwnPropertyDescriptor(Window.prototype, property);
    const get = descriptor?.get;
    if (!get) {
      continue;
    }
    Object.defineProperty(window, property, {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      get(this: Window) {
        const frame = asking();
        return frame ? frame.host[size] : get.call(this);
      },
    });
  }
};

/**
 * Answers the window's size for `host`'s frame from now on. `shadow` is the frame's shadow root,
 * where the probe goes. Returns what says the frame is drawing, and what forgets it.
 */
export const frameMedia = (host: HTMLElement, shadow: ShadowRoot) => {
  install();
  const sheet = document.createElement("style");
  sheet.setAttribute(PROBE_ATTRIBUTE, "");
  const probe = document.createElement("div");
  probe.setAttribute(PROBE_ATTRIBUTE, "");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
  const frame: FrameMedia = {
    host,
    probe,
    queries: new Map(),
    sheet,
    slots: new Map(),
  };
  const place = () => {
    if (sheet.parentNode !== shadow) {
      shadow.append(sheet);
    }
    if (probe.parentNode !== shadow) {
      shadow.append(probe);
    }
  };
  place();
  let width = host.clientWidth;
  let height = host.clientHeight;
  const resize = new ResizeObserver(() => {
    if (host.clientWidth === width && host.clientHeight === height) {
      return;
    }
    width = host.clientWidth;
    height = host.clientHeight;
    for (const query of frame.queries.values()) {
      query.recheck();
    }
  });
  resize.observe(host);
  return {
    /** The frame is drawing or took input: what its code asks is about it. */
    asking: () => {
      current = frame;
    },
    /** Puts the probe back after the frame's content was replaced. */
    place,
    unmount: () => {
      resize.disconnect();
      if (current === frame) {
        current = null;
      }
    },
  };
};
