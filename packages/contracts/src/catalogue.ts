import { Schema } from "effect";
import { Json, RepoRelativePath } from "./base.ts";

export const PropType = Schema.Struct({
  kind: Schema.Literals([
    "string",
    "number",
    "boolean",
    "enum",
    "node",
    "function",
    "object",
    "other",
  ]),
  members: Schema.optional(Schema.Array(Schema.String)),
  raw: Schema.String,
});
export type PropType = typeof PropType.Type;

export const PropMeta = Schema.Struct({
  defaultValue: Schema.optional(Json),
  description: Schema.optional(Schema.String),
  name: Schema.String,
  required: Schema.Boolean,
  type: PropType,
});
export type PropMeta = typeof PropMeta.Type;

export const ComponentMeta = Schema.Struct({
  category: Schema.String,
  description: Schema.optional(Schema.String),
  file: RepoRelativePath,
  group: Schema.String,
  /** Import specifier the screen should use, e.g. `@epicparty/ui-components/button`. */
  importFrom: Schema.String,
  name: Schema.String,
  props: Schema.Array(PropMeta),
  /**
   * Its parts (ADR 0040), the root first: a primitive's, by `data-slot`. A slot that `holds`
   * nodes is filled by the instance's children that name it; `default` takes the rest.
   */
  slots: Schema.optional(
    Schema.Array(
      Schema.Struct({
        holds: Schema.optional(Schema.Literals(["nodes", "default"])),
        label: Schema.String,
        layout: Schema.optional(Schema.Literals(["row", "column", "block"])),
        name: Schema.String,
      })
    )
  ),
  /** Default JSX snippet for insertion. */
  snippet: Schema.String,
  /** Storybook story ids usable as previews. */
  storyIds: Schema.Array(Schema.String),
  /** Variant axes: name -> members. */
  variants: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});
export type ComponentMeta = typeof ComponentMeta.Type;

export const Catalogue = Schema.Struct({
  builtAt: Schema.Number,
  components: Schema.Array(ComponentMeta),
  coverage: Schema.Struct({ total: Schema.Number, usable: Schema.Number }),
});
export type Catalogue = typeof Catalogue.Type;
