/**
 * Design documents: what a page is, and what sits on the canvas beside the pages. A page file
 * (`<route>.page.json`) holds one tree of nodes; the canvas's loose nodes live in the space's
 * `canvas.json`. The editor, the preview, the server and agents all read and write this shape,
 * and every change to it is one of the operations at the end of this file (ADR 0015).
 */
import { Schema } from "effect";
import { Json, type JsonValue } from "./base.ts";

/**
 * A length: pixels as a number, a design token (`"$spacing-4"`, `"$radius-lg"`) or plain CSS
 * (`"50%"`, `"12rem"`).
 */
export const Length = Schema.Union([Schema.Number, Schema.String]).annotate({
  description:
    'Pixels as a number, a design token such as "$radius-lg", or plain CSS such as "50%".',
});
export type Length = typeof Length.Type;

/** A colour: a design token (`"$color-primary"`) or plain CSS (`"#fff"`, `"transparent"`). */
export const Color = Schema.String.annotate({
  description:
    'A design token such as "$color-primary", or plain CSS such as "#ffffff".',
});

/**
 * How a node is sized along one axis. `fill` takes the room its parent leaves, `hug` wraps its
 * content, a number is fixed pixels. Left out, the node sizes as its layout naturally would.
 */
export const Size = Schema.Union([
  Schema.Literals(["fill", "hug"]),
  Schema.Number,
]).annotate({
  description:
    '"fill" takes the room the parent leaves, "hug" wraps the content, a number is fixed pixels.',
});
export type Size = typeof Size.Type;

export const Sides = Schema.Struct({
  bottom: Schema.optional(Length),
  left: Schema.optional(Length),
  right: Schema.optional(Length),
  top: Schema.optional(Length),
});
export type Sides = typeof Sides.Type;

/** The same on every side, or side by side. */
export const Padding = Schema.Union([Length, Sides]);
export type Padding = typeof Padding.Type;

export const Border = Schema.Struct({
  color: Schema.optional(Color),
  style: Schema.optional(Schema.Literals(["solid", "dashed", "dotted"])),
  width: Schema.optional(Length),
});
export type Border = typeof Border.Type;

export const MainAlign = Schema.Literals([
  "start",
  "center",
  "end",
  "between",
  "around",
]);
export type MainAlign = typeof MainAlign.Type;

export const CrossAlign = Schema.Literals([
  "start",
  "center",
  "end",
  "stretch",
  "baseline",
]);
export type CrossAlign = typeof CrossAlign.Type;

export const TextAlign = Schema.Literals(["start", "center", "end"]);
export type TextAlign = typeof TextAlign.Type;

export const ImageFit = Schema.Literals(["cover", "contain", "fill"]);
export type ImageFit = typeof ImageFit.Type;

export const NodeType = Schema.Literals([
  "page",
  "group",
  "row",
  "column",
  "text",
  "image",
  "instance",
]);
export type NodeType = typeof NodeType.Type;

/** What every node has: identity, its box, and where it goes when pressed in the prototype. */
export interface BoxFields {
  readonly border?: Border | undefined;
  /** Background. */
  readonly fill?: string | undefined;
  readonly height?: Size | undefined;
  readonly hidden?: boolean | undefined;
  readonly id: string;
  /** Route the prototype goes to when the node is pressed. */
  readonly link?: string | undefined;
  readonly maxHeight?: Length | undefined;
  readonly maxWidth?: Length | undefined;
  readonly minHeight?: Length | undefined;
  readonly minWidth?: Length | undefined;
  /** What the layers panel calls it; the type and content otherwise. */
  readonly name?: string | undefined;
  readonly opacity?: number | undefined;
  readonly padding?: Padding | undefined;
  readonly radius?: Length | undefined;
  /** A shadow token (`"$shadow-md"`) or a CSS box-shadow. */
  readonly shadow?: string | undefined;
  readonly width?: Size | undefined;
  /** Position on the canvas; only a node placed directly on the canvas has one. */
  readonly x?: number | undefined;
  readonly y?: number | undefined;
}

export interface StackFields {
  /** Along the main axis. */
  readonly align?: MainAlign | undefined;
  /** Across the main axis. */
  readonly crossAlign?: CrossAlign | undefined;
  readonly gap?: Length | undefined;
  readonly wrap?: boolean | undefined;
}

export interface PageNode extends BoxFields, StackFields {
  readonly children: readonly DesignNode[];
  readonly type: "page";
}

export interface GroupNode extends BoxFields {
  readonly children: readonly DesignNode[];
  readonly type: "group";
}

export interface StackNode extends BoxFields, StackFields {
  readonly children: readonly DesignNode[];
  readonly type: "row" | "column";
}

export interface TextNode extends BoxFields {
  readonly align?: TextAlign | undefined;
  readonly color?: string | undefined;
  /** A font family token (`"$font-sans"`) or CSS. */
  readonly font?: string | undefined;
  /** 1–6, for a heading. */
  readonly level?: number | undefined;
  readonly lineHeight?: Length | undefined;
  readonly role: "heading" | "paragraph";
  /** A font size token (`"$text-lg"`, which brings its line height) or a length. */
  readonly size?: Length | undefined;
  readonly text: string;
  /** Name of a text style of the design system; the fields above override it. */
  readonly textStyle?: string | undefined;
  readonly tracking?: Length | undefined;
  readonly type: "text";
  /** A weight token (`"$font-weight-semibold"`) or a number. */
  readonly weight?: Length | undefined;
}

export interface ImageNode extends BoxFields {
  readonly alt?: string | undefined;
  readonly fit?: ImageFit | undefined;
  /** Path inside the space, `assets/hero.png`, or a URL. */
  readonly src: string;
  readonly type: "image";
}

export interface InstanceNode extends BoxFields {
  /** Nodes rendered as the component's children; takes precedence over `text`. */
  readonly children?: readonly DesignNode[] | undefined;
  /** Export name of the component, `Button`. */
  readonly component: string;
  /** Module it is imported from, `@acme/ui/button`. */
  readonly from: string;
  readonly props?: { readonly [name: string]: JsonValue } | undefined;
  /** Text rendered as the component's children. */
  readonly text?: string | undefined;
  readonly type: "instance";
}

export type ContainerNode = PageNode | GroupNode | StackNode;
export type DesignNode =
  | PageNode
  | GroupNode
  | StackNode
  | TextNode
  | ImageNode
  | InstanceNode;

const boxFields = {
  border: Schema.optional(Border),
  fill: Schema.optional(Color),
  height: Schema.optional(Size),
  hidden: Schema.optional(Schema.Boolean),
  id: Schema.String.check(Schema.isMinLength(1)),
  link: Schema.optional(Schema.String),
  maxHeight: Schema.optional(Length),
  maxWidth: Schema.optional(Length),
  minHeight: Schema.optional(Length),
  minWidth: Schema.optional(Length),
  name: Schema.optional(Schema.String),
  opacity: Schema.optional(
    Schema.Number.check(Schema.isBetween({ maximum: 1, minimum: 0 }))
  ),
  padding: Schema.optional(Padding),
  radius: Schema.optional(Length),
  shadow: Schema.optional(Schema.String),
  width: Schema.optional(Size),
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
};

const stackFields = {
  align: Schema.optional(MainAlign),
  crossAlign: Schema.optional(CrossAlign),
  gap: Schema.optional(Length),
  wrap: Schema.optional(Schema.Boolean),
};

/** Children refer back to the union, which is only complete once everything below exists. */
const children = Schema.Array(
  Schema.suspend((): Schema.Codec<DesignNode> => DesignNode)
);

export const PageNodeSchema = Schema.Struct({
  ...boxFields,
  ...stackFields,
  children,
  type: Schema.Literal("page"),
});

const GroupNodeSchema = Schema.Struct({
  ...boxFields,
  children,
  type: Schema.Literal("group"),
});

const StackNodeSchema = Schema.Struct({
  ...boxFields,
  ...stackFields,
  children,
  type: Schema.Literals(["row", "column"]),
});

const TextNodeSchema = Schema.Struct({
  ...boxFields,
  align: Schema.optional(TextAlign),
  color: Schema.optional(Color),
  font: Schema.optional(Schema.String),
  level: Schema.optional(
    Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 1 }))
  ),
  lineHeight: Schema.optional(Length),
  role: Schema.Literals(["heading", "paragraph"]),
  size: Schema.optional(Length),
  text: Schema.String,
  textStyle: Schema.optional(Schema.String),
  tracking: Schema.optional(Length),
  type: Schema.Literal("text"),
  weight: Schema.optional(Length),
});

const ImageNodeSchema = Schema.Struct({
  ...boxFields,
  alt: Schema.optional(Schema.String),
  fit: Schema.optional(ImageFit),
  src: Schema.String,
  type: Schema.Literal("image"),
});

const InstanceNodeSchema = Schema.Struct({
  ...boxFields,
  children: Schema.optional(children),
  component: Schema.String,
  from: Schema.String,
  props: Schema.optional(Schema.Record(Schema.String, Json)),
  text: Schema.optional(Schema.String),
  type: Schema.Literal("instance"),
});

export const DesignNode: Schema.Codec<DesignNode> = Schema.Union([
  PageNodeSchema,
  GroupNodeSchema,
  StackNodeSchema,
  TextNodeSchema,
  ImageNodeSchema,
  InstanceNodeSchema,
]).annotate({
  identifier: "DesignNode",
}) as unknown as Schema.Codec<DesignNode>;

/** Contents of a page file. */
export interface PageDocument {
  readonly root: PageNode;
  readonly version: 1;
}

export const PageDocument: Schema.Codec<PageDocument> = Schema.Struct({
  root: PageNodeSchema,
  version: Schema.Literal(1),
}) as unknown as Schema.Codec<PageDocument>;

/**
 * Which document an operation is about: a page by its id (its path inside the designs
 * directory), or a space's canvas, `canvas:<space>`.
 */
export const DocRef = Schema.String;
export type DocRef = string;

/**
 * One change to a document. `parent: null` is the top level of the canvas; in a page the
 * top level is the page node, named by its id. Indices count the parent's children as they are
 * before the operation, with the moved node itself left out.
 */
export const DocOp = Schema.Union([
  Schema.Struct({
    index: Schema.optional(Schema.Int),
    node: DesignNode,
    op: Schema.Literal("insert"),
    parent: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ id: Schema.String, op: Schema.Literal("remove") }),
  Schema.Struct({
    id: Schema.String,
    index: Schema.optional(Schema.Int),
    op: Schema.Literal("move"),
    parent: Schema.NullOr(Schema.String),
  }),
  /** Sets fields of the node; `null` removes one. `id`, `type` and `children` are not fields. */
  Schema.Struct({
    id: Schema.String,
    op: Schema.Literal("update"),
    set: Schema.Record(Schema.String, Json),
  }),
  /** Sets props of an instance; `null` removes one. */
  Schema.Struct({
    id: Schema.String,
    op: Schema.Literal("setProps"),
    props: Schema.Record(Schema.String, Json),
  }),
  /** Puts sibling nodes into a new container where the first of them was. */
  Schema.Struct({
    ids: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
    op: Schema.Literal("wrap"),
    type: Schema.Literals(["group", "row", "column"]),
  }),
  /** Replaces a container by its children. */
  Schema.Struct({ id: Schema.String, op: Schema.Literal("unwrap") }),
  /** Puts a copy right after the node, with new ids throughout. */
  Schema.Struct({ id: Schema.String, op: Schema.Literal("duplicate") }),
]);
export type DocOp = typeof DocOp.Type;

/** The operations for one document. */
export const DocumentEdit = Schema.Struct({
  doc: DocRef,
  /** Content hash the caller last saw; a mismatch is refused as stale. */
  expectedHash: Schema.optional(Schema.String),
  ops: Schema.Array(DocOp),
});
export type DocumentEdit = typeof DocumentEdit.Type;

/** Edits to one or several documents, applied together as one undo step. */
export const ApplyInput = Schema.Struct({
  edits: Schema.Array(DocumentEdit),
  /** What the undo menu calls it. */
  label: Schema.optional(Schema.String),
});
export type ApplyInput = typeof ApplyInput.Type;

/** A document as it is saved now. */
export const DocumentState = Schema.Struct({
  doc: DocRef,
  hash: Schema.String,
  /** Why the file cannot be read as a document, when it cannot. */
  problem: Schema.optional(Schema.String),
  /** The page's root, or the canvas's loose nodes wrapped in a group. Null when it is gone. */
  root: Schema.NullOr(DesignNode),
});
export type DocumentState = typeof DocumentState.Type;

export const ApplyResult = Schema.Struct({
  /** Ids of the nodes the operations created, in order: inserts, duplicates, wraps. */
  created: Schema.Array(Schema.String),
  documents: Schema.Array(DocumentState),
});
export type ApplyResult = typeof ApplyResult.Type;
