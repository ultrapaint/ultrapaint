import { Schema } from "effect";
import { DesignNode } from "./document.ts";
import { RenderMode } from "./preview.ts";

/**
 * A picture an agent asked for. The server has no browser: it asks the editors that are open
 * to draw the node with the preview, and the first that manages answers.
 */
export const ScreenshotRequest = Schema.Struct({
  /** Canvas whose own assets relative image paths are looked for in first. */
  canvas: Schema.String,
  /**
   * Whether the editor also measures the page it draws, for the review's picture (ADR 0081): the
   * rendered checks' findings come back with the picture.
   */
  checks: Schema.optional(Schema.Boolean),
  /** The viewport, in CSS pixels: a page is drawn at its frame's size. */
  height: Schema.Number,
  /** `page` draws a page as a window shows it; `fit` a node on the canvas at its own size. */
  mode: RenderMode,
  /** The node the picture is cropped to, drawn in place inside `root`; all of it when absent. */
  nodeId: Schema.optional(Schema.String),
  requestId: Schema.String,
  root: DesignNode,
  width: Schema.Number,
});
export type ScreenshotRequest = typeof ScreenshotRequest.Type;

/** Where a finding is: CSS pixels from the drawn page's top left corner. */
export const FindingBox = Schema.Struct({
  height: Schema.Number,
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});
export type FindingBox = typeof FindingBox.Type;

/**
 * What a check measured on the page the editor drew (ADR 0081), `@ultrapaint/design-checks` on
 * its frame: two groups stacked closer than `ratio` times the gap between the lines of the one
 * below, named by their first words; or a list whose rounded or filled rows of `rowHeight` touch.
 */
export const RenderedFinding = Schema.Union([
  Schema.Struct({
    above: Schema.String,
    below: Schema.String,
    /** From the last line of the group above to the first of the group below. */
    between: Schema.Number,
    /** Both groups. */
    box: FindingBox,
    kind: Schema.Literal("groups-apart"),
    /** How many times `within` the gap should be at least: 3 for groups of rows, else 2. */
    ratio: Schema.Number,
    /** The median gap between the lines of the group below. */
    within: Schema.Number,
  }),
  Schema.Struct({
    box: FindingBox,
    kind: Schema.Literal("touching-rows"),
    /** The list, by its first words. */
    list: Schema.String,
    rowHeight: Schema.Number,
  }),
]);
export type RenderedFinding = typeof RenderedFinding.Type;

/** An editor's answer: the picture, or why it could not draw one. */
export const ScreenshotResult = Schema.Struct({
  /** PNG data URL. */
  dataUrl: Schema.optional(Schema.String),
  /**
   * With a picture asked with `checks`, what the checks measured on it; absent from an editor
   * that does not measure, or when its measuring failed: the picture stands alone.
   */
  findings: Schema.optional(Schema.Array(RenderedFinding)),
  problem: Schema.optional(Schema.String),
  requestId: Schema.String,
});
export type ScreenshotResult = typeof ScreenshotResult.Type;
