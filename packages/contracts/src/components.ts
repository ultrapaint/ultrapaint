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
  COMPONENT_EXTENSION,
  COMPONENT_STATES,
  COMPONENTS_DIR,
  isVariantKey,
  LEGACY_DRAFT_FROM,
  LEGACY_SPEC_EXTENSION,
  LEGACY_SPECS_DIR,
  LEGACY_SYSTEM_FROM,
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
export const PART_STYLE_FIELDS = Object.keys(
  PartStyle.fields
) as readonly (keyof PartStyle)[];

/** Style fields per part, by the part's name (its `data-slot`, or `root`). */
export const PartStyles = Schema.Record(Schema.String, PartStyle);
export type PartStyles = typeof PartStyles.Type;

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
  /** Where the Assets panel lists it. */
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
 * per variant axis and member, and per state; what each slot holds when an instance gives it
 * nothing; which optional parts it leaves out; and, for a Select or a Menu, what an item draws.
 * Its parts, axes and states are the catalogue's; behaviour is Base UI's, and its behavioural
 * parts are fixed: a component that adds behaviour or removes one of them is an app component
 * built on it.
 */
export const SystemComponentFile = Schema.Struct({
  ...envelope,
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
  origin: Schema.Literal("system"),
  /** Style fields per state, per part. */
  states: Schema.Record(Schema.String, PartStyles),
  /** Style fields per variant axis, per member, per part. */
  variants: Schema.Record(
    Schema.String,
    Schema.Record(Schema.String, PartStyles)
  ),
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

/**
 * A component spec as it was kept before ADR 0041 (`specs/<Component>.spec.json`): what the
 * migration reads to write the component's file. A draft (`draft`) becomes an app component, a
 * spec with the design's look a system component's file; a spec that mirrored the code
 * (`look: "code"`) drew nothing and is dropped.
 */
export const LegacyComponentSpec = Schema.Struct({
  base: PartStyles,
  component: Schema.String,
  description: Schema.optional(Schema.String),
  draft: Schema.optional(DesignNode),
  from: Schema.String,
  look: Schema.Literals(["design", "code"]),
  notes: Schema.optional(Schema.Array(ComponentNote)),
  states: Schema.Record(Schema.String, PartStyles),
  variants: Schema.Record(
    Schema.String,
    Schema.Record(Schema.String, PartStyles)
  ),
});
export type LegacyComponentSpec = typeof LegacyComponentSpec.Type;
