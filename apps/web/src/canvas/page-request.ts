/**
 * What a page's frame draws, for the canvas and the prototype: the page as it is at the frame's
 * width (its breakpoints' values, ADR 0036), in the design system and the canvas's defaults, or why there is nothing to draw. Pure: what it gives for the same parts has the
 * same parts, so a frame told it again draws nothing (`useFrameDrawing`).
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { PageDefaults } from "@ultrapaint/contracts/pages";
import type { RenderMode } from "@ultrapaint/contracts/preview";
import {
  breakpointAt,
  resolveAtBreakpoint,
} from "@ultrapaint/design-document/breakpoints";
import { breakpointsFor } from "../state/design-system.ts";
import type { RenderRequest } from "./editor-frame.ts";

interface PageDrawing {
  /** Said in place of a page there is none of: the prototype's route that no page serves. */
  readonly absent?: string | undefined;
  /** What the canvas draws every page in (`CanvasLayout.defaults`). */
  readonly defaults: PageDefaults | undefined;
  readonly designSystem: DesignSystem | null;
  /** A node on the canvas held where the pointer put it: drawn at its size while it has one. */
  readonly held?: Partial<Box> | undefined;
  /** An app component's instance edited in place in the frame (ADR 0041). */
  readonly isolate?: RenderRequest["isolate"];
  /** A page fills its frame; a node on the canvas is drawn as large as it is (`fit`). */
  readonly mode: RenderMode;
  /** Why the page's file cannot be read, when it cannot. */
  readonly problem?: string | undefined;
  /** The page's tree, or the node on the canvas; null while there is none. */
  readonly root: DesignNode | null;
  /**
   * The width it is drawn at: a page's frame's, the prototype's device's. A node on the canvas
   * is as wide as it is held, or as its own fixed width; otherwise the smallest screen's.
   */
  readonly width?: number | undefined;
}

/** A node at the size it is held at, the same object while the size is. */
const sizedNodes = new WeakMap<
  DesignNode,
  { height?: number; node: DesignNode; width?: number }
>();

const sizedAt = (root: DesignNode, held: Partial<Box> | undefined) => {
  const { height, width } = held ?? {};
  if (height === undefined && width === undefined) {
    return root;
  }
  const known = sizedNodes.get(root);
  if (known && known.height === height && known.width === width) {
    return known.node;
  }
  const node = {
    ...root,
    ...(height !== undefined && { height }),
    ...(width !== undefined && { width }),
  } as DesignNode;
  sizedNodes.set(root, { height, node, width });
  return node;
};

/** What a page's frame is told to draw. */
export const pageRequest = (page: PageDrawing): RenderRequest => {
  const { designSystem, root } = page;
  const sized = root && sizedAt(root, page.held);
  const at =
    page.width ??
    page.held?.width ??
    (typeof root?.width === "number" ? root.width : 0);
  const breakpoints = breakpointsFor(designSystem);
  const breakpoint = breakpointAt(breakpoints, at)?.name;
  let message = page.absent;
  if (message === undefined && page.problem !== undefined) {
    message = `This page cannot be read: ${page.problem}`;
  }
  return {
    ...(breakpoint !== undefined && { at: breakpoint }),
    defaults: page.defaults,
    designSystem,
    ...(page.isolate && { isolate: page.isolate }),
    mode: page.mode,
    root: sized && resolveAtBreakpoint(sized, breakpoints, breakpoint ?? null),
    ...(message !== undefined && { message }),
  };
};
