import { Schema } from "effect";

/**
 * What the editor and a frame drawn in its page (ADR 0034) share: the editor holds the documents
 * and tells a frame what to draw; the frame answers with where things are and how it drew them.
 * The frame is called directly (`framework-api/browser.ts`), and what it says is a typed callback
 * per kind, not a message.
 */

/**
 * The path the preview is served under, on the preview's server and on the editor's, which
 * forwards it there (ADR 0034): the editor imports the preview's modules from its own origin, and
 * a machine reached over SSH forwards one port. The desktop app reads a stuck page's modules by
 * it (`preview-core/provenance.ts`).
 */
export const PREVIEW_BASE = "/preview/";

/** A box in a frame's own coordinates: the page's pixels, whatever the canvas's zoom. */
export interface Rect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/**
 * How the preview drew an instance. `layout` is how the element holding the instance's children
 * lays them out, which their `fill` and `hug` are relative to: a component that is a flex column
 * grows a child that fills its height. `wrapped` says the component does not pass the props it
 * is given on to its root element, so its box is drawn on a wrapper around it instead of on the
 * component, and the code has to do the same.
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
