import { Schema } from "effect";
import { DesignSystem } from "./design-system.ts";
import { DesignNode } from "./document.ts";

/**
 * Protocol between the editor (parent window) and the preview runtime in every iframe,
 * transported over `postMessage`. The editor holds the documents and sends the preview what to
 * draw; the preview answers with where things are.
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
 * How a render is laid out: `page` fills the iframe as a page fills a window; `fit` draws the
 * node at its own size and reports that size, for a node placed on the canvas and for specimens
 * (thumbnails, type samples).
 */
export const RenderMode = Schema.Literals(["page", "fit"]);
export type RenderMode = typeof RenderMode.Type;

/** Messages the preview sends to the editor. */
export const HostMessage = Schema.Union([
  Schema.Struct({
    /** Identifies the iframe to the editor: a frame on the canvas, the prototype, a specimen. */
    frame: Schema.String,
    /** Version of this protocol the preview speaks. */
    protocol: Schema.optional(Schema.Number),
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
   * A node with a link was pressed. The preview does not move: the editor holds the route and
   * sends the page it leads to.
   */
  Schema.Struct({
    replace: Schema.Boolean,
    route: Schema.String,
    type: Schema.Literal("ed:navigateTo"),
  }),
]);
export type HostMessage = typeof HostMessage.Type;

/** Messages the editor sends to the preview. */
export const EditorMessage = Schema.Union([
  /** What to draw. The only way what the preview shows ever changes. */
  Schema.Struct({
    designSystem: Schema.NullOr(DesignSystem),
    /** Shown instead of a node: no page serves the route, the page cannot be read. */
    message: Schema.optional(Schema.String),
    mode: RenderMode,
    renderId: Schema.Number,
    root: Schema.NullOr(DesignNode),
    type: Schema.Literal("ed:render"),
  }),
  Schema.Struct({
    requestId: Schema.Number,
    type: Schema.Literal("ed:hitTest"),
    x: Schema.Number,
    y: Schema.Number,
  }),
  Schema.Struct({
    nodeIds: Schema.Array(Schema.String),
    type: Schema.Literal("ed:watchRects"),
  }),
  /** Where these nodes are, once: what a drag needs to show where it would land. */
  Schema.Struct({
    nodeIds: Schema.Array(Schema.String),
    requestId: Schema.Number,
    type: Schema.Literal("ed:measure"),
  }),
  Schema.Struct({ nodeId: Schema.String, type: Schema.Literal("ed:editText") }),
  /** Whether the page may respond to input at all: true only in interact mode. */
  Schema.Struct({
    interactive: Schema.Boolean,
    type: Schema.Literal("ed:setInteractive"),
  }),
  Schema.Struct({
    /** Crop the picture to this node, drawn in place; all of it when absent. */
    nodeId: Schema.optional(Schema.String),
    requestId: Schema.Number,
    type: Schema.Literal("ed:screenshot"),
  }),
  Schema.Struct({
    /** Only the variables with one of these prefixes, when given: `--color-`. */
    prefixes: Schema.optional(Schema.Array(Schema.String)),
    requestId: Schema.Number,
    type: Schema.Literal("ed:getTokens"),
  }),
  Schema.Struct({
    nodeId: Schema.String,
    type: Schema.Literal("ed:scrollIntoView"),
  }),
]);
export type EditorMessage = typeof EditorMessage.Type;

export const HOST_MESSAGE_PREFIX = "ed:";

/** Attribute every rendered node carries: its id in the document. */
export const NODE_ATTRIBUTE = "data-ed-node";
