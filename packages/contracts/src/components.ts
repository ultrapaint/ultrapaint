/**
 * Components (ADR 0041): everything an instance places is a component, of two origins. A
 * **system component** is one of the editor's own on Base UI (ADR 0040), its look the project's
 * design system; an **app component** is the project's own, a tree of nodes built from system
 * components and other app components. Each is a file of the designs directory,
 * `components/<Name>.component.json`, in one envelope (`version`, `name`, `origin`, a description,
 * a category, behaviour notes) with a body of its origin's. A system component with no file draws
 * in its default look; an app component cannot take a system component's name.
 */
import { Schema } from "effect";
import { Json } from "./base.ts";
import {
  COMPONENT_EXTENSION,
  COMPONENT_STATES,
  COMPONENTS_DIR,
} from "./component-names.ts";
import {
  Border,
  Color,
  CrossAlign,
  DesignNode,
  Length,
  MainAlign,
  Padding,
} from "./document.ts";

// biome-ignore lint/performance/noBarrelFile: the names live apart so the preview loads no schema; the components' users find them here too.
export {
  APP_FROM,
  COMPONENT_DOC_PREFIX,
  COMPONENT_EXTENSION,
  COMPONENT_STATES,
  COMPONENTS_DIR,
  componentDocOf,
  componentOfDoc,
  isVariantKey,
  ROOT_SLOT,
  SYSTEM_FROM,
  variantKey,
} from "./component-names.ts";

/** The states a system component's look can be given for. */
export const ComponentState = Schema.Literals(COMPONENT_STATES);
export type ComponentState = typeof ComponentState.Type;

/**
 * The style fields a system component's look sets on one part: the design document's own, tokens
 * included, and how the part lays out what it holds (`direction`, `align`, `crossAlign`, `gap`,
 * `padding` per side) and where it goes among its siblings (`order`).
 */
export const PartStyle = Schema.Struct({
  /** Along the direction. */
  align: Schema.optional(MainAlign),
  border: Schema.optional(Border),
  color: Schema.optional(Color),
  /** Across the direction. */
  crossAlign: Schema.optional(CrossAlign),
  /** The part lays out what it holds as a row or a column. */
  direction: Schema.optional(Schema.Literals(["row", "column"])),
  fill: Schema.optional(Color),
  fontSize: Schema.optional(Length),
  fontWeight: Schema.optional(Length),
  gap: Schema.optional(Length),
  height: Schema.optional(Length),
  opacity: Schema.optional(
    Schema.Number.check(Schema.isBetween({ maximum: 1, minimum: 0 }))
  ),
  /** Its place among its siblings as drawn (CSS `order`): lower first, 0 when absent. */
  order: Schema.optional(Schema.Number),
  padding: Schema.optional(Padding),
  radius: Schema.optional(Length),
  shadow: Schema.optional(Schema.String),
  width: Schema.optional(Length),
});
export type PartStyle = typeof PartStyle.Type;
/** Style fields per part, by the part's name (its `data-slot`, or `root`). */
export const PartStyles = Schema.Record(Schema.String, PartStyle);
export type PartStyles = typeof PartStyles.Type;

/** Style fields per state, per part. */
export const StateStyles = Schema.Record(Schema.String, PartStyles);
export type StateStyles = typeof StateStyles.Type;

/**
 * A behaviour note on a component (ADR 0030): what its code must do that the design cannot show
 * ("closes on Escape and gives the focus back"), about one part (a system component's part, an
 * app component's slot or node) or the whole component. Kept in the component's file, so it is
 * part of what tells the component changed since it was implemented, and carried by its
 * `/implement`.
 */
export const ComponentNote = Schema.Struct({
  id: Schema.String,
  /** The part it is about; the whole component when left out. */
  slot: Schema.optional(Schema.String),
  text: Schema.String,
});
export type ComponentNote = typeof ComponentNote.Type;

export const ComponentOrigin = Schema.Literals(["system", "app"]);
export type ComponentOrigin = typeof ComponentOrigin.Type;

/** What every component's file has, whatever its origin. */
const envelope = {
  /** Where the Library lists it. */
  category: Schema.optional(Schema.String),
  /** What the component is for, in a sentence. */
  description: Schema.optional(Schema.String),
  /** The component's name, as an instance names it: PascalCase. */
  name: Schema.String,
  /** Behaviour notes: what the code must do that the design cannot show. */
  notes: Schema.optional(Schema.Array(ComponentNote)),
  version: Schema.Literal(1),
};

/**
 * What a Select or a Menu draws for each of its items (ADR 0041): design nodes, the item's label
 * in the text node `label` names and its picture in the image `image` names. Selecting and
 * highlighting an item stay Base UI's.
 */
export const ItemTemplate = Schema.Struct({
  /** The image node that shows the item's picture, when it has one. */
  image: Schema.optional(Schema.String),
  /** The text node that shows the item's label. */
  label: Schema.optional(Schema.String),
  tree: DesignNode,
});
export type ItemTemplate = typeof ItemTemplate.Type;

/**
 * A system component's look as the project's design says it: style fields per part at its base,
 * per variant axis and member, per state, and per state in one variant member (ADR 0044); what
 * each slot holds when an instance gives it
 * nothing; which optional parts it leaves out; and, for a Select or a Menu, what an item draws.
 * Its parts, axes and states are the catalogue's; behaviour is Base UI's, and its behavioural
 * parts are fixed: a component that adds behaviour or removes one of them is an app component
 * built on it.
 */
const lookFields = {
  /** Style fields every instance starts from, per part. */
  base: PartStyles,
  /** What each slot holds when an instance gives it nothing, by the slot's name. */
  content: Schema.optional(
    Schema.Record(Schema.String, Schema.Array(DesignNode))
  ),
  /** The optional parts left out (the catalogue says which are). */
  hidden: Schema.optional(Schema.Array(Schema.String)),
  /** What each item of a Select or a Menu draws. */
  item: Schema.optional(ItemTemplate),
  /** Style fields per state, per part. */
  states: StateStyles,
  /**
   * Style fields per variant axis, per member, per state, per part: a state as one member draws
   * it (an outline button's hover). It wins over the state's own fields, which win over the
   * member's, which win over the base; disabled's win over every other state's.
   */
  variantStates: Schema.optional(
    Schema.Record(Schema.String, Schema.Record(Schema.String, StateStyles))
  ),
  /** Style fields per variant axis, per member, per part. */
  variants: Schema.Record(
    Schema.String,
    Schema.Record(Schema.String, PartStyles)
  ),
};

/** A variant axis's member a place of a look is in: `variant: outline`. */
export const LookMember = Schema.Struct({
  axis: Schema.String,
  member: Schema.String,
});
export type LookMember = typeof LookMember.Type;

/**
 * Where a part's style is set in a system component's look (ADR 0044): its base when neither is
 * given, a variant's member, a state, or a state as one member draws it.
 */
export const LookPlace = Schema.Struct({
  state: Schema.NullOr(ComponentState),
  variant: Schema.NullOr(LookMember),
});
export type LookPlace = typeof LookPlace.Type;

/** A system component's look: its file but the envelope. */
export const SystemLook = Schema.Struct(lookFields);
export type SystemLook = typeof SystemLook.Type;

const { states, variants, variantStates, ...unordered } = lookFields;
export const SystemComponentFile = Schema.Struct({
  ...envelope,
  // In the order a file has always been written in.
  ...unordered,
  origin: Schema.Literal("system"),
  states,
  variantStates,
  variants,
});
export type SystemComponentFile = typeof SystemComponentFile.Type;

export const PropertyKind = Schema.Literals([
  "text",
  "boolean",
  "choice",
  "image",
]);
export type PropertyKind = typeof PropertyKind.Type;

/**
 * Where a property's value goes in an app component's tree: a node's own field for the
 * property's kind (a text's text, an instance's text, a node's visibility, an image's source),
 * or, with `prop`, a property of the component instance the node is.
 */
export const PropertyTarget = Schema.Struct({
  node: Schema.String,
  prop: Schema.optional(Schema.String),
});
export type PropertyTarget = typeof PropertyTarget.Type;

/**
 * A property an app component's instance sets (`props`, by the property's name). A choice picks
 * one of its members, whose overrides the tree's nodes keep in their `at` under
 * `<property>=<member>`, as they keep a breakpoint's.
 */
export const ComponentProperty = Schema.Struct({
  /** What an instance that does not set it is drawn with. */
  default: Json,
  kind: PropertyKind,
  /** A choice's members, the default among them. */
  members: Schema.optional(Schema.Array(Schema.String)),
  name: Schema.String,
  /** Where the value goes; a choice may have none, its members being variants. */
  targets: Schema.optional(Schema.Array(PropertyTarget)),
});
export type ComponentProperty = typeof ComponentProperty.Type;

/**
 * A container of an app component's tree that an instance's children fill: those that name the
 * slot (`slot`), or, for the default slot, those that name none. Filled, it holds them in place of
 * what it holds in the tree.
 */
export const AppSlot = Schema.Struct({
  default: Schema.optional(Schema.Boolean),
  label: Schema.optional(Schema.String),
  name: Schema.String,
  /** The container's id in the tree. */
  node: Schema.String,
});
export type AppSlot = typeof AppSlot.Type;

/** An app component: a tree of nodes, its properties and its slots. */
export const AppComponentFile = Schema.Struct({
  ...envelope,
  origin: Schema.Literal("app"),
  properties: Schema.Array(ComponentProperty),
  slots: Schema.Array(AppSlot),
  /** What every instance draws, its root the instance on the page. */
  tree: DesignNode,
});
export type AppComponentFile = typeof AppComponentFile.Type;

export const ComponentFile = Schema.Union([
  SystemComponentFile,
  AppComponentFile,
]);
export type ComponentFile = typeof ComponentFile.Type;

/**
 * A change to a component's file (ADR 0042), made on the file as it is when the server applies it,
 * so a change made meanwhile (a tree edited in place, a note added, another part's style) is not
 * lost: an app component's properties or slots, one thing of a system component's look (a part's
 * style at a place, an optional part left out, a slot's content, the items' template), a
 * behaviour note added or taken out. A property or a member renamed or taken out is followed by
 * the variants its tree keeps (`at["size=lg"]`) and by every instance's props, in one undo step.
 */
export const ComponentChange = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("addProperty"),
    property: ComponentProperty,
  }),
  /** What it starts as, a choice's members, the nodes it sets: what is given, the rest kept. */
  Schema.Struct({
    default: Schema.optional(Json),
    members: Schema.optional(Schema.Array(Schema.String)),
    name: Schema.String,
    op: Schema.Literal("setProperty"),
    targets: Schema.optional(Schema.Array(PropertyTarget)),
  }),
  Schema.Struct({
    name: Schema.String,
    op: Schema.Literal("renameProperty"),
    to: Schema.String,
  }),
  Schema.Struct({ name: Schema.String, op: Schema.Literal("removeProperty") }),
  Schema.Struct({
    member: Schema.String,
    op: Schema.Literal("renameMember"),
    property: Schema.String,
    to: Schema.String,
  }),
  Schema.Struct({ op: Schema.Literal("addSlot"), slot: AppSlot }),
  Schema.Struct({ name: Schema.String, op: Schema.Literal("removeSlot") }),
  /** The slot that takes the children naming none; none with null. */
  Schema.Struct({
    name: Schema.NullOr(Schema.String),
    op: Schema.Literal("defaultSlot"),
  }),
  /**
   * One part's style at one place of a system component's look (ADR 0045), what the rest of the
   * look says kept as it is in the file: an empty style takes the part out of that place.
   */
  Schema.Struct({
    op: Schema.Literal("setStyle"),
    place: LookPlace,
    slot: Schema.String,
    style: PartStyle,
  }),
  /** An optional part of a system component's look left out, or shown again. */
  Schema.Struct({
    hidden: Schema.Boolean,
    op: Schema.Literal("setHidden"),
    part: Schema.String,
  }),
  /** What a system component's slot holds when an instance gives it nothing; none with no nodes. */
  Schema.Struct({
    nodes: Schema.Array(DesignNode),
    op: Schema.Literal("setContent"),
    slot: Schema.String,
  }),
  /** What a Select's or a Menu's item draws; its label alone with null. */
  Schema.Struct({
    item: Schema.NullOr(ItemTemplate),
    op: Schema.Literal("setItem"),
  }),
  /** A behaviour note (ADR 0030) about a part, or the whole; the server gives it its id. */
  Schema.Struct({
    op: Schema.Literal("addNote"),
    slot: Schema.optional(Schema.String),
    text: Schema.String,
  }),
  Schema.Struct({ id: Schema.String, op: Schema.Literal("removeNote") }),
]);
export type ComponentChange = typeof ComponentChange.Type;

/** A component's file as the editor lists it: where it is, and the component when it reads. */
export const ComponentEntry = Schema.Struct({
  component: Schema.optional(ComponentFile),
  /** Designs-relative, posix: `components/Button.component.json`. */
  file: Schema.String,
  /** Why the file does not read, when it does not. */
  problem: Schema.optional(Schema.String),
});
export type ComponentEntry = typeof ComponentEntry.Type;

export const ComponentList = Schema.Struct({
  components: Schema.Array(ComponentEntry),
});
export type ComponentList = typeof ComponentList.Type;

/** The file a component is kept in, inside the designs directory. */
export const componentFileOf = (name: string) =>
  `${COMPONENTS_DIR}/${name}${COMPONENT_EXTENSION}`;

/** A system component's file that sets nothing: drawn in its default look. */
export const emptySystemComponent = (name: string): SystemComponentFile => ({
  base: {},
  name,
  origin: "system",
  states: {},
  variants: {},
  version: 1,
});

/** The files that are app components'. */
export const appComponentsIn = (
  components: readonly ComponentFile[]
): AppComponentFile[] =>
  components.flatMap((c) => (c.origin === "app" ? [c] : []));

/** The files that are system components'. */
export const systemComponentsIn = (
  components: readonly ComponentFile[]
): SystemComponentFile[] =>
  components.flatMap((c) => (c.origin === "system" ? [c] : []));
