/**
 * The tools that list and manage pages: the project and its pages at a glance, the templates a
 * page starts from, and making, sizing and placing, renaming, giving a URL to, deleting and
 * duplicating a page, each through the operations the editor uses.
 */

import { Json } from "@ultrapaint/contracts/base";
import { boundsOf, canvasFrames } from "@ultrapaint/contracts/canvas-layout";
import type { FrameLayout } from "@ultrapaint/contracts/pages";
import { SelectedNode } from "@ultrapaint/contracts/rpc";
import type { VariationSet } from "@ultrapaint/contracts/variations";
import { pageTemplates } from "@ultrapaint/design-document/factories";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { DocumentService } from "../documents.ts";
import { EditorSelection } from "../editor-selection.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";
import { VariationRounds } from "../variation-rounds.ts";
import { VariationsService } from "../variations.ts";
import { makeLookup } from "./lookup.ts";
import {
  asJson,
  doing,
  missing,
  opt,
  reported,
  ToolFailure,
  within,
} from "./tool-helpers.ts";

/** A box on the canvas, in its coordinates. */
const CanvasBox = Schema.Struct({
  height: Schema.Number,
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});

const PageSummary = Schema.Struct({
  /** The box its frame takes with its views; absent when its canvas cannot be read. */
  bounds: Schema.optional(CanvasBox),
  canvas: Schema.String,
  file: Schema.String,
  /** Its frame where the editor draws it; absent when its canvas cannot be read. */
  frame: Schema.optional(CanvasBox),
  name: Schema.String,
  /** The URL the prototype serves it at; absent when it has none. */
  route: Schema.optional(Schema.String),
  /** Its variations (ADR 0098), the one in use marked; absent when it has none. */
  variations: Schema.optional(Schema.Array(Schema.String)),
});

const CanvasSummary = Schema.Struct({
  /** The URL its prototype opens on; set it with set_home. */
  home: Schema.String,
  /** What `canvas` takes: the designs directory's own is `""`. */
  id: Schema.String,
  name: Schema.String,
  pages: Schema.Number,
});

export const GetContext = Tool.make("get_context", {
  description:
    "The project: root, designs directory, canvases, and the nodes selected in the editor; list_pages has the pages and their variations. Call it first unless told the pages.",
  failure: ToolFailure,
  success: Schema.Struct({
    canvases: Schema.Array(CanvasSummary),
    designsDir: Schema.String,
    pageCount: Schema.Number,
    resolveFrom: Schema.String,
    root: Schema.String,
    /** What the person selected in the editor, by the references the tools take (ADR 0083). */
    selection: Schema.Array(SelectedNode),
  }),
}).annotateMerge(doing("read"));

const ListPages = Tool.make("list_pages", {
  description:
    "Every page: canvas, name, file, URL, variations (the one in use is the page), frame, bounds.",
  failure: ToolFailure,
  success: Schema.Struct({ pages: Schema.Array(PageSummary) }),
}).annotateMerge(doing("read"));

const SetFrame = Tool.make("set_frame", {
  description:
    "Size or move frames: preset or width/height (tall for a long page), views: widths beside it, x/y.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    canvas: opt(Schema.String),
    frames: Schema.Array(
      Schema.Struct({
        height: opt(within(100, 20_000)),
        preset: opt(Schema.Literals(["mobile", "tablet", "desktop"])),
        route: Schema.String,
        views: opt(Schema.Array(within(200, 8000))),
        width: opt(within(200, 8000)),
        x: opt(Schema.Finite),
        y: opt(Schema.Finite),
      })
    ),
  }),
  success: Schema.Struct({
    /** Each frame named, where it is after the call. */
    frames: Schema.Array(
      Schema.Struct({ ...CanvasBox.fields, file: Schema.String })
    ),
  }),
}).annotateMerge(doing("edit", { idempotent: true }));

const CreatePage = Tool.make("create_page", {
  description:
    "Add a page, its file named after it (billing-settings.page.json); route for a screen of the application, none for a sketch.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    canvas: opt(Schema.String),
    /** What the page is called: "Billing settings". */
    name: Schema.String,
    /** The URL it serves in the prototype, `/settings/billing`; none when left out. */
    route: opt(Schema.String),
    /** One of the ids list_templates gives; the blank one when left out. */
    template: opt(Schema.String),
  }),
  success: Schema.Struct({
    document: Json,
    file: Schema.String,
    route: Schema.optional(Schema.String),
  }),
}).annotateMerge(doing("edit"));

const RenamePage = Tool.make("rename_page", {
  description: "Rename a page and its states' files; its URL and links stay.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    name: Schema.String,
    route: Schema.String,
  }),
  success: Schema.Struct({ file: Schema.String }),
}).annotateMerge(doing("edit"));

const SetPageUrl = Tool.make("set_page_url", {
  description:
    "Set the URL a page serves in its canvas's prototype, null for none; links to the old one break.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    route: Schema.String,
    /** The new URL, `/settings/billing`; null for none. */
    url: Schema.NullOr(Schema.String),
  }),
  success: Schema.Struct({
    file: Schema.String,
    route: Schema.optional(Schema.String),
  }),
}).annotateMerge(doing("edit", { idempotent: true }));

const DeletePage = Tool.make("delete_page", {
  description:
    "Delete a page with its states and comments; links to it break (list_links).",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    route: Schema.String,
  }),
  success: Schema.Struct({
    /** Every file deleted: the page's, then its states'. */
    deleted: Schema.Array(Schema.String),
  }),
}).annotateMerge(doing("destructive"));

const DuplicatePage = Tool.make("duplicate_page", {
  description:
    "Copy a page beside it (pricing-2.page.json), node ids kept, with no URL.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    route: Schema.String,
  }),
  success: Schema.Struct({ file: Schema.String }),
}).annotateMerge(doing("edit"));

const ListTemplates = Tool.make("list_templates", {
  description: "The templates create_page starts from.",
  failure: ToolFailure,
  success: Schema.Struct({
    templates: Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String })
    ),
  }),
}).annotateMerge(doing("read"));

export const PageTools = Toolkit.make(
  GetContext,
  ListPages,
  SetFrame,
  CreatePage,
  RenamePage,
  SetPageUrl,
  DeletePage,
  DuplicatePage,
  ListTemplates
);

/** A page's variations as `list_pages` says them: by name, the one in use marked (ADR 0098). */
const variationNames = (set: VariationSet | undefined): string[] =>
  (set?.variations ?? []).map((v) =>
    v.id === set?.inUse ? `${v.name} (in use)` : v.name
  );

/** A frame's own box, without its views. */
const boxOf = ({ height, width, x, y }: FrameLayout) => ({
  height,
  width,
  x,
  y,
});

const NO_FRAMES: Readonly<Record<string, FrameLayout>> = {};

export const PageToolsLive = PageTools.toLayer(
  Effect.gen(function* () {
    const {
      canvasOf,
      documents,
      pageAt,
      pageWhere,
      pagesOf,
      pagesService,
      project,
    } = yield* makeLookup;
    const selected = yield* EditorSelection;

    /** The variations of a page's root; none for a page that cannot be read. */
    const variationsOfPage = (doc: string) =>
      project
        .use(
          Effect.gen(function* () {
            const { root } = yield* (yield* DocumentService).get(doc);
            const sets = yield* (yield* VariationsService).sets(doc);
            return root === null ? [] : variationNames(sets[root.id]);
          })
        )
        .pipe(Effect.orElseSucceed((): string[] => []));

    /**
     * A page `set_frame` names, in the call's canvas: a page of another canvas refuses the call
     * with why, rather than a miss.
     */
    const pageIn = (route: string, canvas: string) =>
      Effect.catchTag(pageAt(route, canvas), "ToolFailure", (missed) =>
        Effect.flatMap(Effect.option(pageAt(route, undefined)), (other) =>
          other._tag === "Some" && other.value.canvas !== canvas
            ? missing(
                `one canvas per call: ${other.value.file} is in ${JSON.stringify(other.value.canvas)}, not ${JSON.stringify(canvas)}`
              )
            : Effect.fail(missed)
        )
      );

    return PageTools.of({
      create_page: Effect.fn("EditorTools.create_page")(function* ({
        canvas,
        name,
        route,
        template,
      }) {
        const id = yield* canvasOf(canvas);
        const page = yield* pagesService((pages) =>
          pages.create(id, { name, route }, template)
        );
        const state = yield* documents((d) => d.get(page.id));
        return {
          document: asJson(state.root),
          file: page.file,
          ...(page.route !== undefined && { route: page.route }),
        };
      }),

      delete_page: Effect.fn("EditorTools.delete_page")(function* ({
        route,
        canvas,
      }) {
        const page = yield* pageAt(route, canvas);
        const gone = yield* pagesService((service) =>
          service.delete([page.id])
        );
        return { deleted: gone.map((p) => p.file) };
      }),

      duplicate_page: Effect.fn("EditorTools.duplicate_page")(function* ({
        route,
        canvas,
      }) {
        const page = yield* pageAt(route, canvas);
        const copy = yield* pagesService((pages) => pages.duplicate(page.id));
        return { file: copy.file };
      }),

      get_context: Effect.fn("EditorTools.get_context")(function* () {
        const paths = yield* reported(project.use(RepoPaths));
        const pages = yield* reported(pagesOf);
        const selection = yield* selected.current;
        return {
          canvases: pages.canvases.map((canvas) => ({
            home: canvas.home,
            id: canvas.id,
            name: canvas.name,
            pages: pages.pages.filter((p) => p.canvas === canvas.id).length,
          })),
          designsDir: paths.settings.designsDir,
          pageCount: pages.pages.length,
          resolveFrom: paths.settings.resolveFrom ?? paths.settings.designsDir,
          root: paths.root,
          selection,
        };
      }),

      list_pages: Effect.fn("EditorTools.list_pages")(function* () {
        const pages = yield* reported(pagesOf);
        // Each canvas's frames as the editor draws them, a page with none saved included.
        const drawn = yield* Effect.forEach(pages.canvases, (c) =>
          project
            .use(
              Effect.flatMap(PagesService, (service) =>
                service.readCanvas(c.id)
              )
            )
            .pipe(
              Effect.map((layout) =>
                canvasFrames(
                  pages.pages
                    .filter((p) => p.canvas === c.id)
                    .map((p) => p.path),
                  layout.frames
                )
              ),
              // A canvas whose `canvas.json` cannot be read still lists its pages, without frames.
              Effect.catchTags({
                Conflict: () => Effect.succeed(NO_FRAMES),
                NotFound: () => Effect.succeed(NO_FRAMES),
              }),
              reported,
              Effect.map((frames) => [c.id, frames] as const)
            )
        );
        const framesOf = new Map(drawn);
        const listed = yield* Effect.forEach(pages.pages, (page) =>
          Effect.map(variationsOfPage(page.id), (variations) => {
            const frame = framesOf.get(page.canvas)?.[page.path];
            return {
              canvas: page.canvas,
              file: page.file,
              name: page.name,
              ...(page.route !== undefined && { route: page.route }),
              ...(variations.length > 0 && { variations }),
              ...(frame && { bounds: boundsOf(frame), frame: boxOf(frame) }),
            };
          })
        );
        return { pages: listed };
      }),

      list_templates: () =>
        Effect.succeed({
          templates: pageTemplates.map((t) => ({ id: t.id, name: t.name })),
        }),

      rename_page: Effect.fn("EditorTools.rename_page")(function* ({
        route,
        canvas,
        name,
      }) {
        const { page, takeOf } = yield* pageWhere(route, canvas);
        if (takeOf !== undefined) {
          // A working copy named is a take handed in (ADR 0098): it is saved, and goes.
          yield* reported(
            project.use(
              Effect.flatMap(VariationRounds, (rounds) =>
                rounds.handIn(page.id, name)
              )
            )
          );
          return { file: page.file };
        }
        const moved = yield* pagesService((pages) =>
          pages.rename(page.id, name)
        );
        return { file: moved.file };
      }),

      set_frame: Effect.fn("EditorTools.set_frame")(function* ({
        canvas,
        frames,
      }) {
        const [head] = frames;
        if (!head) {
          return yield* missing("frames is empty: name a page's frame in it");
        }
        // One canvas per call: the one given, or the one the first page is in.
        const id = canvas ?? (yield* pageAt(head.route, undefined)).canvas;
        const named = yield* Effect.forEach(frames, (frame) =>
          Effect.map(pageIn(frame.route, id), (page) => ({ frame, page }))
        );
        // Sized and placed from the layout as it is when the frames are written, and those
        // alone written: the others may have moved since the agent last looked.
        const placed = yield* pagesService((service) =>
          service.arrangeFrames(
            id,
            named.map(({ frame, page }) => ({
              path: page.path,
              size: {
                height: frame.height,
                preset: frame.preset,
                views: frame.views,
                width: frame.width,
              },
              x: frame.x,
              y: frame.y,
            }))
          )
        );
        const pages = new Map(named.map(({ page }) => [page.path, page]));
        return {
          frames: [...pages.values()].flatMap((page) => {
            const frame = placed[page.path];
            return frame ? [{ ...boxOf(frame), file: page.file }] : [];
          }),
        };
      }),

      set_page_url: Effect.fn("EditorTools.set_page_url")(function* ({
        route,
        canvas,
        url,
      }) {
        const page = yield* pageAt(route, canvas);
        const changed = yield* pagesService((pages) =>
          pages.setRoute(page.id, url)
        );
        return {
          file: changed.file,
          ...(changed.route !== undefined && { route: changed.route }),
        };
      }),
    });
  })
);
