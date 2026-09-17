import { Schema } from "effect";
import { Json, SourceLocation } from "./base.ts";

/**
 * Protocol between the editor (parent window) and the host runtime injected into every
 * screen iframe. Transported over `postMessage`.
 */

export const TreeNodeKind = Schema.Literals(["component", "element", "text"]);
export type TreeNodeKind = typeof TreeNodeKind.Type;

export interface TreeNode {
  readonly children: readonly TreeNode[];
  readonly editable: boolean;
  readonly id: string;
  readonly kind: TreeNodeKind;
  readonly name: string;
  readonly source: SourceLocation | null;
  readonly summary: string;
}

export const TreeNode: Schema.Codec<TreeNode> = Schema.suspend(() =>
  Schema.Struct({
    children: Schema.Array(TreeNode),
    editable: Schema.Boolean,
    id: Schema.String,
    kind: TreeNodeKind,
    name: Schema.String,
    source: Schema.NullOr(SourceLocation),
    summary: Schema.String,
  })
);

export const Rect = Schema.Struct({
  height: Schema.Number,
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});
export type Rect = typeof Rect.Type;

export const Provenance = Schema.Struct({
  /** Class that produced the value, when a utility or component class. */
  className: Schema.optional(Schema.String),
  /** Whether an inspector edit can rewrite this value in the selected element's source. */
  editable: Schema.Boolean,
  kind: Schema.Literals([
    "utility",
    "component",
    "token",
    "inherited",
    "default",
    "inline",
  ]),
  /** Design token behind the value, when known. */
  token: Schema.optional(Schema.String),
});
export type Provenance = typeof Provenance.Type;

export const StyleValue = Schema.Struct({
  provenance: Provenance,
  value: Schema.String,
});
export type StyleValue = typeof StyleValue.Type;

export const InspectResult = Schema.Struct({
  /** Class list on the DOM element. */
  classes: Schema.Array(Schema.String),
  editable: Schema.Boolean,
  /** Source location of the nearest editable ancestor, when the node itself is not editable. */
  editableAncestor: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      nodeId: Schema.String,
      source: SourceLocation,
    })
  ),
  kind: TreeNodeKind,
  name: Schema.String,
  nodeId: Schema.String,
  /** Classes the selected instance passed itself through its `className` prop. */
  ownClasses: Schema.Array(Schema.String),
  /** Serialisable props of the component instance, when the node is a component. */
  props: Schema.Record(Schema.String, Json),
  rect: Rect,
  source: Schema.NullOr(SourceLocation),
  styles: Schema.Record(Schema.String, StyleValue),
  text: Schema.NullOr(Schema.String),
});
export type InspectResult = typeof InspectResult.Type;

export const HostError = Schema.Struct({
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  message: Schema.String,
  stack: Schema.optional(Schema.String),
});
export type HostError = typeof HostError.Type;

/** Messages the host runtime sends to the editor. */
export const HostMessage = Schema.Union([
  Schema.Struct({
    /** Version of this protocol the preview speaks; absent from previews older than 1. */
    protocol: Schema.optional(Schema.Number),
    screen: Schema.String,
    type: Schema.Literal("ed:ready"),
  }),
  Schema.Struct({ tree: TreeNode, type: Schema.Literal("ed:tree") }),
  Schema.Struct({ type: Schema.Literal("ed:hmr") }),
  Schema.Struct({ error: HostError, type: Schema.Literal("ed:error") }),
  Schema.Struct({
    nodeId: Schema.NullOr(Schema.String),
    requestId: Schema.Number,
    type: Schema.Literal("ed:hit"),
  }),
  Schema.Struct({
    requestId: Schema.Number,
    result: Schema.NullOr(InspectResult),
    type: Schema.Literal("ed:inspect"),
  }),
  Schema.Struct({
    rects: Schema.Record(Schema.String, Rect),
    type: Schema.Literal("ed:rects"),
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
  Schema.Struct({
    tokens: Schema.Record(Schema.String, Schema.String),
    type: Schema.Literal("ed:tokens"),
  }),
]);
export type HostMessage = typeof HostMessage.Type;

/** Messages the editor sends to the host runtime. */
export const EditorMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal("ed:getTree") }),
  Schema.Struct({
    nodeId: Schema.NullOr(Schema.String),
    type: Schema.Literal("ed:hover"),
  }),
  Schema.Struct({
    nodeId: Schema.NullOr(Schema.String),
    type: Schema.Literal("ed:select"),
  }),
  Schema.Struct({
    deepest: Schema.Boolean,
    requestId: Schema.Number,
    type: Schema.Literal("ed:hitTest"),
    x: Schema.Number,
    y: Schema.Number,
  }),
  Schema.Struct({
    nodeId: Schema.String,
    requestId: Schema.Number,
    type: Schema.Literal("ed:inspect"),
  }),
  Schema.Struct({
    nodeIds: Schema.Array(Schema.String),
    type: Schema.Literal("ed:watchRects"),
  }),
  Schema.Struct({ nodeId: Schema.String, type: Schema.Literal("ed:editText") }),
  /** Whether the screen may respond to input at all: true only in interact mode. */
  Schema.Struct({
    interactive: Schema.Boolean,
    type: Schema.Literal("ed:setInteractive"),
  }),
  Schema.Struct({
    requestId: Schema.Number,
    type: Schema.Literal("ed:screenshot"),
  }),
  Schema.Struct({ type: Schema.Literal("ed:getTokens") }),
  Schema.Struct({
    nodeId: Schema.String,
    type: Schema.Literal("ed:scrollIntoView"),
  }),
]);
export type EditorMessage = typeof EditorMessage.Type;

export const HOST_MESSAGE_PREFIX = "ed:";
