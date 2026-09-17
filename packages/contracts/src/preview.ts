import { Schema as S } from "effect";
import { Json, SourceLocation } from "./base.ts";

/**
 * Protocol between the editor (parent window) and the host runtime injected into every
 * screen iframe. Transported over `postMessage`.
 */

export const TreeNodeKind = S.Literal("component", "element", "text");
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

export const TreeNode: S.Schema<TreeNode> = S.suspend(() =>
  S.Struct({
    children: S.Array(TreeNode),
    editable: S.Boolean,
    id: S.String,
    kind: TreeNodeKind,
    name: S.String,
    source: S.NullOr(SourceLocation),
    summary: S.String,
  })
);

export const Rect = S.Struct({
  height: S.Number,
  width: S.Number,
  x: S.Number,
  y: S.Number,
});
export type Rect = typeof Rect.Type;

export const Provenance = S.Struct({
  /** Class that produced the value, when a utility or component class. */
  className: S.optional(S.String),
  /** Whether an inspector edit can rewrite this value in the selected element's source. */
  editable: S.Boolean,
  kind: S.Literal(
    "utility",
    "component",
    "token",
    "inherited",
    "default",
    "inline"
  ),
  /** Design token behind the value, when known. */
  token: S.optional(S.String),
});
export type Provenance = typeof Provenance.Type;

export const StyleValue = S.Struct({ provenance: Provenance, value: S.String });
export type StyleValue = typeof StyleValue.Type;

export const InspectResult = S.Struct({
  /** Class list on the DOM element. */
  classes: S.Array(S.String),
  editable: S.Boolean,
  /** Source location of the nearest editable ancestor, when the node itself is not editable. */
  editableAncestor: S.NullOr(
    S.Struct({ name: S.String, nodeId: S.String, source: SourceLocation })
  ),
  kind: TreeNodeKind,
  name: S.String,
  nodeId: S.String,
  /** Classes the selected instance passed itself through its `className` prop. */
  ownClasses: S.Array(S.String),
  /** Serialisable props of the component instance, when the node is a component. */
  props: S.Record({ key: S.String, value: Json }),
  rect: Rect,
  source: S.NullOr(SourceLocation),
  styles: S.Record({ key: S.String, value: StyleValue }),
  text: S.NullOr(S.String),
});
export type InspectResult = typeof InspectResult.Type;

export const HostError = S.Struct({
  file: S.optional(S.String),
  line: S.optional(S.Number),
  message: S.String,
  stack: S.optional(S.String),
});
export type HostError = typeof HostError.Type;

/** Messages the host runtime sends to the editor. */
export const HostMessage = S.Union(
  S.Struct({ screen: S.String, type: S.Literal("ed:ready") }),
  S.Struct({ tree: TreeNode, type: S.Literal("ed:tree") }),
  S.Struct({ type: S.Literal("ed:hmr") }),
  S.Struct({ error: HostError, type: S.Literal("ed:error") }),
  S.Struct({
    nodeId: S.NullOr(S.String),
    requestId: S.Number,
    type: S.Literal("ed:hit"),
  }),
  S.Struct({
    requestId: S.Number,
    result: S.NullOr(InspectResult),
    type: S.Literal("ed:inspect"),
  }),
  S.Struct({
    rects: S.Record({ key: S.String, value: Rect }),
    type: S.Literal("ed:rects"),
  }),
  S.Struct({
    nodeId: S.String,
    text: S.String,
    type: S.Literal("ed:textCommit"),
  }),
  S.Struct({
    dataUrl: S.NullOr(S.String),
    requestId: S.Number,
    type: S.Literal("ed:screenshot"),
  }),
  S.Struct({
    tokens: S.Record({ key: S.String, value: S.String }),
    type: S.Literal("ed:tokens"),
  })
);
export type HostMessage = typeof HostMessage.Type;

/** Messages the editor sends to the host runtime. */
export const EditorMessage = S.Union(
  S.Struct({ type: S.Literal("ed:getTree") }),
  S.Struct({ nodeId: S.NullOr(S.String), type: S.Literal("ed:hover") }),
  S.Struct({ nodeId: S.NullOr(S.String), type: S.Literal("ed:select") }),
  S.Struct({
    deepest: S.Boolean,
    requestId: S.Number,
    type: S.Literal("ed:hitTest"),
    x: S.Number,
    y: S.Number,
  }),
  S.Struct({
    nodeId: S.String,
    requestId: S.Number,
    type: S.Literal("ed:inspect"),
  }),
  S.Struct({ nodeIds: S.Array(S.String), type: S.Literal("ed:watchRects") }),
  S.Struct({ nodeId: S.String, type: S.Literal("ed:editText") }),
  S.Struct({ requestId: S.Number, type: S.Literal("ed:screenshot") }),
  S.Struct({ type: S.Literal("ed:getTokens") }),
  S.Struct({ nodeId: S.String, type: S.Literal("ed:scrollIntoView") })
);
export type EditorMessage = typeof EditorMessage.Type;

export const HOST_MESSAGE_PREFIX = "ed:";
