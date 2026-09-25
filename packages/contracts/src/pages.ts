import { Schema } from "effect";
import { RepoRelativePath, SourceLocation } from "./base.ts";
import { ImportSpec } from "./edit.ts";

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

/**
 * Contents of `<space>/canvas.json`. Keys are paths inside the space: of pages for `frames`, of
 * canvas items for `items`.
 */
export const CanvasLayout = Schema.Struct({
  frames: Schema.Record(Schema.String, FrameLayout),
  /** Where the canvas items sit. Absent from layouts written before there were any. */
  items: Schema.optional(Schema.Record(Schema.String, FrameLayout)),
  version: Schema.Literal(1),
});
export type CanvasLayout = typeof CanvasLayout.Type;

export const emptyCanvasLayout = (): CanvasLayout => ({
  frames: {},
  version: 1,
});

/**
 * Directory of a space that holds its canvas items: components and images placed on the canvas
 * beside the pages rather than inside one. Each item is a module of its own, so it renders with
 * the design system, is edited like a page and can be dragged into one. The leading underscore
 * keeps it out of the page list.
 */
export const CANVAS_ITEMS_DIR = "_canvas";

/** Directory of a space the images put on the canvas are saved in. */
export const CANVAS_ASSETS_DIR = "assets";

/** A new canvas item, from JSX the editor already has: a palette component dropped on the canvas. */
export const CreateItemInput = Schema.Struct({
  /** Where it goes on the canvas: placing it is part of the same undo step. */
  frame: FrameLayout,
  imports: Schema.Array(ImportSpec),
  jsx: Schema.String,
  /** Suggested name; the file is named after it. */
  name: Schema.String,
  space: Schema.String,
});
export type CreateItemInput = typeof CreateItemInput.Type;

/** A canvas item made of an element of a page, which moves out of it unless `copy`. */
export const ExtractItemInput = Schema.Struct({
  copy: Schema.Boolean,
  frame: FrameLayout,
  source: SourceLocation,
  space: Schema.String,
});
export type ExtractItemInput = typeof ExtractItemInput.Type;

/** An image pasted or dropped on the canvas. */
export const AddImageInput = Schema.Struct({
  /** File contents, base64. */
  data: Schema.String,
  frame: FrameLayout,
  /** Original file name, or a made-up one for a pasted image; the extension is kept. */
  name: Schema.String,
  space: Schema.String,
});
export type AddImageInput = typeof AddImageInput.Type;

export const CanvasItemResult = Schema.Struct({
  /** Shaped as a page: it is shown, selected and edited like one. */
  item: Page,
  /** What the item's code may not carry over: names the element used that stayed behind. */
  warnings: Schema.Array(Schema.String),
});
export type CanvasItemResult = typeof CanvasItemResult.Type;

/** Takes an item off the canvas: its module and its place in the layout, as one undo step. */
export const RemoveItemInput = Schema.Struct({
  id: Schema.String,
  space: Schema.String,
});
export type RemoveItemInput = typeof RemoveItemInput.Type;

/** Puts what an item renders into a page, and takes the item away unless `copy`. */
export const PlaceItemInput = Schema.Struct({
  copy: Schema.Boolean,
  id: Schema.String,
  index: Schema.Int,
  into: SourceLocation,
  /** The element the item renders. */
  root: SourceLocation,
  space: Schema.String,
});
export type PlaceItemInput = typeof PlaceItemInput.Type;
