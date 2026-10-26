/**
 * The previews of the canvas's frames, kept loaded while their frames are away. A frame that
 * leaves the screen, a canvas switched away from or the prototype opened takes its frames off the
 * canvas; their iframes are parked out of sight instead of thrown away, and a frame that comes
 * back takes its own again, as it was: no reload, no blank page while the preview starts. The
 * iframes are moved with `moveBefore`, which keeps a document alive where moving it otherwise
 * reloads it; a browser without it loads a preview each time, as before. Only so many are kept
 * parked: the one not seen for longest goes first.
 *
 * New previews load a few at a time, the nearest to the middle of the screen first: they share the
 * preview process and the connections to its server, and the ones on screen draw sooner when they
 * do not wait behind those around them.
 */
import { removeBridge } from "./bridge.ts";

/** How many previews stay loaded while their frames are off the canvas. */
export const PARKED_MAX = 16;

/** How many new previews load at once. */
export const LOADING_MAX = 3;

/** A preview that takes longer than this to draw is taken as loaded: it does not hold the queue. */
const LOAD_TIMEOUT_MS = 10_000;

const canMove =
  typeof Element !== "undefined" && "moveBefore" in Element.prototype;

interface Pooled {
  /** It has drawn since it was loaded. */
  drawn: boolean;
  iframe: HTMLIFrameElement;
  /** In a frame's holder; false while parked. */
  placed: boolean;
  /** When it was last placed or parked, for the oldest to go first. */
  touched: number;
  url: string;
}

const pool = new Map<string, Pooled>();
const listeners = new Set<() => void>();
let clock = 0;
let parking: HTMLElement | null = null;

const changed = () => {
  for (const listener of listeners) {
    listener();
  }
};

/** Hears whenever a preview has drawn or gone: the frames that may load next. */
export const onPoolChange = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Out of sight, at the size its frame had, so the page inside is not laid out again; hidden, so the
 * browser does not draw it.
 */
const parkingLot = () => {
  if (!parking) {
    parking = document.createElement("div");
    parking.setAttribute("aria-hidden", "true");
    parking.dataset.previewParking = "";
    parking.style.cssText =
      "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
    document.body.append(parking);
  }
  return parking;
};

const drop = (frameId: string) => {
  const pooled = pool.get(frameId);
  if (!pooled) {
    return;
  }
  pool.delete(frameId);
  pooled.iframe.remove();
  removeBridge(frameId);
  changed();
};

/** Drops the parked previews beyond `PARKED_MAX`, the least recently seen first. */
const trim = () => {
  const parked = [...pool.entries()]
    .filter(([, p]) => !p.placed)
    .sort(([, a], [, b]) => a.touched - b.touched);
  for (const [frameId] of parked.slice(
    0,
    Math.max(0, parked.length - PARKED_MAX)
  )) {
    drop(frameId);
  }
};

/** Whether the preview of a frame is loaded and has drawn: it shows at once when placed. */
export const isWarm = (frameId: string) => pool.get(frameId)?.drawn === true;

/** The preview of a frame has drawn: it no longer holds a place in the queue. */
export const previewDrawn = (frameId: string) => {
  const pooled = pool.get(frameId);
  if (pooled && !pooled.drawn) {
    pooled.drawn = true;
    changed();
  }
};

/**
 * Puts the preview of a frame in `holder`: the one kept for it when it was loaded from `url`,
 * moved there as it is, or a new one.
 */
export const placePreview = (
  frameId: string,
  url: string,
  holder: HTMLElement,
  className: string
): HTMLIFrameElement => {
  let pooled = pool.get(frameId);
  if (pooled && pooled.url !== url) {
    drop(frameId);
    pooled = undefined;
  }
  clock += 1;
  if (pooled) {
    pooled.placed = true;
    pooled.touched = clock;
    pooled.iframe.className = className;
    pooled.iframe.style.width = "";
    pooled.iframe.style.height = "";
    holder.moveBefore(pooled.iframe, null);
    return pooled.iframe;
  }
  const iframe = document.createElement("iframe");
  iframe.className = className;
  iframe.src = url;
  holder.append(iframe);
  const fresh: Pooled = {
    drawn: false,
    iframe,
    placed: true,
    touched: clock,
    url,
  };
  pool.set(frameId, fresh);
  // A preview that never says it drew (an error page, a hung server) does not hold the queue.
  setTimeout(() => {
    if (pool.get(frameId) === fresh) {
      previewDrawn(frameId);
    }
  }, LOAD_TIMEOUT_MS);
  return iframe;
};

/**
 * Takes the preview of a frame off the canvas. A preview that has drawn is parked, loaded, for
 * when its frame comes back; one still loading is dropped, so it does not hold the queue for a
 * frame no longer wanted.
 */
export const parkPreview = (frameId: string) => {
  const pooled = pool.get(frameId);
  if (!pooled) {
    return;
  }
  if (!(canMove && pooled.drawn)) {
    drop(frameId);
    return;
  }
  const { iframe } = pooled;
  // Kept at the size it was drawn at: the page inside is not laid out again.
  iframe.style.width = `${iframe.offsetWidth}px`;
  iframe.style.height = `${iframe.offsetHeight}px`;
  pooled.placed = false;
  clock += 1;
  pooled.touched = clock;
  parkingLot().moveBefore(iframe, null);
  trim();
};
