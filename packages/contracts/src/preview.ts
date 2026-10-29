import { Schema } from "effect";

/**
 * What the editor and a frame drawn in its page (ADR 0034) share: the editor holds the documents
 * and tells a frame what to draw; the frame answers with where things are and how it drew them.
 * The frame is called directly (`framework-api/browser.ts`), and what it says is a typed callback
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
 * How the preview drew an instance. `layout` is how the element holding the instance's children
 * lays them out, which their `fill` and `hug` are relative to: a system component whose default slot is
 * a column grows a child that fills its height. `wrapped` is false for every system component, which
 * takes its box on its own element (ADR 0040).
 */
export const InstanceDrawn = Schema.Struct({
  layout: Schema.Literals(["row", "column", "block"]),
  wrapped: Schema.Boolean,
});
export type InstanceDrawn = typeof InstanceDrawn.Type;

/**
 * How a render is laid out: `page` fills the frame as a page fills a window; `fit` draws the
 * node at its own size and reports that size, for a node placed on the canvas and for specimens
 * (thumbnails, type samples).
 */
export const RenderMode = Schema.Literals(["page", "fit"]);
export type RenderMode = typeof RenderMode.Type;
