import { Schema } from "effect";

/**
 * What the editor and a frame drawn in its page (ADR 0034) share: the editor holds the documents
 * and tells a frame what to draw; the frame answers with where things are.
 * The frame is called directly (preview-core's `preview.ts`), and what it says is a typed callback
 * per kind, not a message.
 */

/** A box in a frame's own coordinates: the page's pixels, whatever the canvas's zoom. */
export interface Rect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/**
 * How a render is laid out: `page` fills the frame as a page fills a window; `fit` draws the
 * node at its own size and reports that size, for a node placed on the canvas and for specimens
 * (thumbnails, type samples).
 */
export const RenderMode = Schema.Literals(["page", "fit"]);
export type RenderMode = typeof RenderMode.Type;
