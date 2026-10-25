/**
 * Component specs (ADR 0029): what a component looks like, as the design says it, apart from what
 * it does, which stays the code's. A spec lives in the designs directory as
 * `specs/<Component>.spec.json`; with `look: "design"` the preview draws it over the repository's
 * component, with `look: "code"` it mirrors the code and draws nothing. A `draft` spec is a
 * component the code does not have yet: a tree of nodes drawn in the instance's place.
 */
import { Schema } from "effect";
import { Border, Color, DesignNode, Length, Padding } from "./document.ts";

/** Where specs live, inside the designs directory. */
export const SPECS_DIR = "specs";
export const SPEC_EXTENSION = ".spec.json";
/** What a draft component's instances name as `from`. */
export const DRAFT_FROM = "#draft";

/** The states a spec can style. */
export const SpecState = Schema.Literals([
  "hover",
  "focus",
  "active",
  "disabled",
  "open",
  "checked",
  "invalid",
]);
export type SpecState = typeof SpecState.Type;
export const SPEC_STATES: readonly SpecState[] = SpecState.literals;

/** The style fields a spec sets on one slot: the design document's own, tokens included. */
export const SpecStyle = Schema.Struct({
  border: Schema.optional(Border),
  color: Schema.optional(Color),
  fill: Schema.optional(Color),
  fontSize: Schema.optional(Length),
  fontWeight: Schema.optional(Length),
  gap: Schema.optional(Length),
  height: Schema.optional(Length),
  opacity: Schema.optional(
    Schema.Number.check(Schema.isBetween({ maximum: 1, minimum: 0 }))
  ),
  padding: Schema.optional(Padding),
  radius: Schema.optional(Length),
  shadow: Schema.optional(Schema.String),
  width: Schema.optional(Length),
});
export type SpecStyle = typeof SpecStyle.Type;
export const SPEC_STYLE_FIELDS = Object.keys(
  SpecStyle.fields
) as readonly (keyof SpecStyle)[];

/** Style fields per slot, by the slot's name (its `data-slot`, or `root`). */
export const SlotStyles = Schema.Record(Schema.String, SpecStyle);
export type SlotStyles = typeof SlotStyles.Type;

/** The slot every spec has: the element the component renders at its root. */
export const ROOT_SLOT = "root";

export const SpecSlot = Schema.Struct({
  /** What the editor calls it; the name otherwise. */
  label: Schema.optional(Schema.String),
  /** `root`, or the `data-slot` of a part inside the component. */
  name: Schema.String,
});
export type SpecSlot = typeof SpecSlot.Type;

export const SpecLook = Schema.Literals(["design", "code"]);
export type SpecLook = typeof SpecLook.Type;

export const ComponentSpec = Schema.Struct({
  /** Style fields every instance starts from. */
  base: SlotStyles,
  /** The component's export name, as an instance names it. */
  component: Schema.String,
  /** The member each variant axis starts in when an instance does not say. */
  defaults: Schema.Record(Schema.String, Schema.String),
  /** What the component is for, in a sentence. */
  description: Schema.optional(Schema.String),
  /** A draft's tree: the component the code does not have yet. */
  draft: Schema.optional(DesignNode),
  /** The module it is imported from, as an instance names it; `#draft` for a draft. */
  from: Schema.String,
  look: SpecLook,
  slots: Schema.Array(SpecSlot),
  /** Style fields per state, per slot. */
  states: Schema.Record(Schema.String, SlotStyles),
  /** Style fields per variant axis, per member, per slot. */
  variants: Schema.Record(
    Schema.String,
    Schema.Record(Schema.String, SlotStyles)
  ),
  version: Schema.Literal(1),
});
export type ComponentSpec = typeof ComponentSpec.Type;

/** A spec as the editor lists it: where its file is, and the spec when it reads. */
export const SpecEntry = Schema.Struct({
  /** Designs-relative, posix: `specs/Button.spec.json`. */
  file: Schema.String,
  /** Why the file does not read, when it does not. */
  problem: Schema.optional(Schema.String),
  spec: Schema.optional(ComponentSpec),
});
export type SpecEntry = typeof SpecEntry.Type;

export const SpecList = Schema.Struct({
  specs: Schema.Array(SpecEntry),
});
export type SpecList = typeof SpecList.Type;

/** The file a component's spec is kept in, inside the designs directory. */
export const specFileOf = (component: string) =>
  `${SPECS_DIR}/${component}${SPEC_EXTENSION}`;

/** An empty spec for a component: everything left to the code until a field is set. */
export const emptySpec = (
  component: string,
  from: string,
  look: SpecLook = "design"
): ComponentSpec => ({
  base: {},
  component,
  defaults: {},
  from,
  look,
  slots: [{ name: ROOT_SLOT }],
  states: {},
  variants: {},
  version: 1,
});
