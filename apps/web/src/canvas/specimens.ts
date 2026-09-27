/**
 * Pictures of single nodes, drawn by an iframe of the preview nobody sees: the palette's
 * thumbnails, and the screenshots agents ask for. One node at a time, with the repository's
 * stylesheet and its real components, then captured.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { HostMessage, RenderMode } from "@ultrapaint/contracts/preview";
import { bridgeFor } from "./bridge.ts";

const FRAME = "specimen";
const WIDTH = 1200;
const HEIGHT = 900;

let iframe: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let srcOf: string | null = null;

/**
 * Two frames for layout to settle, or a moment when the tab is in the background: frames are not
 * drawn there at all, and an agent asking for a picture must not wait for the user to look.
 */
const settle = () =>
  Promise.race([
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    ),
    new Promise((resolve) => setTimeout(resolve, 100)),
  ]);

/**
 * The hidden iframe, loaded from the preview at `host`, made once and kept; made again for
 * another space, whose images are found elsewhere.
 */
const open = (host: string, space: string) => {
  const src = `${host}/?space=${encodeURIComponent(space)}&frame=${FRAME}`;
  if (iframe && ready && srcOf === src) {
    return ready;
  }
  iframe?.remove();
  srcOf = src;
  const el = document.createElement("iframe");
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  // Inside the viewport, under everything and transparent: the browser throttles an iframe
  // from another origin that is out of view, and it would never answer.
  el.style.cssText = `position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px;border:0;pointer-events:none;background:transparent;opacity:0;z-index:-1`;
  el.src = src;
  iframe = el;
  const bridge = bridgeFor(FRAME);
  ready = new Promise<void>((resolve) => {
    const off = bridge.on((msg) => {
      if (msg.type === "ed:ready") {
        off();
        resolve();
      }
    });
  });
  document.body.append(el);
  bridge.attach(el);
  return ready;
};

/** Waits for the preview to have drawn a render, however long its components take to load. */
const rendered = (renderId: number, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    const bridge = bridgeFor(FRAME);
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, timeoutMs);
    const off = bridge.on((msg: HostMessage) => {
      if (msg.type === "ed:rendered" && msg.renderId >= renderId) {
        clearTimeout(timer);
        off();
        resolve(true);
      }
    });
  });

export interface SpecimenOptions {
  readonly height?: number;
  /** `fit` draws the node at its own size; `page` as a window of `width` shows it. */
  readonly mode?: RenderMode;
  /** Crop to this node inside the one drawn; all of it when absent. */
  readonly nodeId?: string;
  readonly space?: string;
  readonly width?: number;
}

/** A PNG of the node as the preview draws it, or null when it could not be drawn. */
export const drawSpecimen = (
  host: string,
  node: DesignNode,
  designSystem: DesignSystem | null,
  options: SpecimenOptions = {}
): Promise<string | null> => {
  const task = queue.then(async () => {
    await open(host, options.space ?? "");
    if (iframe) {
      iframe.style.width = `${options.width ?? WIDTH}px`;
      iframe.style.height = `${options.height ?? HEIGHT}px`;
    }
    const bridge = bridgeFor(FRAME);
    const id = bridge.render({
      designSystem,
      mode: options.mode ?? "fit",
      root: node,
    });
    if (!(await rendered(id, 8000))) {
      return null;
    }
    await settle();
    return await bridge.screenshot(options.nodeId);
  });
  queue = task.catch(() => null);
  return task;
};

/** A short, stable key for what thumbnails were drawn from. */
export const hashOf = (text: string) => {
  // djb2, kept within 32 bits by arithmetic so every step stays an exact integer.
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 33 + text.charCodeAt(i)) % 2 ** 32;
  }
  return h.toString(16).padStart(8, "0");
};
