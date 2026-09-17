import * as S from "effect/Schema";
import { Json, SourceLocation } from "./base.ts";

/**
 * Protocol between the editor (parent window) and the host runtime injected into every
 * screen iframe. Transported over `postMessage`.
 */

export const TreeNodeKind = S.Literal("component", "element", "text");
export type TreeNodeKind = typeof TreeNodeKind.Type;

export interface TreeNode {
  readonly id: string;
  readonly kind: TreeNodeKind;
  readonly name: string;
  readonly summary: string;
  readonly source: SourceLocation | null;
  readonly editable: boolean;
  readonly children: ReadonlyArray<TreeNode>;
}

export const TreeNode: S.Schema<TreeNode> = S.suspend(() =>
  S.Struct({
    id: S.String,
    kind: TreeNodeKind,
    name: S.String,
    summary: S.String,
    source: S.NullOr(SourceLocation),
    editable: S.Boolean,
    children: S.Array(TreeNode),
  }),
);

export const Rect = S.Struct({ x: S.Number, y: S.Number, width: S.Number, height: S.Number });
export type Rect = typeof Rect.Type;

export const Provenance = S.Struct({
  kind: S.Literal("utility", "component", "token", "inherited", "default", "inline"),
  /** Class that produced the value, when a utility or component class. */
  className: S.optional(S.String),
  /** Design token behind the value, when known. */
  token: S.optional(S.String),
  /** Whether an inspector edit can rewrite this value in the selected element's source. */
  editable: S.Boolean,
});
export type Provenance = typeof Provenance.Type;

export const StyleValue = S.Struct({ value: S.String, provenance: Provenance });
export type StyleValue = typeof StyleValue.Type;

export const InspectResult = S.Struct({
  nodeId: S.String,
  kind: TreeNodeKind,
  name: S.String,
  source: S.NullOr(SourceLocation),
  editable: S.Boolean,
  /** Source location of the nearest editable ancestor, when the node itself is not editable. */
  editableAncestor: S.NullOr(
    S.Struct({ nodeId: S.String, name: S.String, source: SourceLocation }),
  ),
  rect: Rect,
  /** Class list on the DOM element. */
  classes: S.Array(S.String),
  /** Classes the selected instance passed itself through its `className` prop. */
  ownClasses: S.Array(S.String),
  styles: S.Record({ key: S.String, value: StyleValue }),
  /** Serialisable props of the component instance, when the node is a component. */
  props: S.Record({ key: S.String, value: Json }),
  text: S.NullOr(S.String),
});
export type InspectResult = typeof InspectResult.Type;

export const HostError = S.Struct({
  message: S.String,
  stack: S.optional(S.String),
  file: S.optional(S.String),
  line: S.optional(S.Number),
});
export type HostError = typeof HostError.Type;

/** Messages the host runtime sends to the editor. */
export const HostMessage = S.Union(
  S.Struct({ type: S.Literal("ed:ready"), screen: S.String }),
  S.Struct({ type: S.Literal("ed:tree"), tree: TreeNode }),
  S.Struct({ type: S.Literal("ed:hmr") }),
  S.Struct({ type: S.Literal("ed:error"), error: HostError }),
  S.Struct({ type: S.Literal("ed:hit"), requestId: S.Number, nodeId: S.NullOr(S.String) }),
  S.Struct({ type: S.Literal("ed:inspect"), requestId: S.Number, result: S.NullOr(InspectResult) }),
  S.Struct({ type: S.Literal("ed:rects"), rects: S.Record({ key: S.String, value: Rect }) }),
  S.Struct({ type: S.Literal("ed:textCommit"), nodeId: S.String, text: S.String }),
  S.Struct({ type: S.Literal("ed:screenshot"), requestId: S.Number, dataUrl: S.NullOr(S.String) }),
  S.Struct({ type: S.Literal("ed:tokens"), tokens: S.Record({ key: S.String, value: S.String }) }),
);
export type HostMessage = typeof HostMessage.Type;

/** Messages the editor sends to the host runtime. */
export const EditorMessage = S.Union(
  S.Struct({ type: S.Literal("ed:getTree") }),
  S.Struct({ type: S.Literal("ed:hover"), nodeId: S.NullOr(S.String) }),
  S.Struct({ type: S.Literal("ed:select"), nodeId: S.NullOr(S.String) }),
  S.Struct({
    type: S.Literal("ed:hitTest"),
    requestId: S.Number,
    x: S.Number,
    y: S.Number,
    deepest: S.Boolean,
  }),
  S.Struct({ type: S.Literal("ed:inspect"), requestId: S.Number, nodeId: S.String }),
  S.Struct({ type: S.Literal("ed:watchRects"), nodeIds: S.Array(S.String) }),
  S.Struct({ type: S.Literal("ed:editText"), nodeId: S.String }),
  S.Struct({ type: S.Literal("ed:screenshot"), requestId: S.Number }),
  S.Struct({ type: S.Literal("ed:getTokens") }),
  S.Struct({ type: S.Literal("ed:scrollIntoView"), nodeId: S.String }),
);
export type EditorMessage = typeof EditorMessage.Type;

export const HOST_MESSAGE_PREFIX = "ed:";
