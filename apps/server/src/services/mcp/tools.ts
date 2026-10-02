/**
 * The editor's own tools, offered to agents over MCP.
 *
 * What an agent otherwise has to piece together by reading the repository — where the designs
 * are, what pages exist, which components it may use and what props they take — the server
 * already knows. These answer it in one call. Pages are design documents the editor owns, so
 * changing one goes through the same operations the editor uses (`apply_operations`), which
 * validate every change and make it one undo step; the design system is written the same way.
 */
import { Json, type JsonValue } from "@ultrapaint/contracts/base";
import { DocOp } from "@ultrapaint/contracts/document";
import {
  type FrameLayout,
  type Page,
  presetSize,
} from "@ultrapaint/contracts/pages";
import { newInstance } from "@ultrapaint/design-document/factories";
import { fillIds, makeIdGenerator } from "@ultrapaint/design-document/ids";
import { touchedBy } from "@ultrapaint/design-document/ops";
import { fillWarnings } from "@ultrapaint/design-document/sizing";
import { canvasDocOf, findNode, walk } from "@ultrapaint/design-document/tree";
import {
  pageOfLink,
  linkTargetOf as parseLink,
} from "@ultrapaint/shared/link";
import { parseNodeRef } from "@ultrapaint/shared/node-ref";
import { basePathOf, normaliseRoute } from "@ultrapaint/shared/route";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { EventBus } from "../../events.ts";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { CommentsService } from "../comments.ts";
import { DesignSystemService } from "../design-system.ts";
import { DocumentService } from "../documents.ts";
import { type CopyTarget, PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";
import {
  designSystemSchema,
  IMPLEMENTATION_RULES,
  pageSchema,
} from "../threads/commands.ts";
import { CallingThread } from "./access.ts";

/**
 * What a tool says when it cannot answer: the reason, in words the agent can act on. An error
 * class, not a plain struct: the MCP server passes a failure's message to the agent only when it
 * is an `Error`, and says "internal server error" for anything else.
 */
export class ToolFailure extends Schema.TaggedError<ToolFailure>()(
  "ToolFailure",
  {
    message: Schema.String,
  }
) {}
const Failure = ToolFailure;

const decodeOps = Schema.decodeUnknownEffect(Schema.Array(DocOp));

/**
 * What a thread's briefing explains and the tools' descriptions therefore leave out, for an agent
 * outside the editor, which has no briefing. `get_context` answers with it, once, rather than
 * every tool carrying a share of it on every turn.
 */
const GUIDE = `Designs are kept in canvases. Each has its own pages, the URLs they serve in its prototype, and loose nodes placed beside the pages; when there are several, tools take canvas (an id from canvases; the designs directory's own is ""). A page is a <name>.page.json design document, not code: a tree of nodes (page, row, column, group, text, image, and instance of one of the repository's components), each with an id. Its URL is optional, and a page without one is reached by no link. pricing@bold.page.json is pricing.page.json drawn again for the variant bold, shown in its place when the prototype is in that variant. Images live in the designs directory's assets/, or a canvas's own assets/ to replace a shared file. Change pages through these tools (read_page, then apply_operations), not by editing the files: get_document_format has the whole format and get_component an instance to start from. Call focus before changing nodes, so the user sees where you work, and get_screenshot to look at the result.`;

/** Past this many, `apply_operations` says how many more warnings there are. */
const MAX_WARNINGS = 12;

const PageSummary = Schema.Struct({
  canvas: Schema.String,
  file: Schema.String,
  name: Schema.String,
  /** The URL the prototype serves it at; absent when it has none. */
  route: Schema.optional(Schema.String),
  /** The variant the page is drawn for; a route alone names the base page, its file this one. */
  variant: Schema.optional(Schema.String),
});

/**
 * How a tool takes a page: its URL, or its file when it has none. Every tool repeats it, and an
 * agent reads every tool's schema, so it is kept short; the briefing says the rest.
 */
export const PAGE_PARAMETER =
  "URL (/settings/billing) or file (drafts/billing.page.json) of the page";

/**
 * A parameter an agent may leave out. `optionalKey`, not `optional`: the latter also takes
 * `undefined`, which JSON Schema can only say as `null`, and every optional field of every
 * tool would carry an `anyOf` the agent pays for and never needs.
 */
export const opt = Schema.optionalKey;

/** A number an agent passes. Plain `Number` also admits "NaN" and "Infinity" as strings. */
export const finite = (minimum: number, maximum: number) =>
  Schema.Finite.check(Schema.isBetween({ maximum, minimum }));

/**
 * JSON an agent passes, which the handler validates itself and says what is wrong. `Json`
 * would describe itself to the agent as a recursive schema of every JSON value.
 */
export const AnyJson = Schema.Unknown;

const CanvasSummary = Schema.Struct({
  /** The URL its prototype opens on; set it with set_home. */
  home: Schema.String,
  /** What `canvas` takes: the designs directory's own is `""`. */
  id: Schema.String,
  name: Schema.String,
  pages: Schema.Number,
  variants: Schema.Array(Schema.String),
});

const ComponentSummary = Schema.Struct({
  importFrom: Schema.String,
  name: Schema.String,
  props: Schema.Array(Schema.String),
  variants: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});

const GetContext = Tool.make("get_context", {
  description:
    "The project: repository root, designs directory, the package pages import from, its canvases and how many pages there are, and a short guide to how designs are kept. Call it first, unless you were already told the pages.",
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

const ListPages = Tool.make("list_pages", {
  description:
    "Every page: its canvas, name, file, and the URL it serves in the prototype (none when it has none). A variant's page (pricing@bold.page.json) serves its base page's URL, so name it by its file.",
  failure: Failure,
  success: Schema.Struct({ pages: Schema.Array(PageSummary) }),
}).annotate(Tool.Readonly, true);

const ReadPage = Tool.make("read_page", {
  description:
    "A page's design document: its tree of nodes with their ids, or with node only that node's subtree, and a hash to pass to apply_operations as expectedHash. A node reference the user copied (/orders#c_8x2k1q) names the page too.",
  failure: Failure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    /** Only this node and what is inside it: a big page costs less to read in parts. */
    node: opt(Schema.String),
    route: Schema.String.annotate({ description: PAGE_PARAMETER }),
  }),
  success: Schema.Struct({
    document: Json,
    file: Schema.String,
    hash: Schema.String,
  }),
}).annotate(Tool.Readonly, true);

const ReadCanvas = Tool.make("read_canvas", {
  description:
    "The loose nodes placed on a canvas beside its pages, with their x and y. Change them with apply_operations and loose: true.",
  failure: Failure,
  parameters: Schema.Struct({ canvas: opt(Schema.String) }),
  success: Schema.Struct({ hash: Schema.String, nodes: Json }),
}).annotate(Tool.Readonly, true);

const GetDocumentFormat = Tool.make("get_document_format", {
  description:
    'The JSON Schema of a page document, or with kind "design-system" of design-system.json, and how the format maps to code. Read it before writing either by hand.',
  failure: Failure,
  parameters: Schema.Struct({
    kind: opt(Schema.Literals(["page", "design-system"])),
  }),
  success: Schema.Struct({ rules: Schema.String, schema: Json }),
}).annotate(Tool.Readonly, true);

const ApplyOperations = Tool.make("apply_operations", {
  description: `Change a page, or with loose: true the nodes beside the pages: validated, shown at once, one undo step. ops, in order (an id may be a node reference, /orders#c_8x2k1q):
- {op:"insert", parent, index?, node}: parent a node id, or null for the top level; node may leave out ids
- {op:"remove", id}
- {op:"move", id, parent, index?}: index among the siblings without the moved node
- {op:"update", id, set:{field: value}}: null removes a field; a group, row or column may change "type"
- {op:"setProps", id, props:{name: value}}: null removes a prop
- {op:"wrap", ids:[...], type:"row"|"column"|"group"}, {op:"unwrap", id}, {op:"duplicate", id}
Inserting into an instance that shows "text" makes that text its first child.
Values: numbers are pixels, "$name" a design token, anything else CSS. Size an instance with width, height and padding, never a className prop. expectedHash (from read_page) refuses the call if the page changed since. "warnings" names fills that have no room to take.`,
  failure: Failure,
  parameters: Schema.Struct({
    /** Needed only when the project has several canvases. */
    canvas: opt(Schema.String),
    /** The hash read_page answered with; the call is refused if the page changed since. */
    expectedHash: opt(Schema.String),
    /** What the undo menu calls it. */
    label: opt(Schema.String),
    /** Work on the loose nodes placed on the canvas beside the pages, instead of a page. */
    loose: opt(Schema.Boolean),
    /** Checked once the ids a new node leaves out are filled in. */
    ops: Schema.Array(AnyJson),
    /** URL or file of the page; leave out with `loose: true`. */
    route: opt(Schema.String.annotate({ description: PAGE_PARAMETER })),
  }),
  success: Schema.Struct({
    created: Schema.Array(Schema.String),
    hash: Schema.String,
    /** Nodes of the document whose fill has no room to take, and why. */
    warnings: Schema.optional(Schema.Array(Schema.String)),
  }),
});

const ScanDesignSystem = Tool.make("scan_design_system", {
  description:
    "A first design-system.json, read by fixed rules from the Tailwind v4 @theme blocks of the stylesheets the preview imports, with the files read and notes on what could not be interpreted. The start of /init.",
  failure: Failure,
  success: Schema.Struct({
    designSystem: Json,
    files: Schema.Array(Schema.String),
    notes: Schema.Array(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

const ReadDesignSystem = Tool.make("read_design_system", {
  description:
    "The design system as recorded: design-system.json (tokens, text styles, component notes) and DESIGN.md (conventions); null when never imported.",
  failure: Failure,
  success: Schema.Struct({
    designSystem: Json,
    notes: Schema.NullOr(Schema.String),
    problem: Schema.optional(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

const WriteDesignSystem = Tool.make("write_design_system", {
  description:
    'Save design-system.json, and DESIGN.md when notes is given; refused with the reason when it does not match its schema (get_document_format, kind "design-system"). A token is named after its Tailwind v4 variable without the dashes ("color-primary"); a text style refers to it as "$color-primary".',
  failure: Failure,
  parameters: Schema.Struct({
    designSystem: AnyJson,
    /** The whole of DESIGN.md. */
    notes: opt(Schema.String),
  }),
  success: Schema.Struct({ saved: Schema.Boolean }),
});

const ListComponents = Tool.make("list_components", {
  description:
    "The repository's components, with their import and variants; match narrows the list. Prefer them to plain HTML.",
  failure: Failure,
  parameters: Schema.Struct({
    /** Narrows the list; leave empty for all of them. */
    match: opt(Schema.String),
  }),
  success: Schema.Struct({ components: Schema.Array(ComponentSummary) }),
}).annotate(Tool.Readonly, true);

const GetComponent = Tool.make("get_component", {
  description:
    "One component in full: its import, every prop with its type, its variants, and an instance node to start from.",
  failure: Failure,
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.Struct({
    /** An instance node that uses it, ready for apply_operations. */
    example: Json,
    file: Schema.String,
    importFrom: Schema.String,
    name: Schema.String,
    props: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        required: Schema.Boolean,
        type: Schema.String,
      })
    ),
    variants: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  }),
}).annotate(Tool.Readonly, true);

const CommentSummary = Schema.Struct({
  element: Schema.NullOr(Schema.String),
  id: Schema.String,
  page: Schema.String,
  replies: Schema.Number,
  resolved: Schema.Boolean,
  text: Schema.String,
});

const ListComments = Tool.make("list_comments", {
  description:
    "The comments on the designs, where the user asks for things; open ones only, unless includeResolved.",
  failure: Failure,
  parameters: Schema.Struct({
    canvas: opt(Schema.String),
    /** Include the ones already dealt with. */
    includeResolved: opt(Schema.Boolean),
  }),
  success: Schema.Struct({ comments: Schema.Array(CommentSummary) }),
}).annotate(Tool.Readonly, true);

const SetFrame = Tool.make("set_frame", {
  description:
    "Size a page's frame, the window it is drawn in on the canvas and in get_screenshot: a preset or a width and height in pixels. A long page needs a tall frame to be seen whole.",
  failure: Failure,
  parameters: Schema.Struct({
    canvas: opt(Schema.String),
    height: opt(finite(100, 20_000)),
    preset: opt(Schema.Literals(["mobile", "tablet", "desktop"])),
    route: Schema.String.annotate({ description: PAGE_PARAMETER }),
    width: opt(finite(200, 8000)),
  }),
  success: Schema.Struct({
    file: Schema.String,
    height: Schema.Number,
    width: Schema.Number,
  }),
});

const CreatePage = Tool.make("create_page", {
  description:
    "Add a page; its file is its name made safe (Billing settings: billing-settings.page.json). Give it a URL when the prototype or a link should reach it: a screen of the application has one, a sketch needs none. Then fill it with apply_operations.",
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

const RenamePage = Tool.make("rename_page", {
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

const SetPageUrl = Tool.make("set_page_url", {
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

const DeletePage = Tool.make("delete_page", {
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

const DuplicatePage = Tool.make("duplicate_page", {
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

const CopyPages = Tool.make("copy_pages", {
  description:
    "Copy or move pages, with their variants, into another canvas (to) or a new one (newCanvas), keeping files, URLs and frames; a move takes their comments along. Refused when the target already has one of the files or URLs.",
  failure: Failure,
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
});

const CreateCanvas = Tool.make("create_canvas", {
  description:
    "Make an empty canvas, with its own pages, URLs and prototype. Its id, which canvas takes, is its name made safe.",
  failure: Failure,
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.Struct({ id: Schema.String, name: Schema.String }),
});

const SetHome = Tool.make("set_home", {
  description:
    "Choose the page the canvas's prototype opens on; it must serve a URL.",
  failure: Failure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    route: Schema.String.annotate({ description: PAGE_PARAMETER }),
  }),
  success: Schema.Struct({ canvas: Schema.String, home: Schema.String }),
});

const ListTemplates = Tool.make("list_templates", {
  description: "The templates create_page can start from, by id and name.",
  failure: Failure,
  success: Schema.Struct({
    templates: Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String })
    ),
  }),
}).annotate(Tool.Readonly, true);

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
    'Every node of a canvas that links somewhere, with its page and where it leads, broken ones said so. Run it after changing URLs or deleting or moving pages; fix a link by updating the node\'s "link".',
  failure: Failure,
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
}).annotate(Tool.Readonly, true);

const ReplyToComment = Tool.make("reply_to_comment", {
  description: "Answer a comment in the thread under it, where the user asked.",
  failure: Failure,
  parameters: Schema.Struct({
    canvas: opt(Schema.String),
    id: Schema.String,
    text: Schema.String,
  }),
  success: Schema.Struct({ replies: Schema.Number }),
});

const ResolveComment = Tool.make("resolve_comment", {
  description: "Mark a comment done, once its work is.",
  failure: Failure,
  parameters: Schema.Struct({
    canvas: opt(Schema.String),
    id: Schema.String,
  }),
  success: Schema.Struct({ resolved: Schema.Boolean }),
});

const Focus = Tool.make("focus", {
  description:
    'Show the user which page you are on, and before changing nodes, which ones and how: their ids as nodes and a few words as action ("formatting the dates"). Call it when you move to another page.',
  failure: Failure,
  parameters: Schema.Struct({
    /** A few words on what you are doing to the nodes. */
    action: opt(Schema.String),
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    /** Ids of the nodes of the page you are about to change. */
    nodes: opt(Schema.Array(Schema.String)),
    route: Schema.String.annotate({ description: PAGE_PARAMETER }),
  }),
  success: Schema.Struct({ file: Schema.String }),
}).annotate(Tool.Readonly, true);

export const EditorTools = Toolkit.make(
  GetContext,
  ListPages,
  ReadPage,
  ReadCanvas,
  GetDocumentFormat,
  ApplyOperations,
  ScanDesignSystem,
  ReadDesignSystem,
  WriteDesignSystem,
  ListComponents,
  GetComponent,
  ListComments,
  ListTemplates,
  CreatePage,
  SetFrame,
  RenamePage,
  SetPageUrl,
  DeletePage,
  DuplicatePage,
  CopyPages,
  CreateCanvas,
  SetHome,
  ListLinks,
  ReplyToComment,
  ResolveComment,
  Focus
);

/**
 * Every failure reaches the agent as a sentence it can do something about: no project open, a
 * route that does not exist, a component that is not in the palette.
 */
export const reported = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>
) =>
  Effect.mapError(
    effect,
    (error) => new ToolFailure({ message: error.message })
  );

export const missing = (message: string) =>
  Effect.fail(new ToolFailure({ message }));

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

/** Documents and the design system are JSON through and through; their types only say more. */
const asJson = (value: unknown) => value as JsonValue;

/**
 * How a tool finds what an agent names: a canvas, a page by route or file, a document. Every
 * miss is a sentence that says what there is instead.
 */
export const makeLookup = Effect.gen(function* () {
  const project = yield* ProjectManager;

  const pagesOf = project.use(Effect.flatMap(PagesService, (p) => p.list));

  /** A canvas's id as an agent would pass it back: the designs directory's own is `""`. */
  const named = (id: string) => JSON.stringify(id);

  /**
   * The canvas a tool was told to work in, or the only one there is. With several and none
   * named, the tool says so rather than pick one: the first is not what the agent meant.
   */
  const canvasOf = Effect.fnUntraced(function* (canvas: string | undefined) {
    const { canvases } = yield* reported(pagesOf);
    const ids = canvases.map((s) => named(s.id)).join(", ");
    if (canvas !== undefined) {
      return canvases.some((s) => s.id === canvas)
        ? canvas
        : yield* missing(`no canvas ${named(canvas)}; the canvases are ${ids}`);
    }
    if (canvases.length <= 1) {
      return canvases[0]?.id ?? "";
    }
    return yield* missing(
      `this project has several canvases (${ids}); say which with \`canvas\``
    );
  });

  /**
   * A page by URL or by file (repository-relative, designs-relative or inside its canvas), in the
   * canvas named, or in the only canvas that has it. A node reference (`/orders#c_1`,
   * `marketing:/pricing#c_1`, `drafts.page.json#c_1`) names its page as well.
   */
  const pageAt = Effect.fnUntraced(function* (
    given: string,
    givenCanvas: string | undefined
  ) {
    const ref = parseNodeRef(given);
    if (ref && ref.page === null) {
      return yield* missing(
        `${given} is a node on the canvas beside the pages; pass \`loose: true\` instead of a page`
      );
    }
    const where = (ref?.page ?? given).trim();
    const route = where.startsWith("/") ? normaliseRoute(where) : null;
    const canvas = givenCanvas ?? ref?.canvas;
    const { pages } = yield* reported(pagesOf);
    // A URL names the base page; a variant's page is named by its file.
    const found = pages.filter(
      (p) =>
        (route === null
          ? p.file === where || p.id === where || p.path === where
          : p.route === route && p.variant === undefined) &&
        (canvas === undefined || p.canvas === canvas)
    );
    const [only] = found;
    if (only && found.length === 1) {
      return only;
    }
    if (found.length === 0) {
      const inCanvas =
        canvas === undefined ? "" : ` in canvas ${named(canvas)}`;
      return yield* missing(
        route === null
          ? `no page file ${where}${inCanvas}; call list_pages to see the pages`
          : `no page serves ${route}${inCanvas}; call list_pages to see the pages and their URLs (a page without a URL is named by its file)`
      );
    }
    return yield* missing(
      `${where} is a page in several canvases (${found.map((p) => named(p.canvas)).join(", ")}); say which with \`canvas\``
    );
  });

  const documents = <A, E extends { readonly message: string }>(
    f: (service: DocumentService["Service"]) => Effect.Effect<A, E>
  ) => reported(project.use(Effect.flatMap(DocumentService, f)));

  return { canvasOf, documents, pageAt, pagesOf, project };
});

export const EditorToolsLive = EditorTools.toLayer(
  Effect.gen(function* () {
    const events = yield* EventBus;
    const { documents, pageAt, pagesOf, project, canvasOf } = yield* makeLookup;
    const catalogueOf = project.use(
      Effect.flatMap(CatalogueService, (c) => c.get(false))
    );

    const designSystem = <A, E extends { readonly message: string }>(
      f: (service: DesignSystemService["Service"]) => Effect.Effect<A, E>
    ) => reported(project.use(Effect.flatMap(DesignSystemService, f)));

    const pagesService = <A, E extends { readonly message: string }>(
      f: (service: PagesService["Service"]) => Effect.Effect<A, E>
    ) => reported(project.use(Effect.flatMap(PagesService, f)));

    return {
      apply_operations: Effect.fnUntraced(function* ({
        canvas,
        expectedHash,
        label,
        loose,
        ops,
        route,
      }) {
        let doc: string;
        if (loose) {
          doc = canvasDocOf(yield* canvasOf(canvas));
        } else if (route === undefined) {
          return yield* missing(
            "say which page with `route`, or pass `loose: true` for the nodes beside the pages"
          );
        } else {
          doc = (yield* pageAt(route, canvas)).id;
        }
        // A node an agent writes may leave its ids out; they are made before the ops are read.
        // Node references the user pasted stand for their node ids.
        const raw = JSON.parse(JSON.stringify(ops), (_key, value: unknown) =>
          typeof value === "string"
            ? (parseNodeRef(value)?.nodeId ?? value)
            : value
        ) as unknown[];
        for (const op of raw) {
          if (op && typeof op === "object" && "node" in op) {
            fillIds({ nodes: [(op as { node: unknown }).node] });
          }
        }
        const decoded = yield* decodeOps(raw).pipe(
          Effect.mapError(
            (error) =>
              new ToolFailure({
                message: `the operations are not valid: ${error.message}`,
              })
          )
        );
        const result = yield* documents((d) =>
          d.apply({
            edits: [
              {
                doc,
                ops: decoded,
                ...(expectedHash !== undefined && { expectedHash }),
              },
            ],
            ...(label !== undefined && { label }),
          })
        );
        const after = yield* documents((d) => d.get(doc));
        // The work is the calling thread's: the canvas shows it on the nodes it changed.
        const threadId = yield* Effect.service(CallingThread);
        if (threadId && after.root) {
          yield* events.publish("agent.edited", {
            doc,
            nodeIds: touchedBy(decoded, result.created, after.root),
            threadId,
            ...(label !== undefined && { label }),
          });
        }
        const warnings = after.root
          ? fillWarnings(after.root).map((w) => `${w.nodeId}: ${w.message}`)
          : [];
        return {
          created: result.created,
          hash: result.documents[0]?.hash ?? "",
          ...(warnings.length > 0 && {
            warnings:
              warnings.length > MAX_WARNINGS
                ? [
                    ...warnings.slice(0, MAX_WARNINGS),
                    `and ${warnings.length - MAX_WARNINGS} more`,
                  ]
                : warnings,
          }),
        };
      }),

      copy_pages: Effect.fnUntraced(function* ({
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

      create_canvas: Effect.fnUntraced(function* ({ name }) {
        const made = yield* pagesService((pages) => pages.createCanvas(name));
        return { id: made.id, name: made.name };
      }),

      create_page: Effect.fnUntraced(function* ({
        canvas,
        name,
        route,
        template,
      }) {
        const page = yield* reported(
          project.use(
            Effect.flatMap(PagesService, (pages) =>
              Effect.flatMap(canvasOf(canvas), (id) =>
                pages.create(id, { name, route }, template)
              )
            )
          )
        );
        const state = yield* documents((d) => d.get(page.id));
        return {
          document: asJson(state.root),
          file: page.file,
          ...(page.route !== undefined && { route: page.route }),
        };
      }),

      delete_page: Effect.fnUntraced(function* ({ route, canvas }) {
        const page = yield* pageAt(route, canvas);
        const { pages } = yield* reported(pagesOf);
        // What goes with it, as the editor deletes it: a base page's variants.
        const variants =
          page.variant === undefined
            ? pages.filter(
                (p) =>
                  p.canvas === page.canvas &&
                  p.id !== page.id &&
                  basePathOf(p.path) === page.path
              )
            : [];
        yield* pagesService((service) => service.delete(page.id));
        return { deleted: [page.file, ...variants.map((p) => p.file)] };
      }),

      duplicate_page: Effect.fnUntraced(function* ({ route, canvas }) {
        const page = yield* pageAt(route, canvas);
        const copy = yield* pagesService((pages) => pages.duplicate(page.id));
        return { file: copy.file };
      }),

      focus: Effect.fnUntraced(function* ({ action, nodes, route, canvas }) {
        const page = yield* pageAt(route, canvas);
        const threadId = yield* Effect.service(CallingThread);
        if (threadId) {
          // The page, not the route: the same route can be a page in two canvases.
          yield* events.publish("agent.focus", {
            pageId: page.id,
            threadId,
            ...(page.route !== undefined && { route: page.route }),
            ...(nodes !== undefined && { nodeIds: nodes }),
            ...(action !== undefined && { action }),
          });
        }
        return { file: page.file };
      }),
      get_component: Effect.fnUntraced(function* ({ name }) {
        const catalogue = yield* reported(catalogueOf);
        const component = catalogue.components.find((c) => c.name === name);
        if (!component) {
          return yield* missing(
            `no component named ${name}; call list_components to see what there is`
          );
        }
        const { designSystem: ds } = yield* designSystem((d) => d.get);
        const example = newInstance(
          component,
          ds?.components?.[component.name],
          makeIdGenerator()
        );
        return {
          example: asJson(example),
          file: component.file,
          importFrom: component.importFrom,
          name: component.name,
          props: component.props.map((prop) => ({
            name: prop.name,
            required: prop.required,
            type: prop.type.raw,
          })),
          variants: component.variants,
        };
      }),

      get_context: Effect.fnUntraced(function* () {
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

      get_document_format: ({ kind }) =>
        Effect.succeed({
          rules: IMPLEMENTATION_RULES,
          schema: asJson(
            JSON.parse(
              kind === "design-system" ? designSystemSchema() : pageSchema()
            )
          ),
        }),

      list_comments: Effect.fnUntraced(function* ({ includeResolved, canvas }) {
        const id = yield* canvasOf(canvas);
        const list = yield* reported(
          project.use(
            Effect.flatMap(CommentsService, (comments) => comments.list(id))
          )
        );
        return {
          comments: list.comments
            .filter((comment) => includeResolved || !comment.resolved)
            .map((comment) => ({
              element: comment.element,
              id: comment.id,
              page: comment.page,
              replies: comment.replies.length,
              resolved: comment.resolved,
              text: comment.text,
            })),
        };
      }),

      list_components: Effect.fnUntraced(function* ({ match }) {
        const catalogue = yield* reported(catalogueOf);
        const needle = match?.toLowerCase();
        return {
          components: catalogue.components
            .filter(
              (component) =>
                !needle || component.name.toLowerCase().includes(needle)
            )
            .map((component) => ({
              importFrom: component.importFrom,
              name: component.name,
              props: component.props.map((prop) => prop.name),
              variants: component.variants,
            })),
        };
      }),

      list_links: Effect.fnUntraced(function* ({ brokenOnly, canvas }) {
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

      list_pages: Effect.fnUntraced(function* () {
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

      read_canvas: Effect.fnUntraced(function* ({ canvas }) {
        const id = yield* canvasOf(canvas);
        const state = yield* documents((d) => d.get(canvasDocOf(id)));
        if (state.problem !== undefined) {
          return yield* missing(state.problem);
        }
        return {
          hash: state.hash,
          nodes: asJson(
            state.root && "children" in state.root
              ? (state.root.children ?? [])
              : []
          ),
        };
      }),

      read_design_system: Effect.fnUntraced(function* () {
        const state = yield* designSystem((d) => d.get);
        return {
          designSystem: asJson(state.designSystem),
          notes: state.notes,
          ...(state.problem !== undefined && { problem: state.problem }),
        };
      }),

      read_page: Effect.fnUntraced(function* ({ route, canvas, node }) {
        const page = yield* pageAt(route, canvas);
        const state = yield* documents((d) => d.get(page.id));
        if (state.problem !== undefined) {
          return yield* missing(
            `${page.file} is not a valid page: ${state.problem}`
          );
        }
        if (node !== undefined) {
          const id = parseNodeRef(node)?.nodeId ?? node;
          const found = findNode(state.root, id);
          if (found === null) {
            return yield* missing(
              `no node ${id} in ${page.file}; read the page without node to see its ids`
            );
          }
          return { document: asJson(found), file: page.file, hash: state.hash };
        }
        return {
          document: asJson({ root: state.root, version: 1 }),
          file: page.file,
          hash: state.hash,
        };
      }),

      rename_page: Effect.fnUntraced(function* ({ route, canvas, name }) {
        const page = yield* pageAt(route, canvas);
        const moved = yield* reported(
          project.use(
            Effect.flatMap(PagesService, (pages) => pages.rename(page.id, name))
          )
        );
        return { file: moved.file };
      }),

      reply_to_comment: Effect.fnUntraced(function* ({ id, canvas, text }) {
        const inCanvas = yield* canvasOf(canvas);
        const comment = yield* reported(
          project.use(
            Effect.flatMap(CommentsService, (comments) =>
              comments.reply({ canvas: inCanvas, id, text })
            )
          )
        );
        return { replies: comment.replies.length };
      }),

      resolve_comment: Effect.fnUntraced(function* ({ id, canvas }) {
        const inCanvas = yield* canvasOf(canvas);
        const comment = yield* reported(
          project.use(
            Effect.flatMap(CommentsService, (comments) =>
              comments.update({ canvas: inCanvas, id, resolved: true })
            )
          )
        );
        return { resolved: comment.resolved };
      }),

      scan_design_system: Effect.fnUntraced(function* () {
        const found = yield* designSystem((d) => d.scan);
        return {
          designSystem: asJson(found.designSystem),
          files: found.files,
          notes: found.notes,
        };
      }),

      set_frame: Effect.fnUntraced(function* ({
        height,
        preset,
        route,
        canvas,
        width,
      }) {
        const page = yield* pageAt(route, canvas);
        // Worked out from the layout as it is when the frame is written, and that frame alone
        // written: the others may have moved since the agent last looked.
        const sized = (
          before: FrameLayout | undefined,
          frames: Readonly<Record<string, FrameLayout>>
        ): FrameLayout => {
          const size = preset
            ? presetSize[preset]
            : (before ?? presetSize.desktop);
          // A page with no frame saved yet goes to the right of the others.
          const right = Math.max(
            0,
            ...Object.values(frames).map((f) => f.x + f.width + 120)
          );
          return {
            height: height ?? size.height,
            preset:
              width === undefined && height === undefined && preset
                ? preset
                : "custom",
            width: width ?? size.width,
            x: before?.x ?? right,
            y: before?.y ?? 0,
          };
        };
        const frame = yield* reported(
          project.use(
            Effect.flatMap(PagesService, (pages) =>
              pages.setFrame(page.canvas, page.path, sized)
            )
          )
        );
        return { file: page.file, height: frame.height, width: frame.width };
      }),

      set_home: Effect.fnUntraced(function* ({ route, canvas }) {
        const page = yield* pageAt(route, canvas);
        if (page.route === undefined) {
          return yield* missing(
            `${page.file} serves no URL, and a prototype opens on one; give it one with set_page_url first`
          );
        }
        const home = page.route;
        const changed = yield* pagesService((pages) =>
          pages.setHome(page.canvas, home)
        );
        return { canvas: changed.id, home: changed.home };
      }),

      set_page_url: Effect.fnUntraced(function* ({ route, canvas, url }) {
        const page = yield* pageAt(route, canvas);
        const changed = yield* reported(
          project.use(
            Effect.flatMap(PagesService, (pages) =>
              pages.setRoute(page.id, url)
            )
          )
        );
        return {
          file: changed.file,
          ...(changed.route !== undefined && { route: changed.route }),
        };
      }),

      write_design_system: Effect.fnUntraced(function* ({
        designSystem: input,
        notes,
      }) {
        yield* designSystem((d) => d.write(input, notes));
        return { saved: true };
      }),
    };
  })
);
