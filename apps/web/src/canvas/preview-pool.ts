/**
 * The frames of the canvas, drawn in shadow roots of the editor's page (ADR 0034) and kept drawn
 * while they are away. A frame that leaves the screen, a canvas switched away from or the
 * prototype opened takes its frames off the canvas; their hosts are parked out of sight instead
 * of thrown away, and a frame that comes back takes its own again, as it was: nothing to draw
 * again, nothing blank. Parked, a host is skipped by the browser (`content-visibility: hidden`)
 * and keeps the size it had, so nothing inside is laid out again. Only so many are kept: the one
 * not seen for longest goes first.
 *
 * New frames draw a few at a time, the nearest to the middle of the screen first: the first draw
 * of a page runs its components, and the ones on screen draw sooner when they do not wait
 * behind those around them.
 */
import type { FrameRuntime } from "@ultrapaint/framework-api/browser";
import { removeBridge } from "./bridge.ts";

/** How many frames stay drawn while they are off the canvas. */
export const PARKED_MAX = 32;

/** How many new frames draw at once. */
export const LOADING_MAX = 3;

/** A frame that takes longer than this to draw is taken as drawn: it does not hold the queue. */
const LOAD_TIMEOUT_MS = 10_000;

interface Pooled {
  /** It has drawn since it was mounted. */
  drawn: boolean;
  host: HTMLElement;
  /** What it was mounted with: another preview or canvas mounts it anew. */
  key: string;
  /** In a frame's holder; false while parked. */
  placed: boolean;
  runtime: FrameRuntime;
  /** When it was last placed or parked, for the oldest to go first. */
  touched: number;
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

/** Hears whenever a frame has drawn or gone: the frames that may draw next. */
export const onPoolChange = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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

const drop = (frameId: string) => {
  const pooled = pool.get(frameId);
  if (!pooled) {
    return;
  }
  pool.delete(frameId);
  pooled.runtime.unmount();
  pooled.host.remove();
  removeBridge(frameId);
  changed();
};

/** Drops the parked frames beyond `PARKED_MAX`, the least recently seen first. */
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

/** Whether a frame is drawn: it shows at once when placed. */
export const isWarm = (frameId: string) => pool.get(frameId)?.drawn === true;

/** A frame has drawn: it no longer holds a place in the queue. */
export const previewDrawn = (frameId: string) => {
  const pooled = pool.get(frameId);
  if (pooled && !pooled.drawn) {
    pooled.drawn = true;
    pooled.host.dataset.edDrawn = "";
    changed();
  }
};

/** The runtime of a frame in the pool, placed or parked. */
export const runtimeOf = (frameId: string): FrameRuntime | null =>
  pool.get(frameId)?.runtime ?? null;

/**
 * Puts a frame's host in `holder`: the one kept for it when it was mounted with `key`, moved
 * there as it is, or a new one, which `mount` draws in.
 */
export const placePreview = (
  frameId: string,
  key: string,
  holder: HTMLElement,
  className: string,
  mount: (host: HTMLElement) => FrameRuntime
): HTMLElement => {
  let pooled = pool.get(frameId);
  if (pooled && pooled.key !== key) {
    drop(frameId);
    pooled = undefined;
  }
  clock += 1;
  if (pooled) {
    pooled.placed = true;
    pooled.touched = clock;
    pooled.host.className = className;
    pooled.host.style.width = "";
    pooled.host.style.height = "";
    holder.append(pooled.host);
    return pooled.host;
  }
  const host = document.createElement("div");
  host.className = className;
  host.dataset.edFrameHost = frameId;
  holder.append(host);
  const fresh: Pooled = {
    drawn: false,
    host,
    key,
    placed: true,
    runtime: mount(host),
    touched: clock,
  };
  pool.set(frameId, fresh);
  // A frame that never says it drew (a page that throws before it draws) does not hold the queue.
  setTimeout(() => {
    if (pool.get(frameId) === fresh) {
      previewDrawn(frameId);
    }
  }, LOAD_TIMEOUT_MS);
  return host;
};

/**
 * Takes a frame off the canvas. A frame that has drawn is parked, drawn, for when it comes back;
 * one still drawing is dropped, so it does not hold the queue for a frame no longer wanted.
 */
export const parkPreview = (frameId: string) => {
  const pooled = pool.get(frameId);
  if (!pooled) {
    return;
  }
  if (!pooled.drawn) {
    drop(frameId);
    return;
  }
  const { host } = pooled;
  // Kept at the size it was drawn at: the page inside is not laid out again.
  host.style.width = `${host.offsetWidth}px`;
  host.style.height = `${host.offsetHeight}px`;
  pooled.placed = false;
  clock += 1;
  pooled.touched = clock;
  parkingLot().append(host);
  trim();
};
