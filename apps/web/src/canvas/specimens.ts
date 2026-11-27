/**
 * Pictures of single nodes, drawn in a frame of the editor's page nobody sees (ADR 0034): the
 * Library's thumbnails, the threads' pictures, the toolbar's options and the screenshots
 * agents ask for. One node at a time, in the design's look and the system components as every
 * frame draws them (ADR 0040), then captured; for the review's picture, measured too (ADR 0081).
 */

import type { ComponentFile } from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { PageDefaults } from "@ultrapaint/contracts/pages";
import type { RenderMode } from "@ultrapaint/contracts/preview";
import type { RenderedFinding } from "@ultrapaint/contracts/screenshots";
import {
  breakpointAt,
  breakpointsOf,
  resolveAtBreakpoint,
} from "@ultrapaint/design-document/breakpoints";
import { frameOf, type OpenedFrame } from "./editor-frame.ts";
import { thePreview } from "./preview-module.ts";
import { renderedChecks } from "./rendered-checks.ts";

const FRAME = "specimen";
const WIDTH = 1200;
const HEIGHT = 900;

/*
 * How long each step of a picture may take. Together they stay under the server's 30 seconds
 * (`Screenshots`), so an editor that cannot draw a picture says so before the server gives up on
 * it, and the server tells an editor that failed from one that stopped answering. The capture
 * waits on steps of html-to-image that may never settle: a frame of a tab in the background, an
 * image the browser cannot decode, a resource that never answers.
 */
const DEFAULTS_MS = 5000;
const RENDER_MS = 8000;
const CAPTURE_MS = 15_000;

/** What `step` gives, or `late` once `ms` have passed without it. */
const within = <T, L>(step: Promise<T>, ms: number, late: L) =>
  new Promise<T | L>((resolve, reject) => {
    const timer = setTimeout(() => resolve(late), ms);
    step.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

/** What a step past its time gives. */
const LATE = Symbol("late");

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

interface SpecimenOptions {
  readonly canvas?: string;
  readonly height?: number;
  /** `fit` draws the node at its own size; `page` as a window of `width` shows it. */
  readonly mode?: RenderMode;
  /** Crop to this node inside the one drawn; all of it when absent. */
  readonly nodeId?: string;
  readonly width?: number;
}

/** A picture of a node, and what the checks measured on the page drawn. */
export interface MeasuredPicture {
  /** Absent when the checks could not run: the picture stands alone. */
  readonly findings?: readonly RenderedFinding[];
  /** A PNG data URL, or null when it could not be drawn. */
  readonly picture: string | null;
}

/** The checks on the frame as it is drawn; none when they could not run. */
const measured = (
  host: HTMLElement
): readonly RenderedFinding[] | undefined => {
  const frame = host.shadowRoot;
  if (!frame) {
    return undefined;
  }
  try {
    return renderedChecks(frame);
  } catch {
    // A measuring that failed costs the review its findings, never its picture.
    return undefined;
  }
};

/** A canvas's defaults: one whose defaults are not read in time draws in the stylesheet's own. */
const defaultsWithin = (canvas: string) =>
  within(defaultsOf(canvas), DEFAULTS_MS, undefined).catch(() => undefined);

/**
 * The frame captured, or a failure that says it was not in time. A frame whose capture is stuck
 * is not used again (`close`): the next picture opens one anew.
 */
const captureWithin = async (nodeId: string | undefined, close: () => void) => {
  const picture = await within(
    frameOf(FRAME).screenshot(nodeId),
    CAPTURE_MS,
    LATE
  );
  if (picture !== LATE) {
    return picture;
  }
  close();
  throw new Error(
    document.visibilityState === "hidden"
      ? "the preview could not draw it in time: the editor's tab is in the background, where the browser draws nothing; ask the person to bring the editor to the front"
      : "the preview could not draw it in time"
  );
};

/** The node drawn in the frame nobody sees, captured, and measured when `measure` says so. */
const draw = (
  node: DesignNode,
  designSystem: DesignSystem | null,
  options: SpecimenOptions,
  measure: boolean
): Promise<MeasuredPicture> => {
  const task = queue.then(async (): Promise<MeasuredPicture> => {
    const { close, host } = open(
      options.canvas ?? "",
      options.width ?? WIDTH,
      options.height ?? HEIGHT
    );
    const defaults = await defaultsWithin(options.canvas ?? "");
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
    // A frame that has not drawn in time is not used again: the next picture opens one anew.
    if (!(await rendered(id, RENDER_MS))) {
      close();
      return { picture: null };
    }
    await settle();
    const picture = await captureWithin(options.nodeId, close);
    const findings = measure && picture !== null ? measured(host) : undefined;
    return findings === undefined ? { picture } : { findings, picture };
  });
  // A picture that failed fails alone; the next one in line is still drawn.
  queue = task.catch(() => null);
  return task;
};

/**
 * A PNG of the node as the preview draws it, or null when it could not be drawn. A capture that
 * takes too long fails, saying so, and the picture after it is drawn in a frame opened anew.
 */
export const drawSpecimen = (
  node: DesignNode,
  designSystem: DesignSystem | null,
  options: SpecimenOptions = {}
): Promise<string | null> =>
  draw(node, designSystem, options, false).then(({ picture }) => picture);

/**
 * A PNG of a page for the review, and what the groups-apart and touching-rows checks measured
 * on it once its frame settled (ADR 0081); the picture alone when they could not run.
 */
export const drawMeasuredSpecimen = (
  node: DesignNode,
  designSystem: DesignSystem | null,
  options: SpecimenOptions = {}
): Promise<MeasuredPicture> => draw(node, designSystem, options, true);

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
interface DrawnIn {
  readonly canvas: string;
  /** The project's components: the looks it owns and its app components (ADR 0041). */
  readonly components: readonly ComponentFile[];
  readonly designSystem: DesignSystem | null;
}

/** What the last picture keyed was drawn in, and its hash. */
let lastDrawnIn: { readonly hash: string; readonly in: DrawnIn } | null = null;

/**
 * A short key for what a picture is drawn in. The design system and the components are written
 * out and hashed once while they are the same objects, however many pictures are keyed in them:
 * a prop's menu keys one for each of its options.
 */
const drawnInHash = (drawnIn: DrawnIn) => {
  const was = lastDrawnIn;
  if (
    was &&
    was.in.designSystem === drawnIn.designSystem &&
    was.in.components === drawnIn.components &&
    was.in.canvas === drawnIn.canvas
  ) {
    return was.hash;
  }
  const hash = hashOf(
    JSON.stringify([drawnIn.designSystem, drawnIn.components, drawnIn.canvas])
  );
  lastDrawnIn = { hash, in: drawnIn };
  return hash;
};

/** A key for a picture of `shown`, the parts of a node it depends on, drawn in `drawnIn`. */
export const pictureKey = (shown: unknown, drawnIn: DrawnIn) =>
  JSON.stringify([drawnInHash(drawnIn), shown]);
