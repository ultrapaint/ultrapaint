import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";
import { DesignNode } from "./document.ts";

/**
 * A canvas owns one router, one surface and its own pages; a page of one canvas never navigates
 * to a page of another. A directory with a `canvas.json` is a canvas, and the designs directory
 * is one itself while no `canvas.json` exists below it. Canvases share the design system and
 * the assets at the root of the designs directory.
 */
export const Canvas = Schema.Struct({
  /**
   * URL the canvas's prototype opens on: the one `canvas.json` names while a page serves it,
   * otherwise `/` while a page serves that, or the first URL a page serves.
   */
  home: Schema.String,
  /** Path relative to the designs directory; `""` is the designs directory itself. */
  id: Schema.String,
  name: Schema.String,
  /** States its pages are drawn in, one page each (ADR 0030): `empty`, `loading`. */
  states: Schema.optional(Schema.Array(Schema.String)),
  /** Variants its pages may be drawn in, in the order they are offered (ADR 0019). */
  variants: Schema.Array(Schema.String),
});
export type Canvas = typeof Canvas.Type;

/**
 * A page is a file inside a canvas, named by its file. `id` is its path relative to the designs
 * directory. Its URL is optional: a page without one is drawn and edited like any other, but
 * the prototype has no way to reach it and a link cannot lead to it.
 */
export const Page = Schema.Struct({
  canvas: Schema.String,
  file: RepoRelativePath,
  id: Schema.String,
  /** What the page is called, from its file name: `billing-settings.page.json` is "Billing settings". */
  name: Schema.String,
  /** Path inside the canvas, which is what the canvas layout is keyed by. */
  path: Schema.String,
  /**
   * The URL the page serves in its canvas's prototype, from the canvas's `routes`. A variant's
   * page serves its base page's URL. Absent when the page has none.
   */
  route: Schema.optional(Schema.String),
  /**
   * The state the page is its base page in (`orders@empty.page.json`, with `empty` in the
   * canvas's `states`, ADR 0030); a state's page has no `variant`.
   */
  state: Schema.optional(Schema.String),
  /** The variant the page is drawn for (`pricing@bold.page.json`); absent for the base. */
  variant: Schema.optional(Schema.String),
});
export type Page = typeof Page.Type;

export const PageList = Schema.Struct({
  /** In the order they are listed. */
  canvases: Schema.Array(Canvas),
  pages: Schema.Array(Page),
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
 * Contents of `<canvas>/canvas.json`, the file that makes a directory a canvas: its name, where
 * the pages' frames sit and which URL each page serves, both keyed by the page's path inside the
 * canvas, and the nodes placed on the canvas beside the pages, each at its own `x` and `y`.
 */
export const CanvasLayout = Schema.Struct({
  frames: Schema.Record(Schema.String, FrameLayout),
  /** URL the canvas opens on, which a page of it serves; `/`, or the first URL served, when absent. */
  home: Schema.optional(Schema.String),
  /** What the canvas is called in the list; its directory's name made readable when absent. */
  name: Schema.optional(Schema.String),
  /** Nodes on the canvas outside any page. Absent from layouts written before there were any. */
  nodes: Schema.optional(Schema.Array(DesignNode)),
  /**
   * The URL each base page serves in the prototype, keyed by its path inside the canvas; a page
   * it does not name has none. Absent from layouts written before pages had optional URLs: each
   * page then serves the route its path names (`settings/billing.page.json` is
   * `/settings/billing`), until the first change writes them out.
   */
  routes: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /**
   * Names its pages' states go by (ADR 0030): a `@name` file of a page is that page in the state,
   * not a prototype-wide variant.
   */
  states: Schema.optional(Schema.Array(Schema.String)),
  /** Names of the variants its pages may be drawn in, in the order they are offered. */
  variants: Schema.optional(Schema.Array(Schema.String)),
  version: Schema.Literal(1),
});
export type CanvasLayout = typeof CanvasLayout.Type;

/** Contents of `canvases.json` at the root of the designs directory: the order of the list. */
export const CanvasOrder = Schema.Struct({
  /** Canvas ids, first to last. A canvas it does not name comes after, by id. */
  order: Schema.Array(Schema.String),
  version: Schema.Literal(1),
});
export type CanvasOrder = typeof CanvasOrder.Type;

export const emptyCanvasLayout = (): CanvasLayout => ({
  frames: {},
  version: 1,
});

/**
 * Directory the images are kept in. The one at the root of the designs directory is shared by
 * every canvas, and a canvas may have its own, whose files take the place of the shared ones of
 * the same name: an image node's `assets/logo.png` is the canvas's own when it has one.
 */
export const ASSETS_DIR = "assets";

/** An image pasted or dropped on the canvas, saved into the shared assets. */
export const UploadAssetInput = Schema.Struct({
  /** File contents, base64. */
  data: Schema.String,
  /** Original file name, or a made-up one for a pasted image; the extension is kept. */
  name: Schema.String,
});
export type UploadAssetInput = typeof UploadAssetInput.Type;
