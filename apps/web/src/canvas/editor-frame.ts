/**
 * The frames the editor draws pages in, shadow roots of its own page (ADR 0034): a frame of the
 * canvas, the prototype, the type samples, a component's matrix, the pictures. `frameOf(id)` is
 * the one handle on frame `id`; it opens the frame (`open`: its host, with `data-ed-frame-host`,
 * drawn by the preview), says what it says (`listen`, one listener per kind), tells it what to draw
 * (`render`, which skips what it shows already) and asks it what is where, answered at once
 * (`hitTest`, `measure`, `tokens`).
 *
 * The handle outlives the frame it speaks to. What it was asked to keep (the nodes it watches,
 * the skeletons, whether it takes input, its title) is told again to the frame opened next, so a
 * caller says it once whether or not the frame is drawn yet.
 *
 * A frame opened with `keep` (the canvas's) is parked when it is closed rather than thrown away
 * (ADR 0033, 0034): a frame that leaves the screen, a canvas switched away from or the prototype
 * opened takes its frames off the canvas, and a frame that comes back takes its own again, as it
 * was: nothing to draw again, nothing blank. Parked, a host is skipped by the browser
 * (`content-visibility: hidden`) and keeps the size it had, so nothing inside is laid out again.
 * Only so many are kept: the one not seen for longest goes first. New frames draw a few at a time
 * (`mounting.ts`), the nearest to the middle of the screen first: `isWarm` and `onPoolChange` say
 * which have drawn.
 *
 * A frame whose page froze the editor the last time it ran (`watchdog.ts`) is not opened: the
 * caller shows `FrozenPage` (`useFrameFrozen`), whose button draws it anyway.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { PageDefaults } from "@ultrapaint/contracts/pages";
import type { RenderMode } from "@ultrapaint/contracts/preview";
import type {
  FrameEvents,
  FrameRect,
  FrameRuntime,
  Preview,
} from "@ultrapaint/framework-api/browser";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { DesignLook } from "../state/look.ts";
import { tryNextTime, useFrozen } from "./watchdog.ts";

/** How many frames stay drawn while they are off the canvas. */
export const PARKED_MAX = 32;

/** How many new frames draw at once. */
export const LOADING_MAX = 3;

/** A frame that takes longer than this to draw is taken as drawn: it does not hold the queue. */
const LOAD_TIMEOUT_MS = 10_000;

/** What a frame says, a listener per kind (`FrameEvents`), and when it can be told what to draw. */
export interface FrameListeners extends FrameEvents {
  /**
   * The frame is open and answers: told to a listener as it starts listening to an open frame,
   * and to every listener when the frame is opened anew.
   */
  readonly ready?: () => void;
}

/** What a frame is told to draw. */
export interface RenderRequest {
  /** What the canvas draws every page in (`CanvasLayout.defaults`). */
  readonly defaults?: PageDefaults | undefined;
  readonly designSystem: DesignSystem | null;
  /** The design's look over the code's (ADR 0028, 0029); the current one when left out. */
  readonly look?: DesignLook;
  readonly message?: string;
  readonly mode: RenderMode;
  readonly root: DesignNode | null;
}

export interface OpenOptions {
  /** Whose images relative paths are: a canvas's own, else the shared ones. */
  readonly canvas: string;
  readonly className?: string;
  /** Where the host goes. */
  readonly holder: HTMLElement;
  /** Parked when closed, for when it comes back: the canvas's frames. Otherwise thrown away. */
  readonly keep?: boolean;
  readonly preview: Preview;
  /**
   * A frozen frame is not drawn now and is tried again at the next load, rather than waiting to
   * be asked: the pictures, which nobody sees.
   */
  readonly retryFrozenNextLoad?: boolean;
  /** Drawn at once, without transitions: what pictures are taken of. */
  readonly still?: boolean;
  /** The host's own style, written whenever it is opened. */
  readonly style?: string;
}

/** A frame opened in a holder, until `close`. */
export interface OpenedFrame {
  /** Parks the frame (opened with `keep`, and drawn) or throws it away. */
  readonly close: () => void;
  readonly host: HTMLElement;
}

/** A frame drawn by the preview, in the pool. */
interface Mount {
  readonly canvas: string;
  /** It has drawn since it was opened. */
  drawn: boolean;
  readonly host: HTMLElement;
  readonly keep: boolean;
  /** In a holder; false while parked. */
  placed: boolean;
  readonly preview: Preview;
  readonly runtime: FrameRuntime;
  /** When it was last placed or parked, for the oldest to go first. */
  touched: number;
}

/** How a frame's host is shown. */
interface ShownAs {
  /** Off the screen: kept as it is, and skipped by the browser. */
  away: boolean;
  /** The page takes input; otherwise the pointer goes past it. */
  interactive: boolean;
  /** What the frame is read by. */
  title: string;
}

/** What the frame was last told to draw, by which runtime. */
interface Shown {
  readonly defaults: PageDefaults | undefined;
  readonly designSystem: DesignSystem | null;
  readonly message: string | undefined;
  readonly mode: RenderMode;
  readonly renderId: number;
  readonly root: DesignNode | null;
  readonly runtime: FrameRuntime;
  readonly specs: DesignLook["specs"];
  readonly styles: DesignLook["styles"];
}

/**
 * Where the design's look comes from when a render does not say: the app hands it the stores'
 * at startup, which keeps the frames free of them.
 */
const NO_LOOK: DesignLook = { specs: [], styles: "" };
let currentLook = (): DesignLook => NO_LOOK;
export const provideDesignLook = (look: () => DesignLook) => {
  currentLook = look;
};

const frames = new Map<string, EditorFrame>();
const poolListeners = new Set<() => void>();
let renders = 0;
let clock = 0;
let parking: HTMLElement | null = null;

const poolChanged = () => {
  for (const listener of poolListeners) {
    listener();
  }
};

/** Out of sight, and skipped by the browser: nothing in it is laid out or painted. */
const parkingLot = () => {
  if (!parking) {
    parking = document.createElement("div");
    parking.setAttribute("aria-hidden", "true");
    parking.dataset.previewParking = "";
    parking.style.cssText =
      "position:fixed;left:-100000px;top:0;content-visibility:hidden;pointer-events:none";
    document.body.append(parking);
  }
  return parking;
};

/** Drops the parked frames beyond `PARKED_MAX`, the least recently seen first. */
const trim = () => {
  const parked = [...frames.values()]
    .filter((f) => f.parkedAt() !== null)
    .sort((a, b) => (a.parkedAt() ?? 0) - (b.parkedAt() ?? 0));
  for (const frame of parked.slice(
    0,
    Math.max(0, parked.length - PARKED_MAX)
  )) {
    frame.drop();
  }
};

/** What `pnpm bench:canvas` times frames by, in development. */
const tellBench = (frame: string, kind: keyof FrameListeners) => {
  if (import.meta.env.DEV && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("ed:frame", { detail: { frame, type: `ed:${kind}` } })
    );
  }
};

export class EditorFrame {
  readonly id: string;
  private mount: Mount | null = null;
  private shown: Shown | null = null;
  private readonly listeners = new Set<FrameListeners>();
  /** What the frame is to keep up to date, told again to a frame opened later. */
  private watched: readonly string[] = [];
  private skeletons: readonly string[] = [];
  /** How its host is shown, told again to a frame opened later. */
  private readonly shownAs: ShownAs = {
    away: false,
    interactive: false,
    title: "",
  };
  /** The last render the frame said it drew; what it is told again it does not draw again. */
  private rendered = 0;

  constructor(id: string) {
    this.id = id;
  }

  /** The frame is open and answers. */
  get ready() {
    return this.mount !== null;
  }

  /** The last render the frame said it drew. */
  get renderedId() {
    return this.rendered;
  }

  /** It has drawn since it was opened: it shows at once when placed. */
  get warm() {
    return this.mount?.drawn === true;
  }

  /** When it was parked, or null while it is placed or not open. */
  parkedAt(): number | null {
    return this.mount && !this.mount.placed ? this.mount.touched : null;
  }

  /**
   * Puts the frame's host in `options.holder`: the one kept for it when it was opened with the
   * same preview and canvas, moved there as it is, or a new one drawn by the preview. Null when
   * the frame froze the editor before.
   */
  open(options: OpenOptions): OpenedFrame | null {
    if (useFrozen.getState().frames.has(this.id)) {
      if (options.retryFrozenNextLoad) {
        tryNextTime(this.id);
      }
      return null;
    }
    let m = this.mount;
    if (m && (m.preview !== options.preview || m.canvas !== options.canvas)) {
      this.drop();
      m = null;
    }
    clock += 1;
    if (m) {
      m.placed = true;
      m.touched = clock;
      this.present(m.host, options);
      if (m.host.parentElement !== options.holder) {
        options.holder.append(m.host);
      }
    } else {
      m = this.mountIn(options);
    }
    const opened = m;
    return {
      close: () => {
        if (this.mount === opened) {
          this.close();
        }
      },
      host: m.host,
    };
  }

  private mountIn(options: OpenOptions): Mount {
    const host = document.createElement("div");
    host.dataset.edFrameHost = this.id;
    this.present(host, options);
    options.holder.append(host);
    // What the runtime says before `mountFrame` returns is heard, not counted as its drawing.
    let mounted: Mount | null = null;
    const runtime = options.preview.mountFrame(host, {
      canvas: options.canvas,
      events: this.eventsOf(() => mounted),
      frame: this.id,
      ...(options.still && { still: true }),
    });
    const m: Mount = {
      canvas: options.canvas,
      drawn: false,
      host,
      keep: options.keep === true,
      placed: true,
      preview: options.preview,
      runtime,
      touched: clock,
    };
    mounted = m;
    this.mount = m;
    this.shown = null;
    if (this.watched.length > 0) {
      runtime.watchRects(this.watched);
    }
    if (this.skeletons.length > 0) {
      runtime.skeleton(this.skeletons);
    }
    if (this.shownAs.interactive) {
      runtime.setInteractive(true);
    }
    // A frame that never says it drew (a page that throws before it draws) does not hold the
    // queue.
    setTimeout(() => this.drewOn(m), LOAD_TIMEOUT_MS);
    if (this.listeners.size > 0) {
      tellBench(this.id, "ready");
      for (const l of this.listeners) {
        l.ready?.();
      }
    }
    return m;
  }

  /** The host's class, style, title and input as they are asked for now. */
  private present(host: HTMLElement, options: OpenOptions) {
    host.className = options.className ?? "";
    host.style.cssText = options.style ?? "";
    host.title = this.shownAs.title;
    host.style.pointerEvents = this.shownAs.interactive ? "auto" : "none";
    host.style.contentVisibility = this.shownAs.away ? "hidden" : "";
  }

  /** What a mount's runtime tells the frame, for its listeners. */
  private eventsOf(mount: () => Mount | null): FrameEvents {
    const tell = (
      kind: keyof FrameEvents,
      call: (l: FrameListeners) => void
    ) => {
      tellBench(this.id, kind);
      for (const l of this.listeners) {
        call(l);
      }
    };
    return {
      error: (error) => {
        this.drewOn(mount());
        tell("error", (l) => l.error?.(error));
      },
      hmr: () => tell("hmr", (l) => l.hmr?.()),
      instances: (instances) =>
        tell("instances", (l) => l.instances?.(instances)),
      navigateTo: (route, replace) =>
        tell("navigateTo", (l) => l.navigateTo?.(route, replace)),
      pressed: (nodeIds) => tell("pressed", (l) => l.pressed?.(nodeIds)),
      rects: (rects) => tell("rects", (l) => l.rects?.(rects)),
      rendered: (renderId) => {
        this.rendered = Math.max(this.rendered, renderId);
        this.drewOn(mount());
        tell("rendered", (l) => l.rendered?.(renderId));
      },
      size: (size) => tell("size", (l) => l.size?.(size)),
      textCommit: (nodeId, text) =>
        tell("textCommit", (l) => l.textCommit?.(nodeId, text)),
    };
  }

  /** The mount has drawn: it no longer holds a place in the queue. */
  private drewOn(m: Mount | null) {
    if (m !== null && this.mount === m && !m.drawn) {
      m.drawn = true;
      m.host.dataset.edDrawn = "";
      poolChanged();
    }
  }

  /**
   * Takes the frame out of its holder. One opened with `keep` that has drawn is parked, drawn,
   * for when it comes back; any other is thrown away, so one still drawing does not hold the
   * queue for a frame no longer wanted.
   */
  private close() {
    const m = this.mount;
    if (!m) {
      return;
    }
    if (!(m.keep && m.drawn)) {
      this.drop();
      return;
    }
    // Kept at the size it was drawn at: the page inside is not laid out again.
    m.host.style.width = `${m.host.offsetWidth}px`;
    m.host.style.height = `${m.host.offsetHeight}px`;
    m.placed = false;
    clock += 1;
    m.touched = clock;
    parkingLot().append(m.host);
    trim();
  }

  /** Throws the frame's page away; what it was asked to keep stays for the next. */
  drop() {
    const m = this.mount;
    if (!m) {
      return;
    }
    this.mount = null;
    this.shown = null;
    m.runtime.unmount();
    m.host.remove();
    poolChanged();
  }

  /**
   * Hears what the frame says, from now on; `ready` at once when it is open. Answers the
   * function that stops it.
   */
  listen(listeners: FrameListeners): () => void {
    this.listeners.add(listeners);
    if (this.mount) {
      tellBench(this.id, "ready");
      listeners.ready?.();
    }
    return () => {
      this.listeners.delete(listeners);
    };
  }

  /**
   * Tells the frame what to draw; answers the id its `rendered` carries. What it shows already it
   * is not told again: a frame taken back from the pool is not drawn for nothing.
   */
  render(request: RenderRequest): number {
    const look = request.look ?? currentLook();
    const runtime = this.mount?.runtime ?? null;
    const { shown } = this;
    if (
      runtime !== null &&
      shown !== null &&
      shown.runtime === runtime &&
      shown.defaults === request.defaults &&
      shown.designSystem === request.designSystem &&
      shown.root === request.root &&
      shown.mode === request.mode &&
      shown.message === request.message &&
      shown.specs === look.specs &&
      shown.styles === look.styles
    ) {
      return shown.renderId;
    }
    renders += 1;
    if (!runtime) {
      this.shown = null;
      return renders;
    }
    this.shown = {
      defaults: request.defaults,
      designSystem: request.designSystem,
      message: request.message,
      mode: request.mode,
      renderId: renders,
      root: request.root,
      runtime,
      specs: look.specs,
      styles: look.styles,
    };
    runtime.render({
      defaults: request.defaults,
      designSystem: request.designSystem,
      mode: request.mode,
      renderId: renders,
      root: request.root,
      ...(look.specs.length > 0 && { specs: look.specs }),
      ...(look.styles && { styles: look.styles }),
      ...(request.message !== undefined && { message: request.message }),
    });
    return renders;
  }

  /** The nodes under the point, outermost first; empty on nothing, or while it is not open. */
  hitTest(x: number, y: number): readonly string[] {
    return this.mount?.runtime.hitTest(x, y) ?? [];
  }

  /** Where these nodes are right now, in the page's own coordinates. */
  measure(nodeIds: readonly string[]): Readonly<Record<string, FrameRect>> {
    return this.mount?.runtime.measure(nodeIds) ?? {};
  }

  /** The CSS variables the frame's stylesheets define, resolved in its theme. */
  tokens(prefixes?: readonly string[]): Readonly<Record<string, string>> {
    return this.mount?.runtime.tokens(prefixes) ?? {};
  }

  /** A PNG of what the frame draws, or of one node of it in place. */
  screenshot(nodeId?: string): Promise<string | null> {
    return this.mount?.runtime.screenshot(nodeId) ?? Promise.resolve(null);
  }

  /** Nodes whose rects the frame tells (`rects`) whenever any of them moves. */
  watchRects(nodeIds: readonly string[]) {
    this.watched = nodeIds;
    this.mount?.runtime.watchRects(nodeIds);
  }

  /** Nodes an agent is rewriting, drawn as placeholders until it is done. */
  skeleton(nodeIds: readonly string[]) {
    this.skeletons = [...nodeIds];
    this.mount?.runtime.skeleton(this.skeletons);
  }

  editText(nodeId: string) {
    this.mount?.runtime.editText(nodeId);
  }

  /**
   * Whether the page responds to input: in the prototype and in interact mode. Otherwise it is a
   * picture, which the pointer goes past.
   */
  setInteractive(interactive: boolean) {
    this.shownAs.interactive = interactive;
    if (this.mount) {
      this.mount.host.style.pointerEvents = interactive ? "auto" : "none";
      this.mount.runtime.setInteractive(interactive);
    }
  }

  /** What the frame is read by. */
  setTitle(title: string) {
    this.shownAs.title = title;
    if (this.mount) {
      this.mount.host.title = title;
    }
  }

  /** Off the screen: kept as it is, and skipped by the browser. */
  setAway(away: boolean) {
    this.shownAs.away = away;
    if (this.mount) {
      this.mount.host.style.contentVisibility = away ? "hidden" : "";
    }
  }
}

/** The handle on frame `id`, made the first time it is asked for. */
export const frameOf = (id: string): EditorFrame => {
  let frame = frames.get(id);
  if (!frame) {
    frame = new EditorFrame(id);
    frames.set(id, frame);
  }
  return frame;
};

/** Whether a frame has drawn: it shows at once when placed. */
export const isWarm = (id: string) => frames.get(id)?.warm === true;

/** Hears whenever a frame has drawn or gone: the frames that may draw next. */
export const onPoolChange = (listener: () => void) => {
  poolListeners.add(listener);
  return () => {
    poolListeners.delete(listener);
  };
};

/** Whether the frame froze the editor the last time it ran, and waits to be drawn anyway. */
export const useFrameFrozen = (id: string | null) =>
  useFrozen((s) => id !== null && s.frames.has(id));

/** Listeners that call the latest of `latest()`'s, whatever it is when the frame speaks. */
export const forwardTo = (latest: () => FrameListeners): FrameListeners => ({
  error: (error) => latest().error?.(error),
  hmr: () => latest().hmr?.(),
  instances: (instances) => latest().instances?.(instances),
  navigateTo: (route, replace) => latest().navigateTo?.(route, replace),
  pressed: (nodeIds) => latest().pressed?.(nodeIds),
  ready: () => latest().ready?.(),
  rects: (rects) => latest().rects?.(rects),
  rendered: (renderId) => latest().rendered?.(renderId),
  size: (size) => latest().size?.(size),
  textCommit: (nodeId, text) => latest().textCommit?.(nodeId, text),
});

/**
 * Hands what frame `id` says to `listeners`, as they are at each render, while `id` is not null;
 * `ready` as soon as this listens to an open frame. The frame stays when this stops listening.
 */
export const useFrameEvents = (
  id: string | null,
  listeners: FrameListeners
) => {
  const latest = useRef(listeners);
  useLayoutEffect(() => {
    latest.current = listeners;
  });
  useEffect(() => {
    if (id === null) {
      return;
    }
    return frameOf(id).listen(forwardTo(() => latest.current));
  }, [id]);
};
