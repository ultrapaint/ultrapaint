/**
 * Pictures of single nodes, drawn in a frame of the editor's page nobody sees (ADR 0034): the
 * Assets panel's thumbnails, the threads' pictures, the toolbar's options and the screenshots
 * agents ask for. One node at a time, with the repository's stylesheet and its real components,
 * then captured.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { HostMessage, RenderMode } from "@ultrapaint/contracts/preview";
import type { FrameRuntime, Preview } from "@ultrapaint/framework-api/browser";
import { bridgeFor } from "./bridge.ts";
import { previewReady } from "./preview-module.ts";

const FRAME = "specimen";
const WIDTH = 1200;
const HEIGHT = 900;

let specimen: {
  canvas: string;
  host: HTMLElement;
  preview: Preview;
  runtime: FrameRuntime;
} | null = null;
let queue: Promise<unknown> = Promise.resolve();

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
 * The frame nobody sees, made once and kept; made again for another canvas, whose images are
 * found elsewhere. Null while the preview is not running.
 */
const open = async (canvas: string) => {
  const preview = await previewReady();
  if (!preview) {
    return null;
  }
  if (specimen?.preview === preview && specimen.canvas === canvas) {
    return specimen;
  }
  specimen?.runtime.unmount();
  specimen?.host.remove();
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dataset.edFrameHost = FRAME;
  // Drawn, but nowhere the pointer or the eye goes.
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${WIDTH}px;height:${HEIGHT}px;pointer-events:none`;
  document.body.append(host);
  const bridge = bridgeFor(FRAME);
  const runtime = preview.mountFrame(host, {
    canvas,
    events: bridge.events(),
    frame: FRAME,
    still: true,
  });
  bridge.attachRuntime(runtime);
  specimen = { canvas, host, preview, runtime };
  return specimen;
};

/** Waits for the frame to have drawn a render, however long its components take to load. */
const rendered = (renderId: number, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    const bridge = bridgeFor(FRAME);
    // Told again what it shows, it does not draw it again.
    if (bridge.renderedId >= renderId) {
      resolve(true);
      return;
    }
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
  readonly canvas?: string;
  readonly height?: number;
  /** `fit` draws the node at its own size; `page` as a window of `width` shows it. */
  readonly mode?: RenderMode;
  /** Crop to this node inside the one drawn; all of it when absent. */
  readonly nodeId?: string;
  readonly width?: number;
}

/** A PNG of the node as the preview draws it, or null when it could not be drawn. */
export const drawSpecimen = (
  node: DesignNode,
  designSystem: DesignSystem | null,
  options: SpecimenOptions = {}
): Promise<string | null> => {
  const task = queue.then(async () => {
    const frame = await open(options.canvas ?? "");
    if (!frame) {
      return null;
    }
    frame.host.style.width = `${options.width ?? WIDTH}px`;
    frame.host.style.height = `${options.height ?? HEIGHT}px`;
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
  // A picture that failed fails alone; the next one in line is still drawn.
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

/** What a picture is drawn in besides the node: a change to any of it draws the node again. */
export interface DrawnIn {
  /** When the components' code was last read, as the catalogue says. */
  readonly builtAt: number;
  readonly canvas: string;
  readonly designSystem: DesignSystem | null;
}

/** A key for a picture of `shown`, the parts of a node it depends on, drawn in `drawnIn`. */
export const pictureKey = (shown: unknown, drawnIn: DrawnIn) =>
  JSON.stringify([
    hashOf(
      JSON.stringify([drawnIn.designSystem, drawnIn.builtAt, drawnIn.canvas])
    ),
    shown,
  ]);
