import { Schema } from "effect";
import { DesignNode } from "./document.ts";
import { RenderMode } from "./preview.ts";

/**
 * A picture an agent asked for. The server has no browser: it asks the editors that are open
 * to draw the node with the preview, and the first that manages answers.
 */
export const ScreenshotRequest = Schema.Struct({
  /** The viewport, in CSS pixels: a page is drawn at its frame's size. */
  height: Schema.Number,
  /** `page` draws a page as a window shows it; `fit` a node on the canvas at its own size. */
  mode: RenderMode,
  /** The node the picture is cropped to, drawn in place inside `root`; all of it when absent. */
  nodeId: Schema.optional(Schema.String),
  requestId: Schema.String,
  root: DesignNode,
  /** Space whose assets relative image paths are in. */
  space: Schema.String,
  width: Schema.Number,
});
export type ScreenshotRequest = typeof ScreenshotRequest.Type;

/** An editor's answer: the picture, or why it could not draw one. */
export const ScreenshotResult = Schema.Struct({
  /** PNG data URL. */
  dataUrl: Schema.optional(Schema.String),
  problem: Schema.optional(Schema.String),
  requestId: Schema.String,
});
export type ScreenshotResult = typeof ScreenshotResult.Type;
