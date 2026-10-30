/**
 * Pictures of single nodes, drawn in a frame of the editor's page nobody sees (ADR 0034): the
 * Library's thumbnails, the threads' pictures, the toolbar's options and the screenshots
 * agents ask for. One node at a time, with the repository's stylesheet and its real components,
 * then captured.
 */

import type { ComponentFile } from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { PageDefaults } from "@ultrapaint/contracts/pages";
import type { RenderMode } from "@ultrapaint/contracts/preview";
import {
  breakpointAt,
  breakpointsOf,
  resolveAtBreakpoint,
} from "@ultrapaint/design-document/breakpoints";
import { frameOf, type OpenedFrame } from "./editor-frame.ts";
import { thePreview } from "./preview-module.ts";

const FRAME = "specimen";
const WIDTH = 1200;
const HEIGHT = 900;

let queue: Promise<unknown> = Promise.resolve();
let holder: HTMLElement | null = null;

/** What holds the frame: nothing a screen reader reads. */
const holderOf = () => {
  if (!holder) {
    holder = document.createElement("div");
    holder.setAttribute("aria-hidden", "true");
    document.body.append(holder);
  }
  return holder;
};

/**
 * What a canvas draws every page in (`CanvasLayout.defaults`): the app hands the lookup in at
 * startup, which keeps the pictures free of the stores.
 */
let defaultsOf = (_canvas: string): Promise<PageDefaults | undefined> =>
  Promise.resolve(undefined);
export const provideCanvasDefaults = (
  lookup: (canvas: string) => Promise<PageDefaults | undefined>
) => {
  defaultsOf = lookup;
};

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
 * The frame nobody sees, kept from one picture to the next; drawn anew for another canvas, whose
 * images are found elsewhere.
 */
const open = (canvas: string, width: number, height: number): OpenedFrame =>
  frameOf(FRAME).open({
    canvas,
    holder: holderOf(),
    preview: thePreview(),
    still: true,
    // Drawn at the picture's size, but nowhere the pointer or the eye goes.
    style: `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px`,
  });

/** Waits for the frame to have drawn a render, however long its components take to load. */
const rendered = (renderId: number, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    const frame = frameOf(FRAME);
    // Told again what it shows, it does not draw it again.
    if (frame.renderedId >= renderId) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, timeoutMs);
    const off = frame.listen({
      rendered: (id) => {
        if (id >= renderId) {
          clearTimeout(timer);
          off();
          resolve(true);
        }
      },
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
    open(
      options.canvas ?? "",
      options.width ?? WIDTH,
      options.height ?? HEIGHT
    );
    // A canvas whose defaults cannot be read is drawn in the stylesheet's own.
    let defaults: PageDefaults | undefined;
    try {
      defaults = await defaultsOf(options.canvas ?? "");
    } catch {
      defaults = undefined;
    }
    // As the page is at the window's width: its breakpoints' values (ADR 0036).
    const breakpoints = breakpointsOf(designSystem);
    const at = breakpointAt(breakpoints, options.width ?? WIDTH)?.name;
    const id = frameOf(FRAME).render({
      ...(at !== undefined && { at }),
      defaults,
      designSystem,
      mode: options.mode ?? "fit",
      root: resolveAtBreakpoint(node, breakpoints, at ?? null),
    });
    if (!(await rendered(id, 8000))) {
      return null;
    }
    await settle();
    return await frameOf(FRAME).screenshot(options.nodeId);
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
  readonly canvas: string;
  /** The project's components: the looks it owns and its app components (ADR 0041). */
  readonly components: readonly ComponentFile[];
  readonly designSystem: DesignSystem | null;
}

/** A key for a picture of `shown`, the parts of a node it depends on, drawn in `drawnIn`. */
export const pictureKey = (shown: unknown, drawnIn: DrawnIn) =>
  JSON.stringify([
    hashOf(
      JSON.stringify([drawnIn.designSystem, drawnIn.components, drawnIn.canvas])
    ),
    shown,
  ]);
