import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";

/**
 * A space owns one router, one canvas and its own pages; a page of one space never navigates
 * to a page of another. A directory with a `space.json` is a space, and the designs directory
 * is one itself while no `space.json` exists below it.
 */
export const Space = Schema.Struct({
  /** Route the space opens on. */
  home: Schema.String,
  /** Path relative to the designs directory; `""` is the designs directory itself. */
  id: Schema.String,
  name: Schema.String,
});
export type Space = typeof Space.Type;

/** Contents of `<space>/space.json`. */
export const SpaceConfig = Schema.Struct({
  home: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  /**
   * Names of the variants a page of this space may be written for, in the order they are
   * offered. Reserved: nothing writes or reads a variant yet (ADR 0012).
   */
  variants: Schema.optional(Schema.Array(Schema.String)),
  version: Schema.Literal(1),
});
export type SpaceConfig = typeof SpaceConfig.Type;

export const emptySpaceConfig = (name: string): SpaceConfig => ({
  home: "/",
  name,
  version: 1,
});

/** A page is a file inside a space. `id` is its path relative to the designs directory. */
export const Page = Schema.Struct({
  file: RepoRelativePath,
  id: Schema.String,
  name: Schema.String,
  /** Path inside the space, which is what the canvas layout is keyed by. */
  path: Schema.String,
  /** Route the page serves inside its space, derived from `path`. */
  route: Schema.String,
  space: Schema.String,
});
export type Page = typeof Page.Type;

export const PageList = Schema.Struct({
  pages: Schema.Array(Page),
  spaces: Schema.Array(Space),
});
export type PageList = typeof PageList.Type;

export const ViewportPreset = Schema.Literals([
  "mobile",
  "tablet",
  "desktop",
  "custom",
]);
export type ViewportPreset = typeof ViewportPreset.Type;

export const presetSize: Record<
  Exclude<ViewportPreset, "custom">,
  { width: number; height: number }
> = {
  desktop: { height: 900, width: 1440 },
  mobile: { height: 844, width: 390 },
  tablet: { height: 1194, width: 834 },
};

export const FrameLayout = Schema.Struct({
  height: Schema.Number,
  preset: ViewportPreset,
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});
export type FrameLayout = typeof FrameLayout.Type;

/** Contents of `<space>/canvas.json`. Keys are page paths inside the space. */
export const CanvasLayout = Schema.Struct({
  frames: Schema.Record(Schema.String, FrameLayout),
  version: Schema.Literal(1),
});
export type CanvasLayout = typeof CanvasLayout.Type;

export const emptyCanvasLayout = (): CanvasLayout => ({
  frames: {},
  version: 1,
});
