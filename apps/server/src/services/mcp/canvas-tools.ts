/**
 * The tools that work on canvases as a whole: making one, copying or moving pages into one, the
 * page its prototype opens on, and the links between its pages, with the ones that lead nowhere.
 */
import type { Page } from "@ultrapaint/contracts/pages";
import { canvasDocOf, walk } from "@ultrapaint/design-document/tree";
import {
  pageOfLink,
  linkTargetOf as parseLink,
} from "@ultrapaint/shared/link";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import type { CopyTarget } from "../pages.ts";
import { TOOLS } from "../threads/agent-ways.ts";
import { makeLookup } from "./lookup.ts";
import { doing, missing, opt, reported, ToolFailure } from "./tool-helpers.ts";

const CopyPages = Tool.make("copy_pages", {
  description:
    "Copy or move pages with variants into a canvas (to) or a new one (newCanvas), keeping files, URLs and frames; a move takes comments too.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** The canvas the pages are in; needed only when the project has several. */
    canvas: opt(Schema.String),
    /** Move them instead of copying: they leave the canvas they are in. */
    move: opt(Schema.Boolean),
    /** Name of a new canvas to put them in; give this or `to`. */
    newCanvas: opt(Schema.String),
    /** The pages, each by its URL or its file, all from one canvas. */
    pages: Schema.Array(Schema.String),
    /** Id of the canvas to put them in; give this or `newCanvas`. */
    to: opt(Schema.String),
  }),
  success: Schema.Struct({
    /** Id of the canvas they are in now. */
    canvas: Schema.String,
    pages: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        route: Schema.optional(Schema.String),
      })
    ),
  }),
}).annotateMerge(doing("destructive"));

const CreateCanvas = Tool.make("create_canvas", {
  description: "Make an empty canvas, its id its name made safe.",
  failure: ToolFailure,
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.Struct({ id: Schema.String, name: Schema.String }),
}).annotateMerge(doing("edit"));

const SetHome = Tool.make("set_home", {
  description:
    "Choose the page, one with a URL, the canvas's prototype opens on.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    route: Schema.String,
  }),
  success: Schema.Struct({ canvas: Schema.String, home: Schema.String }),
}).annotateMerge(doing("edit", { idempotent: true }));

const LinkSummary = Schema.Struct({
  /** Why the link leads nowhere; absent when it leads somewhere. */
  broken: Schema.optional(Schema.String),
  /** What it is: a URL of the canvas, a page file, "back", or an address outside. */
  kind: Schema.Literals(["url", "page", "back", "external", "unknown"]),
  link: Schema.String,
  node: Schema.String,
  /** The page the node is in, or null for a node placed on the canvas beside the pages. */
  page: Schema.NullOr(Schema.String),
  /** The file of the page it leads to, when it leads to one. */
  target: Schema.optional(Schema.String),
});

const ListLinks = Tool.make("list_links", {
  description:
    "Every linking node of a canvas, its page and target, broken ones marked: run it after changing URLs or deleting or moving pages.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** Only the links that lead nowhere. */
    brokenOnly: opt(Schema.Boolean),
    /** Needed only when the project has several canvases. */
    canvas: opt(Schema.String),
  }),
  success: Schema.Struct({
    /** How many of all of them lead nowhere. */
    broken: Schema.Number,
    links: Schema.Array(LinkSummary),
  }),
}).annotateMerge(doing("read"));

/**
 * Where a link leads in a canvas whose pages are these, read as the editor reads it
 * (`@ultrapaint/shared/link`): a URL one of them serves, one of their files, back to where the
 * prototype was, or an address outside, which is not followed here. Anything else, and a URL or
 * a file no page answers to, leads nowhere, and says why.
 */
export const linkTargetOf = (
  link: string,
  pages: readonly Page[]
): {
  readonly broken?: string;
  readonly kind: "url" | "page" | "back" | "external" | "unknown";
  readonly target?: string;
} => {
  const target = parseLink(link);
  if (target === null) {
    return {
      broken: `${link.trim()} is neither a URL starting with /, a page file, "back" nor an outside address`,
      kind: "unknown",
    };
  }
  if (target.kind === "back" || target.kind === "external") {
    return { kind: target.kind };
  }
  const page = pageOfLink(pages, link);
  if (page) {
    return { kind: target.kind, target: page.file };
  }
  return {
    broken:
      target.kind === "url"
        ? `no page of the canvas serves ${target.route}`
        : `no page file ${target.path} in the canvas`,
    kind: target.kind,
  };
};

export const CanvasTools = Toolkit.make(
  CopyPages,
  CreateCanvas,
  SetHome,
  ListLinks
);

export const CanvasToolsLive = CanvasTools.toLayer(
  Effect.gen(function* () {
    const { canvasOf, documents, pageAt, pagesOf, pagesService } =
      yield* makeLookup;

    return CanvasTools.of({
      copy_pages: Effect.fn("EditorTools.copy_pages")(function* ({
        canvas,
        move,
        newCanvas,
        pages: given,
        to,
      }) {
        if ((to === undefined) === (newCanvas === undefined)) {
          return yield* missing(
            "say where the pages go: `to` with the id of a canvas there is, or `newCanvas` with the name of one to make"
          );
        }
        if (given.length === 0) {
          return yield* missing("name the pages to copy in `pages`");
        }
        const chosen = yield* Effect.forEach(given, (p) => pageAt(p, canvas));
        const target: CopyTarget =
          newCanvas === undefined
            ? { canvas: yield* canvasOf(to) }
            : { name: newCanvas };
        const copied = yield* pagesService((pages) =>
          pages.copyTo(
            chosen.map((p) => p.id),
            target,
            move ?? false
          )
        );
        return {
          canvas: copied[0]?.canvas ?? "",
          pages: copied.map((page) => ({
            file: page.file,
            ...(page.route !== undefined && { route: page.route }),
          })),
        };
      }),

      create_canvas: Effect.fn("EditorTools.create_canvas")(function* ({
        name,
      }) {
        const made = yield* pagesService((pages) => pages.createCanvas(name));
        return { id: made.id, name: made.name };
      }),

      list_links: Effect.fn("EditorTools.list_links")(function* ({
        brokenOnly,
        canvas,
      }) {
        const id = yield* canvasOf(canvas);
        const inCanvas = (yield* reported(pagesOf)).pages.filter(
          (p) => p.canvas === id
        );
        const states = yield* documents((d) => d.list(id));
        const links = states.flatMap((state) => {
          if (!state.root) {
            return [];
          }
          // The canvas's own document holds the nodes placed beside the pages.
          const page =
            state.doc === canvasDocOf(id)
              ? null
              : (inCanvas.find((p) => p.id === state.doc)?.file ?? state.doc);
          return [...walk(state.root)].flatMap((node) =>
            node.link === undefined || node.link.trim() === ""
              ? []
              : [
                  {
                    link: node.link,
                    node: node.id,
                    page,
                    ...linkTargetOf(node.link, inCanvas),
                  },
                ]
          );
        });
        const broken = links.filter((l) => l.broken !== undefined);
        return {
          broken: broken.length,
          links: brokenOnly ? broken : links,
        };
      }),

      set_home: Effect.fn("EditorTools.set_home")(function* ({
        route,
        canvas,
      }) {
        const page = yield* pageAt(route, canvas);
        if (page.route === undefined) {
          return yield* missing(
            `${page.file} serves no URL, and a prototype opens on one; give it one with ${TOOLS.set_page_url} first`
          );
        }
        const home = page.route;
        const changed = yield* pagesService((pages) =>
          pages.setHome(page.canvas, home)
        );
        return { canvas: changed.id, home: changed.home };
      }),
    });
  })
);
