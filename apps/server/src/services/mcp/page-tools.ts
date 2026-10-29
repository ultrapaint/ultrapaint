/**
 * The tools that list and manage pages: the project and its pages at a glance, the templates a
 * page starts from, and making, sizing, renaming, giving a URL to, deleting and duplicating a
 * page, each through the operations the editor uses.
 */

import { Json } from "@ultrapaint/contracts/base";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { RepoPaths } from "../repo-paths.ts";
import { makeLookup } from "./lookup.ts";
import {
  asJson,
  finite,
  opt,
  PAGE_PARAMETER,
  reported,
  ToolFailure,
} from "./tool-helpers.ts";

const Failure = ToolFailure;

/**
 * What a thread's briefing explains and the tools' descriptions therefore leave out, for an agent
 * outside the editor, which has no briefing. `get_context` answers with it, once, rather than
 * every tool carrying a share of it on every turn.
 */
const GUIDE = `Designs are kept in canvases. Each has its own pages, the URLs they serve in its prototype, and loose nodes placed beside the pages; when there are several, tools take canvas (an id from canvases; the designs directory's own is ""). A page is a <name>.page.json design document, not code: a tree of nodes (page, row, column, group, text, image, and instance of one of ultrapaint's system components, its children filling its slots), each with an id. Its URL is optional, and a page without one is reached by no link. pricing@bold.page.json is pricing.page.json drawn again for the variant bold, shown in its place when the prototype is in that variant. A page is one tree for every width, mobile-first: a node's fields are the smallest screen's, and its at says what differs from a design system breakpoint up (at.md); a page's views draw it at other widths beside its frame. Images live in the designs directory's assets/, or a canvas's own assets/ to replace a shared file. Change pages through these tools (read_page, then apply_operations), not by editing the files: get_document_format has the whole format and get_component an instance to start from. Call focus before changing nodes, so the user sees where you work, and get_screenshot to look at the result.`;

const PageSummary = Schema.Struct({
  canvas: Schema.String,
  file: Schema.String,
  name: Schema.String,
  /** The URL the prototype serves it at; absent when it has none. */
  route: Schema.optional(Schema.String),
  /** The variant the page is drawn for; a route alone names the base page, its file this one. */
  variant: Schema.optional(Schema.String),
});

const CanvasSummary = Schema.Struct({
  /** The URL its prototype opens on; set it with set_home. */
  home: Schema.String,
  /** What `canvas` takes: the designs directory's own is `""`. */
  id: Schema.String,
  name: Schema.String,
  pages: Schema.Number,
  variants: Schema.Array(Schema.String),
});

export const GetContext = Tool.make("get_context", {
  description:
    "The project: repository root, designs directory, the package pages import from, its canvases and page count, and a guide to how designs are kept. Call it first unless told the pages.",
  failure: Failure,
  success: Schema.Struct({
    canvases: Schema.Array(CanvasSummary),
    designsDir: Schema.String,
    /** What the tools' descriptions leave to the briefing, for an agent that has none. */
    guide: Schema.String,
    pageCount: Schema.Number,
    resolveFrom: Schema.String,
    root: Schema.String,
  }),
}).annotate(Tool.Readonly, true);

export const ListPages = Tool.make("list_pages", {
  description:
    "Every page: its canvas, name, file, and the URL it serves in the prototype, if any. A variant's page (pricing@bold.page.json) serves its base page's URL: name it by its file.",
  failure: Failure,
  success: Schema.Struct({ pages: Schema.Array(PageSummary) }),
}).annotate(Tool.Readonly, true);

export const SetFrame = Tool.make("set_frame", {
  description:
    "Size a page's frame, the window it is drawn in on the canvas and in get_screenshot: a preset, or width and height in pixels. A long page needs a tall frame. views: widths drawn beside it.",
  failure: Failure,
  parameters: Schema.Struct({
    canvas: opt(Schema.String),
    height: opt(finite(100, 20_000)),
    preset: opt(Schema.Literals(["mobile", "tablet", "desktop"])),
    route: Schema.String.annotate({ description: PAGE_PARAMETER }),
    views: opt(Schema.Array(finite(200, 8000))),
    width: opt(finite(200, 8000)),
  }),
  success: Schema.Struct({
    file: Schema.String,
    height: Schema.Number,
    width: Schema.Number,
  }),
});

export const CreatePage = Tool.make("create_page", {
  description:
    "Add a page; its file is its name made safe (Billing settings: billing-settings.page.json). A screen of the application gets a URL, for the prototype and links; a sketch needs none. Then fill it with apply_operations.",
  failure: Failure,
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
});

export const RenamePage = Tool.make("rename_page", {
  description:
    "Rename a page: its file and its variants' files move; its URL and the links to it stay.",
  failure: Failure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    name: Schema.String,
    route: Schema.String.annotate({ description: PAGE_PARAMETER }),
  }),
  success: Schema.Struct({ file: Schema.String }),
});

export const SetPageUrl = Tool.make("set_page_url", {
  description:
    "Set the URL a page serves in its canvas's prototype, or null for none. Links to the old URL lead nowhere afterwards. A variant's page sets its base page's.",
  failure: Failure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    route: Schema.String.annotate({ description: PAGE_PARAMETER }),
    /** The new URL, `/settings/billing`; null for none. */
    url: Schema.NullOr(Schema.String),
  }),
  success: Schema.Struct({
    file: Schema.String,
    route: Schema.optional(Schema.String),
  }),
});

export const DeletePage = Tool.make("delete_page", {
  description:
    "Delete a page, with its variants' pages and its comments; one undo step brings them back. Links to its URL lead nowhere afterwards (list_links).",
  failure: Failure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    route: Schema.String.annotate({ description: PAGE_PARAMETER }),
  }),
  success: Schema.Struct({
    /** Every file deleted: the page's, then its variants'. */
    deleted: Schema.Array(Schema.String),
  }),
});

export const DuplicatePage = Tool.make("duplicate_page", {
  description:
    "Copy a page into a new file beside it (pricing-2.page.json), keeping its node ids. The copy serves no URL until set_page_url gives it one.",
  failure: Failure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    route: Schema.String.annotate({ description: PAGE_PARAMETER }),
  }),
  success: Schema.Struct({ file: Schema.String }),
});

export const ListTemplates = Tool.make("list_templates", {
  description: "The templates create_page can start from, by id and name.",
  failure: Failure,
  success: Schema.Struct({
    templates: Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String })
    ),
  }),
}).annotate(Tool.Readonly, true);

const PageTools = Toolkit.make(
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

export const pageToolHandlers = Effect.gen(function* () {
  const { canvasOf, documents, pageAt, pagesOf, pagesService, project } =
    yield* makeLookup;

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
      const gone = yield* pagesService((service) => service.delete(page.id));
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
      return {
        canvases: pages.canvases.map((canvas) => ({
          home: canvas.home,
          id: canvas.id,
          name: canvas.name,
          pages: pages.pages.filter((p) => p.canvas === canvas.id).length,
          variants: canvas.variants,
        })),
        designsDir: paths.settings.designsDir,
        guide: GUIDE,
        pageCount: pages.pages.length,
        resolveFrom: paths.settings.resolveFrom ?? paths.settings.designsDir,
        root: paths.root,
      };
    }),

    list_pages: Effect.fn("EditorTools.list_pages")(function* () {
      const pages = yield* reported(pagesOf);
      return {
        pages: pages.pages.map((page) => ({
          canvas: page.canvas,
          file: page.file,
          name: page.name,
          ...(page.route !== undefined && { route: page.route }),
          ...(page.variant !== undefined && { variant: page.variant }),
        })),
      };
    }),

    list_templates: () =>
      pagesService((pages) =>
        Effect.succeed({
          templates: pages.templates.map((t) => ({ id: t.id, name: t.name })),
        })
      ),

    rename_page: Effect.fn("EditorTools.rename_page")(function* ({
      route,
      canvas,
      name,
    }) {
      const page = yield* pageAt(route, canvas);
      const moved = yield* pagesService((pages) => pages.rename(page.id, name));
      return { file: moved.file };
    }),

    set_frame: Effect.fn("EditorTools.set_frame")(function* ({
      height,
      preset,
      route,
      canvas,
      views,
      width,
    }) {
      const page = yield* pageAt(route, canvas);
      // Sized from the layout as it is when the frame is written, and that frame alone
      // written: the others may have moved since the agent last looked.
      const frame = yield* pagesService((pages) =>
        pages.setFrame(page.canvas, page.path, { height, preset, views, width })
      );
      return { file: page.file, height: frame.height, width: frame.width };
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
});
