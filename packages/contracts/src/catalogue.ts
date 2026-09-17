import * as S from "effect/Schema";
import { Json, RepoRelativePath } from "./base.ts";

export const PropType = S.Struct({
  kind: S.Literal("string", "number", "boolean", "enum", "node", "function", "object", "other"),
  members: S.optional(S.Array(S.String)),
  raw: S.String,
});
export type PropType = typeof PropType.Type;

export const PropMeta = S.Struct({
  name: S.String,
  type: PropType,
  required: S.Boolean,
  defaultValue: S.optional(Json),
  description: S.optional(S.String),
});
export type PropMeta = typeof PropMeta.Type;

export const ComponentMeta = S.Struct({
  name: S.String,
  /** Import specifier the screen should use, e.g. `@epicparty/ui-components/button`. */
  importFrom: S.String,
  file: RepoRelativePath,
  group: S.String,
  category: S.String,
  description: S.optional(S.String),
  props: S.Array(PropMeta),
  /** `cva` variants: name -> members. */
  variants: S.Record({ key: S.String, value: S.Array(S.String) }),
  /** Default JSX snippet for insertion. */
  snippet: S.String,
  /** Storybook story ids usable as previews. */
  storyIds: S.Array(S.String),
});
export type ComponentMeta = typeof ComponentMeta.Type;

export const Catalogue = S.Struct({
  builtAt: S.Number,
  components: S.Array(ComponentMeta),
  coverage: S.Struct({ total: S.Number, usable: S.Number }),
});
export type Catalogue = typeof Catalogue.Type;
