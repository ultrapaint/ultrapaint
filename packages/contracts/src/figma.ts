/**
 * A Figma file brought into the project. The file is read by fixed rules into a summary an
 * agent can reason about — the frames of each page, the components and where they are used —
 * and a mapping that says, per Figma component, which component of this repository stands in
 * for it. A frame is converted with the mapping into a page document.
 */
import { Schema } from "effect";
import { Json } from "./base.ts";

/** What a Figma property of a component becomes on the repository's component. */
export const PropRule = Schema.Struct({
  /** The prop of the repository's component the value goes to. */
  prop: Schema.optional(Schema.String),
  /** The property's value becomes the instance's text instead of a prop. */
  text: Schema.optional(Schema.Boolean),
  /** Figma value → prop value; a value not listed is passed on as it is when `prop` is set. */
  values: Schema.optional(Schema.Record(Schema.String, Json)),
});
export type PropRule = typeof PropRule.Type;

/**
 * How instances of one Figma component are converted: replaced by a component of the
 * repository, expanded into the plain nodes the Figma component is made of (custom), or left
 * out.
 */
export const ComponentMapping = Schema.Union([
  Schema.Struct({
    /** Export name of the repository's component, `Button`. */
    component: Schema.String,
    /** Module it is imported from; where the catalogue imports it from when left out. */
    from: Schema.optional(Schema.String),
    kind: Schema.Literal("component"),
    /** Figma property name → what it becomes. Properties not listed are dropped. */
    propMap: Schema.optional(Schema.Record(Schema.String, PropRule)),
    /** Props every instance gets. */
    props: Schema.optional(Schema.Record(Schema.String, Json)),
    /**
     * Where the instance's text comes from: `"children"` for the text the Figma instance shows,
     * or the name of a Figma text property.
     */
    text: Schema.optional(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("expand") }),
  Schema.Struct({ kind: Schema.Literal("skip") }),
]);
export type ComponentMapping = typeof ComponentMapping.Type;

export const FigmaPropType = Schema.Literals([
  "variant",
  "text",
  "boolean",
  "instance",
  "other",
]);
export type FigmaPropType = typeof FigmaPropType.Type;

/** A component of the repository that may stand in for a Figma one, by the look of its name. */
export const ComponentCandidate = Schema.Struct({
  importFrom: Schema.String,
  name: Schema.String,
  /** 0–1, from the names alone. */
  score: Schema.Number,
});
export type ComponentCandidate = typeof ComponentCandidate.Type;

export const FigmaComponent = Schema.Struct({
  candidates: Schema.Array(ComponentCandidate),
  description: Schema.optional(Schema.String),
  /** Unique in the file: the name, made unique when two components share it. */
  key: Schema.String,
  name: Schema.String,
  /** Page of the Figma file the component is defined on. */
  page: Schema.String,
  props: Schema.Array(
    Schema.Struct({ name: Schema.String, type: FigmaPropType })
  ),
  /** Instances in the file, nested ones included. */
  uses: Schema.Number,
  /** Variant property → its values, for a component set. */
  variants: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});
export type FigmaComponent = typeof FigmaComponent.Type;

export const FigmaFrame = Schema.Struct({
  height: Schema.Number,
  /** Figma's own id, `12:345`. */
  id: Schema.String,
  /** Instances of Figma components inside, nested ones included. */
  instances: Schema.Number,
  name: Schema.String,
  /** Layers inside, all kinds. */
  nodes: Schema.Number,
  page: Schema.String,
  width: Schema.Number,
});
export type FigmaFrame = typeof FigmaFrame.Type;

export const FigmaPage = Schema.Struct({
  frames: Schema.Array(FigmaFrame),
  name: Schema.String,
});
export type FigmaPage = typeof FigmaPage.Type;

/** An import as the server keeps it: what the file holds, and how its components map. */
export const FigmaImport = Schema.Struct({
  components: Schema.Array(FigmaComponent),
  createdAt: Schema.Number,
  id: Schema.String,
  /** Component key → how its instances convert. Unmapped components are expanded. */
  mapping: Schema.Record(Schema.String, ComponentMapping),
  /** The file's name, as uploaded. */
  name: Schema.String,
  pages: Schema.Array(FigmaPage),
  warnings: Schema.Array(Schema.String),
});
export type FigmaImport = typeof FigmaImport.Type;

/** The largest file the import accepts. */
export const MAX_FIG_BYTES = 200 * 1024 * 1024;
