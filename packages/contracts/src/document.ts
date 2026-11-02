/**
 * Design documents: what a page is, and what sits on the canvas beside the pages. A page file
 * (`<route>.page.json`) holds one tree of nodes; the canvas's loose nodes live in the canvas's
 * `canvas.json`. The editor, the preview, the server and agents all read and write this shape,
 * and every change to it is one of the operations at the end of this file (ADR 0015).
 */
import { Schema } from "effect";
import { Json, type JsonValue } from "./base.ts";
import { APP_FROM, SYSTEM_FROM } from "./component-names.ts";

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

/** Room outside the node, the same on every side or side by side, as padding is inside it. */
export const Margin = Padding.annotate({
  description:
    "Room outside the node, the same on every side or side by side. Space between siblings is the parent's gap; margin is for the one child that stands apart.",
});
export type Margin = typeof Margin.Type;

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

/** What every node has: identity, its box, and where it goes when pressed in the prototype. */
interface BoxFields {
  readonly border?: Border | undefined;
  /** Background. */
  readonly fill?: string | undefined;
  readonly height?: Size | undefined;
  readonly hidden?: boolean | undefined;
  readonly id: string;
  /** Route the prototype goes to when the node is pressed. */
  readonly link?: string | undefined;
  /**
   * Locked in the editor: a click, a drag or a marquee on the canvas passes it by, and whatever
   * is inside it, while the layers panel still selects it. It changes nothing in the design.
   */
  readonly locked?: boolean | undefined;
  readonly margin?: Margin | undefined;
  readonly maxHeight?: Length | undefined;
  readonly maxWidth?: Length | undefined;
  readonly minHeight?: Length | undefined;
  readonly minWidth?: Length | undefined;
  /** What the layers panel calls it; the type and content otherwise. */
  readonly name?: string | undefined;
  readonly opacity?: number | undefined;
  /**
   * Its place among its siblings as drawn, before or after them (CSS `order`): lower first, 0
   * when absent. Set at a breakpoint, it moves the node there without moving it in the tree.
   */
  readonly order?: number | undefined;
  readonly padding?: Padding | undefined;
  readonly radius?: Length | undefined;
  /** A shadow token (`"$shadow-md"`) or a CSS box-shadow. */
  readonly shadow?: string | undefined;
  /**
   * The part of its parent system component it fills (ADR 0040): a slot's name (`dialog-footer`). A
   * child that names none fills the system component's default slot.
   */
  readonly slot?: string | undefined;
  readonly width?: Size | undefined;
  /** Position on the canvas; only a node placed directly on the canvas has one. */
  readonly x?: number | undefined;
  readonly y?: number | undefined;
}

/**
 * What a node's fields are from a breakpoint of the design system on (ADR 0036), by the
 * breakpoint's name (`md`), mobile-first: the node's own fields are the smallest screen's, and
 * `at.md` holds from `md` up until a larger breakpoint sets the field again.
 */
interface AtBreakpoints<Fields> {
  readonly [breakpoint: string]: Fields;
}

/** Fields that are the node itself, the same at every width. */
type Fixed =
  | "at"
  | "children"
  | "component"
  | "from"
  | "id"
  | "level"
  | "link"
  | "locked"
  | "name"
  | "role"
  | "slot"
  | "type"
  | "x"
  | "y";

/** What a node of this kind can set at a breakpoint. */
type OverrideOf<Node> = Partial<Omit<Node, Fixed>>;

interface StackFields {
  /** Along the main axis. */
  readonly align?: MainAlign | undefined;
  /** Across the main axis. */
  readonly crossAlign?: CrossAlign | undefined;
  readonly gap?: Length | undefined;
  readonly wrap?: boolean | undefined;
}

export interface PageNode extends BoxFields, StackFields {
  readonly at?: AtBreakpoints<OverrideOf<PageNode>> | undefined;
  readonly children: readonly DesignNode[];
  readonly type: "page";
}

export interface GroupNode extends BoxFields {
  readonly at?: AtBreakpoints<OverrideOf<GroupNode>> | undefined;
  readonly children: readonly DesignNode[];
  readonly type: "group";
}

export interface StackNode extends BoxFields, StackFields {
  /** A row can be a column from a breakpoint on, and the other way round. */
  readonly at?:
    | AtBreakpoints<
        OverrideOf<StackNode> & { readonly type?: "row" | "column" | undefined }
      >
    | undefined;
  readonly children: readonly DesignNode[];
  readonly type: "row" | "column";
}

export interface TextNode extends BoxFields {
  readonly align?: TextAlign | undefined;
  readonly at?: AtBreakpoints<OverrideOf<TextNode>> | undefined;
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
  readonly at?: AtBreakpoints<OverrideOf<ImageNode>> | undefined;
  readonly fit?: ImageFit | undefined;
  /** Path inside the canvas, `assets/hero.png`, or a URL. */
  readonly src: string;
  /**
   * The colour an icon is drawn in: its shape, filled with it (a token, `"$color-muted"`, or a CSS
   * colour). One file serves every colour; absent, the image is drawn as it is.
   */
  readonly tint?: string | undefined;
  readonly type: "image";
}

export interface InstanceNode extends BoxFields {
  /** Props set at a breakpoint are laid over the node's own, one by one. */
  readonly at?: AtBreakpoints<OverrideOf<InstanceNode>> | undefined;
  /** Nodes rendered as the component's children; takes precedence over `text`. */
  readonly children?: readonly DesignNode[] | undefined;
  /** The component's name, `Button`. */
  readonly component: string;
  /** Its origin (ADR 0041): one of the editor's system components, or one of the project's. */
  readonly from: InstanceFrom;
  readonly props?: { readonly [name: string]: JsonValue } | undefined;
  /** Text rendered as the component's children. */
  readonly text?: string | undefined;
  readonly type: "instance";
}

/** What an instance names as `from`: a system component's origin or an app component's. */
export type InstanceFrom = typeof SYSTEM_FROM | typeof APP_FROM;
/**
 * The two origins. An instance of a component of the repository's, from before ADR 0041, does not
 * read: the migration that drew it as a system component was retired.
 */
export const InstanceFrom = Schema.Literals([SYSTEM_FROM, APP_FROM]).annotate({
  message: `an instance names a system component ("${SYSTEM_FROM}") or an app component ("${APP_FROM}"): a component of the repository's, from before ADR 0041, is no longer migrated`,
});

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
  link: Schema.optional(
    Schema.String.annotate({
      description:
        'Where the node leads when pressed in the prototype: a page file of the canvas ("pricing.page.json", which keeps working when its URL changes and reaches a page without one), a URL ("/invoices/42"), "back", or another site ("https://…").',
    })
  ),
  locked: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Locked in the editor, so that a click or a drag on the canvas passes it and what is inside it by. It does not change the design.",
    })
  ),
  margin: Schema.optional(Margin),
  maxHeight: Schema.optional(Length),
  maxWidth: Schema.optional(Length),
  minHeight: Schema.optional(Length),
  minWidth: Schema.optional(Length),
  name: Schema.optional(Schema.String),
  opacity: Schema.optional(
    Schema.Number.check(Schema.isBetween({ maximum: 1, minimum: 0 }))
  ),
  order: Schema.optional(Schema.Int),
  padding: Schema.optional(Padding),
  radius: Schema.optional(Length),
  shadow: Schema.optional(Schema.String),
  slot: Schema.optional(
    Schema.String.annotate({
      description:
        "The part of its parent system component this child fills, by the slot's name (\"dialog-footer\"); a child without one fills the system component's default slot.",
    })
  ),
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

/** The box fields a breakpoint can set: all but the node's identity and its place on the canvas. */
const {
  id: _id,
  link: _link,
  locked: _locked,
  name: _name,
  slot: _slot,
  x: _x,
  y: _y,
  ...boxOverride
} = boxFields;

/** `at`: what the node's fields are from each breakpoint on, by the breakpoint's name. */
const atBreakpoints = <F extends Schema.Struct.Fields>(fields: F) =>
  Schema.optional(
    Schema.Record(Schema.String, Schema.Struct(fields)).annotate({
      description:
        'Fields that differ from a breakpoint of the design system on, by its name: {"md": {"type": "row", "gap": "$spacing-6"}}. Mobile-first: the node\'s own fields are the smallest screen\'s.',
    })
  );

/** Children refer back to the union, which is only complete once everything below exists. */
const children = Schema.Array(
  Schema.suspend((): Schema.Codec<DesignNode> => DesignNode)
);

const PageNodeSchema = Schema.Struct({
  ...boxFields,
  ...stackFields,
  at: atBreakpoints({ ...boxOverride, ...stackFields }),
  children,
  type: Schema.Literal("page"),
});

const GroupNodeSchema = Schema.Struct({
  ...boxFields,
  at: atBreakpoints(boxOverride),
  children,
  type: Schema.Literal("group"),
});

const StackNodeSchema = Schema.Struct({
  ...boxFields,
  ...stackFields,
  at: atBreakpoints({
    ...boxOverride,
    ...stackFields,
    type: Schema.optional(Schema.Literals(["row", "column"])),
  }),
  children,
  type: Schema.Literals(["row", "column"]),
});

const textFields = {
  align: Schema.optional(TextAlign),
  color: Schema.optional(Color),
  font: Schema.optional(Schema.String),
  lineHeight: Schema.optional(Length),
  size: Schema.optional(Length),
  textStyle: Schema.optional(Schema.String),
  tracking: Schema.optional(Length),
  weight: Schema.optional(Length),
};

const TextNodeSchema = Schema.Struct({
  ...boxFields,
  ...textFields,
  at: atBreakpoints({
    ...boxOverride,
    ...textFields,
    text: Schema.optional(Schema.String),
  }),
  level: Schema.optional(
    Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 1 }))
  ),
  role: Schema.Literals(["heading", "paragraph"]),
  text: Schema.String,
  type: Schema.Literal("text"),
});

const imageFields = {
  alt: Schema.optional(Schema.String),
  fit: Schema.optional(ImageFit),
  tint: Schema.optional(Color),
};

const ImageNodeSchema = Schema.Struct({
  ...boxFields,
  ...imageFields,
  at: atBreakpoints({
    ...boxOverride,
    ...imageFields,
    src: Schema.optional(Schema.String),
  }),
  src: Schema.String,
  type: Schema.Literal("image"),
});

const instanceFields = {
  props: Schema.optional(Schema.Record(Schema.String, Json)),
  text: Schema.optional(Schema.String),
};

const InstanceNodeSchema = Schema.Struct({
  ...boxFields,
  ...instanceFields,
  at: atBreakpoints({ ...boxOverride, ...instanceFields }),
  children: Schema.optional(children),
  component: Schema.String,
  from: InstanceFrom,
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

/** A breakpoint of the design system, by its name: `md`, `lg`. */
const BreakpointName = Schema.String.check(Schema.isMinLength(1));

/**
 * Which document an operation is about: a page by its id (its path inside the designs
 * directory), or a canvas's loose nodes, `canvas:<canvas>`.
 */
const DocRef = Schema.String;

/**
 * One change to a document. `parent: null` is the top level of the canvas; in a page the
 * top level is the page node, named by its id. Indices count the parent's children as they are
 * before the operation, with the moved node itself left out. A node put into an instance that
 * shows `text` and holds nothing turns that text into the instance's first child, a text node,
 * and goes after it. Moving or removing the last other node out of an instance turns a plain
 * text node it is left holding back into its `text`.
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
  /**
   * Sets fields of the node; `null` removes one. `id`, `type` and `children` are not fields.
   * With `at`, they are set from that breakpoint on (ADR 0036), in the node's `at`.
   */
  Schema.Struct({
    at: Schema.optional(BreakpointName),
    id: Schema.String,
    op: Schema.Literal("update"),
    set: Schema.Record(Schema.String, Json),
  }),
  /** Sets props of an instance; `null` removes one. With `at`, from that breakpoint on. */
  Schema.Struct({
    at: Schema.optional(BreakpointName),
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
  /**
   * Puts a node in place of others, siblings (ADR 0042): where the first of them was, at its
   * position on the canvas when the node gives none. An instance drawn as now, detached from its
   * component, or made one.
   */
  Schema.Struct({
    ids: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
    node: DesignNode,
    op: Schema.Literal("replace"),
  }),
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

/** A node as a document change sends it: its fields but its children, which it names by id. */
export const ChangedNode = Schema.Struct({
  /** Its children's ids in order, for a node that holds children. */
  children: Schema.optional(Schema.Array(Schema.String)),
  /** Its own fields, its id and type among them. */
  node: Schema.Record(Schema.String, Json),
});
export type ChangedNode = typeof ChangedNode.Type;

/**
 * The nodes of a document that changed since the state `from` (ADR 0044): each node new or
 * changed, in its own fields or in which children it holds, the rest as they were; a node no one
 * names is gone. Only a copy at `from` can take it.
 */
export const DocumentPatch = Schema.Struct({
  doc: DocRef,
  /** The state the change was made on. */
  from: Schema.String,
  hash: Schema.String,
  nodes: Schema.Array(ChangedNode),
  /** The root's id. */
  rootId: Schema.String,
});
export type DocumentPatch = typeof DocumentPatch.Type;

/**
 * A document changed, as the editor is told (ADR 0044): what changed when it can say so, the
 * whole document when it cannot (the first time, a file that does not read, ids that repeat).
 */
export const DocumentChange = Schema.Union([DocumentPatch, DocumentState]);
export type DocumentChange = typeof DocumentChange.Type;

/** Whether a change is the whole document. */
export const isWholeDocument = (
  change: DocumentChange
): change is DocumentState => !("from" in change);

/** What applying edits gives the editor that asked (ADR 0044): the documents as they changed. */
export const AppliedChanges = Schema.Struct({
  changes: Schema.Array(DocumentChange),
  created: Schema.Array(Schema.String),
});
export type AppliedChanges = typeof AppliedChanges.Type;
