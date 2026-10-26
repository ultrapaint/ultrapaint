import { Schema } from "effect";

/**
 * What the editor and a frame drawn in its page (ADR 0034) say to each other: the editor holds
 * the documents and tells a frame what to draw; the frame answers with where things are. The
 * frame is called directly; these are the messages its bridge hands what it says on as.
 */

export const Rect = Schema.Struct({
  height: Schema.Number,
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});
export type Rect = typeof Rect.Type;

export const HostError = Schema.Struct({
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  message: Schema.String,
  stack: Schema.optional(Schema.String),
});
export type HostError = typeof HostError.Type;

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

/** Messages the preview sends to the editor. */
export const HostMessage = Schema.Union([
  Schema.Struct({
    /** The frame: one on the canvas, the prototype, a specimen. */
    frame: Schema.String,
    type: Schema.Literal("ed:ready"),
  }),
  /** A render reached the screen; `renderId` is the one `ed:render` carried. */
  Schema.Struct({
    renderId: Schema.Number,
    type: Schema.Literal("ed:rendered"),
  }),
  /** The drawn size of what a `fit` render shows, whenever it changes. */
  Schema.Struct({
    height: Schema.Number,
    type: Schema.Literal("ed:size"),
    width: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("ed:hmr") }),
  Schema.Struct({ error: HostError, type: Schema.Literal("ed:error") }),
  /** The nodes under the point, outermost first; empty when the point is on nothing. */
  Schema.Struct({
    nodeIds: Schema.Array(Schema.String),
    requestId: Schema.Number,
    type: Schema.Literal("ed:hit"),
  }),
  Schema.Struct({
    rects: Schema.Record(Schema.String, Rect),
    type: Schema.Literal("ed:rects"),
  }),
  /** How instances were drawn, by node id: sent for the ones that changed since the last. */
  Schema.Struct({
    instances: Schema.Record(Schema.String, InstanceDrawn),
    type: Schema.Literal("ed:instances"),
  }),
  /** Answers `ed:measure`; a node that renders nothing is left out. */
  Schema.Struct({
    rects: Schema.Record(Schema.String, Rect),
    requestId: Schema.Number,
    type: Schema.Literal("ed:measured"),
  }),
  Schema.Struct({
    nodeId: Schema.String,
    text: Schema.String,
    type: Schema.Literal("ed:textCommit"),
  }),
  Schema.Struct({
    dataUrl: Schema.NullOr(Schema.String),
    requestId: Schema.Number,
    type: Schema.Literal("ed:screenshot"),
  }),
  /** The CSS custom properties the page's stylesheets define, resolved. */
  Schema.Struct({
    requestId: Schema.Number,
    tokens: Schema.Record(Schema.String, Schema.String),
    type: Schema.Literal("ed:tokens"),
  }),
  /**
   * A click while the preview takes input: the nodes under it, outermost first, empty when it
   * landed on none. The editor shows what can be pressed when it led nowhere.
   */
  Schema.Struct({
    nodeIds: Schema.Array(Schema.String),
    type: Schema.Literal("ed:pressed"),
  }),
  /**
   * A node with a link was pressed. The preview does not move: the editor holds the route and
   * sends the page it leads to. `route` is the link as the node has it: a page file, a URL,
   * `back` or another site.
   */
  Schema.Struct({
    replace: Schema.Boolean,
    route: Schema.String,
    type: Schema.Literal("ed:navigateTo"),
  }),
]);
export type HostMessage = typeof HostMessage.Type;
