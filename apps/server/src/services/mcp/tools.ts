/**
 * The editor's own tools, offered to agents over MCP.
 *
 * What an agent otherwise has to piece together by reading the repository — where the designs
 * are, what routes exist, which components it may use and what props they take — the server
 * already knows. These answer it in one call. Pages are design documents the editor owns, so
 * changing one goes through the same operations the editor uses (`apply_operations`), which
 * validate every change and make it one undo step; the design system is written the same way.
 */
import { Json, type JsonValue } from "@ultrapaint/contracts/base";
import { DocOp } from "@ultrapaint/contracts/document";
import { newInstance } from "@ultrapaint/design-document/factories";
import { fillIds, makeIdGenerator } from "@ultrapaint/design-document/ids";
import { fillWarnings } from "@ultrapaint/design-document/sizing";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { EventBus } from "../../events.ts";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { CommentsService } from "../comments.ts";
import { DesignSystemService } from "../design-system.ts";
import { DocumentService } from "../documents.ts";
import { PagesService } from "../pages.ts";
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

/** Past this many, `apply_operations` says how many more warnings there are. */
const MAX_WARNINGS = 12;

const PageSummary = Schema.Struct({
  file: Schema.String,
  name: Schema.String,
  route: Schema.String,
  space: Schema.String,
});

const ComponentSummary = Schema.Struct({
  importFrom: Schema.String,
  name: Schema.String,
  props: Schema.Array(Schema.String),
  variants: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});

const GetContext = Tool.make("get_context", {
  description:
    "Where this project keeps its designs and what is in it: the repository root, the designs directory, the package pages import from, the spaces, and how many pages and components there are. Call this first.",
  failure: Failure,
  success: Schema.Struct({
    designsDir: Schema.String,
    pageCount: Schema.Number,
    resolveFrom: Schema.String,
    root: Schema.String,
    spaces: Schema.Array(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

const ListPages = Tool.make("list_pages", {
  description:
    "Every page in the project with its route and the file it lives in. A page's path is its route.",
  failure: Failure,
  success: Schema.Struct({ pages: Schema.Array(PageSummary) }),
}).annotate(Tool.Readonly, true);

const ReadPage = Tool.make("read_page", {
  description:
    "One page's design document, found by its route (/settings/billing) or by its file: a tree of nodes (page, group, row, column, text, image, instance) with their ids. Pass the hash to apply_operations to make sure nothing changed in between.",
  failure: Failure,
  parameters: Schema.Struct({
    route: Schema.String,
    /** Needed only when the route is a page in more than one space. */
    space: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    document: Json,
    file: Schema.String,
    hash: Schema.String,
  }),
}).annotate(Tool.Readonly, true);

const ReadCanvas = Tool.make("read_canvas", {
  description:
    "The nodes placed on a space's canvas beside the pages, each with its x and y. Change them with apply_operations and `canvas: true`.",
  failure: Failure,
  parameters: Schema.Struct({ space: Schema.optional(Schema.String) }),
  success: Schema.Struct({ hash: Schema.String, nodes: Json }),
}).annotate(Tool.Readonly, true);

const GetDocumentFormat = Tool.make("get_document_format", {
  description:
    "The page format in full: the JSON Schema of a page document, and how its nodes and tokens map to code. Read it before writing a page or its operations by hand.",
  failure: Failure,
  success: Schema.Struct({ rules: Schema.String, schema: Json }),
}).annotate(Tool.Readonly, true);

const ApplyOperations = Tool.make("apply_operations", {
  description: `Change a page, or the canvas, through the editor: the change is validated, shows on the canvas at once and is one undo step for the user. Operations, applied in order:
- {op:"insert", parent, index?, node}: parent is a node id (the page's root id for its top level), or null for the top level; index defaults to the end. The node may leave out ids.
- {op:"remove", id}
- {op:"move", id, parent, index?}: the index counts the parent's children without the moved node.
A node inserted or moved into an instance that shows "text" and has no children turns that text into the instance's first child, a text node, and goes after it. Moving or removing the last other node out of an instance turns a plain paragraph it is left holding back into its "text".
- {op:"update", id, set:{field: value}}: null removes a field. A group, row or column may change "type" to one of the others.
- {op:"setProps", id, props:{name: value}}: an instance's props; null removes one.
- {op:"wrap", ids:[...], type:"row"|"column"|"group"}: siblings into a new container.
- {op:"unwrap", id}: a container replaced by its children.
- {op:"duplicate", id}
Values: numbers are pixels, "$name" is a design token (--name), anything else plain CSS.
Size an instance with width, height, padding and the other box fields, never with a className prop: the canvas puts them on the component itself, as the code will. The answer's "warnings" name the nodes whose "fill" has no room to take, because their parent's size follows its content.`,
  failure: Failure,
  parameters: Schema.Struct({
    /** Work on the canvas of the space instead of a page. */
    canvas: Schema.optional(Schema.Boolean),
    /** The hash read_page answered with; the call is refused if the page changed since. */
    expectedHash: Schema.optional(Schema.String),
    /** What the undo menu calls it. */
    label: Schema.optional(Schema.String),
    /** Checked once the ids a new node leaves out are filled in. */
    ops: Schema.Array(Json),
    /** Route or file of the page; leave out with `canvas: true`. */
    route: Schema.optional(Schema.String),
    space: Schema.optional(Schema.String),
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
    "Reads the design system by fixed rules: the Tailwind v4 @theme blocks of the stylesheets the preview imports, and the variables they refer to. Answers with a first design-system.json, the files read, and notes on what it could not interpret. The start of /init.",
  failure: Failure,
  success: Schema.Struct({
    designSystem: Json,
    files: Schema.Array(Schema.String),
    notes: Schema.Array(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

const ReadDesignSystem = Tool.make("read_design_system", {
  description:
    "The design system as the project records it: design-system.json (tokens, text styles, component notes) and DESIGN.md (conventions). Null when it was never imported.",
  failure: Failure,
  success: Schema.Struct({
    designSystem: Json,
    notes: Schema.NullOr(Schema.String),
    problem: Schema.optional(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

const WriteDesignSystem = Tool.make("write_design_system", {
  description: `Saves the design system: design-system.json and, when given, DESIGN.md. Refused with the reason when it does not match the schema. Tokens are named after their Tailwind v4 variables without the dashes ("color-primary"); references to them in text styles start with "$". JSON Schema: ${designSystemSchema()}`,
  failure: Failure,
  parameters: Schema.Struct({
    designSystem: Json,
    /** The whole of DESIGN.md. */
    notes: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ saved: Schema.Boolean }),
});

const ListComponents = Tool.make("list_components", {
  description:
    "The components this repository's design system offers, with the import to use and the variants each takes. Prefer these to writing plain HTML.",
  failure: Failure,
  parameters: Schema.Struct({
    /** Narrows the list; leave empty for all of them. */
    match: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ components: Schema.Array(ComponentSummary) }),
}).annotate(Tool.Readonly, true);

const GetComponent = Tool.make("get_component", {
  description:
    "One component in full: where to import it from, every prop with its type, its variants, and an instance node that uses it.",
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
    "The comments left on the designs, which is where the user asks for things. Open ones first.",
  failure: Failure,
  parameters: Schema.Struct({
    /** Include the ones already dealt with. */
    includeResolved: Schema.optional(Schema.Boolean),
    space: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ comments: Schema.Array(CommentSummary) }),
}).annotate(Tool.Readonly, true);

const CreatePage = Tool.make("create_page", {
  description:
    "Add a page at a route. The file goes where the project keeps its designs, named so the route matches. Prefer this to creating the file yourself; then fill it with apply_operations.",
  failure: Failure,
  parameters: Schema.Struct({
    route: Schema.String,
    space: Schema.optional(Schema.String),
    /** One of the project's page templates; the plain one when left out. */
    template: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    document: Json,
    file: Schema.String,
    route: Schema.String,
  }),
});

const RenamePage = Tool.make("rename_page", {
  description:
    "Move a page to another route. The file moves with it, which is what changes the route.",
  failure: Failure,
  parameters: Schema.Struct({
    route: Schema.String,
    /** Needed only when the route is a page in more than one space. */
    space: Schema.optional(Schema.String),
    to: Schema.String,
  }),
  success: Schema.Struct({ file: Schema.String, route: Schema.String }),
});

const ReplyToComment = Tool.make("reply_to_comment", {
  description:
    "Answer a comment on the designs, in the thread under it, so the user reads it where they asked.",
  failure: Failure,
  parameters: Schema.Struct({
    id: Schema.String,
    space: Schema.optional(Schema.String),
    text: Schema.String,
  }),
  success: Schema.Struct({ replies: Schema.Number }),
});

const ResolveComment = Tool.make("resolve_comment", {
  description:
    "Mark a comment as dealt with, once the work it asked for is done.",
  failure: Failure,
  parameters: Schema.Struct({
    id: Schema.String,
    space: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ resolved: Schema.Boolean }),
});

const Focus = Tool.make("focus", {
  description:
    "Say which page you are working on. The canvas shows it, and brings the user there if they asked to follow you. Call it when you move to another page.",
  failure: Failure,
  parameters: Schema.Struct({
    route: Schema.String,
    /** Needed only when the route is a page in more than one space. */
    space: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ route: Schema.String }),
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
  CreatePage,
  RenamePage,
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

/** Documents and the design system are JSON through and through; their types only say more. */
const asJson = (value: unknown) => value as JsonValue;

/**
 * How a tool finds what an agent names: a space, a page by route or file, a document. Every
 * miss is a sentence that says what there is instead.
 */
export const makeLookup = Effect.gen(function* () {
  const project = yield* ProjectManager;

  const pagesOf = project.use(Effect.flatMap(PagesService, (p) => p.list));

  /** A space's id as an agent would pass it back: the designs directory's own is `""`. */
  const named = (id: string) => JSON.stringify(id);

  /**
   * The space a tool was told to work in, or the only one there is. With several and none
   * named, the tool says so rather than pick one: the first is not what the agent meant.
   */
  const spaceOf = Effect.fnUntraced(function* (space: string | undefined) {
    const { spaces } = yield* reported(pagesOf);
    const ids = spaces.map((s) => named(s.id)).join(", ");
    if (space !== undefined) {
      return spaces.some((s) => s.id === space)
        ? space
        : yield* missing(`no space ${named(space)}; the spaces are ${ids}`);
    }
    if (spaces.length <= 1) {
      return spaces[0]?.id ?? "";
    }
    return yield* missing(
      `this project has several spaces (${ids}); say which with \`space\``
    );
  });

  /** A page by route (or file), in the space named, or in the only space that has it. */
  const pageAt = Effect.fnUntraced(function* (
    route: string,
    space: string | undefined
  ) {
    const { pages } = yield* reported(pagesOf);
    const found = pages.filter(
      (p) =>
        (p.route === route || p.file === route) &&
        (space === undefined || p.space === space)
    );
    const [only] = found;
    if (only && found.length === 1) {
      return only;
    }
    if (found.length === 0) {
      const where = space === undefined ? "" : ` in space ${named(space)}`;
      return yield* missing(
        `no page at ${route}${where}; call list_pages to see the routes`
      );
    }
    return yield* missing(
      `${route} is a page in several spaces (${found.map((p) => named(p.space)).join(", ")}); say which with \`space\``
    );
  });

  const documents = <A, E extends { readonly message: string }>(
    f: (service: DocumentService["Service"]) => Effect.Effect<A, E>
  ) => reported(project.use(Effect.flatMap(DocumentService, f)));

  return { documents, pageAt, pagesOf, project, spaceOf };
});

export const EditorToolsLive = EditorTools.toLayer(
  Effect.gen(function* () {
    const events = yield* EventBus;
    const { documents, pageAt, pagesOf, project, spaceOf } = yield* makeLookup;
    const catalogueOf = project.use(
      Effect.flatMap(CatalogueService, (c) => c.get(false))
    );

    const designSystem = <A, E extends { readonly message: string }>(
      f: (service: DesignSystemService["Service"]) => Effect.Effect<A, E>
    ) => reported(project.use(Effect.flatMap(DesignSystemService, f)));

    return {
      apply_operations: Effect.fnUntraced(function* ({
        canvas,
        expectedHash,
        label,
        ops,
        route,
        space,
      }) {
        let doc: string;
        if (canvas) {
          doc = canvasDocOf(yield* spaceOf(space));
        } else if (route === undefined) {
          return yield* missing(
            "say which page with `route`, or pass `canvas: true` for the canvas"
          );
        } else {
          doc = (yield* pageAt(route, space)).id;
        }
        // A node an agent writes may leave its ids out; they are made before the ops are read.
        const raw = JSON.parse(JSON.stringify(ops)) as unknown[];
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

      create_page: Effect.fnUntraced(function* ({ route, space, template }) {
        const page = yield* reported(
          project.use(
            Effect.flatMap(PagesService, (pages) =>
              Effect.flatMap(spaceOf(space), (id) =>
                pages.create(id, route, template)
              )
            )
          )
        );
        const state = yield* documents((d) => d.get(page.id));
        return {
          document: asJson(state.root),
          file: page.file,
          route: page.route,
        };
      }),

      focus: Effect.fnUntraced(function* ({ route, space }) {
        const page = yield* pageAt(route, space);
        const threadId = yield* Effect.service(CallingThread);
        if (threadId) {
          // The page, not the route: the same route can be a page in two spaces.
          yield* events.publish("agent.focus", {
            pageId: page.id,
            route: page.route,
            threadId,
          });
        }
        return { route: page.route };
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
          designsDir: paths.settings.designsDir,
          pageCount: pages.pages.length,
          resolveFrom: paths.settings.resolveFrom ?? paths.settings.designsDir,
          root: paths.root,
          spaces: pages.spaces.map((space) => space.id),
        };
      }),

      get_document_format: () =>
        Effect.succeed({
          rules: IMPLEMENTATION_RULES,
          schema: asJson(JSON.parse(pageSchema())),
        }),

      list_comments: Effect.fnUntraced(function* ({ includeResolved, space }) {
        const id = yield* spaceOf(space);
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

      list_pages: Effect.fnUntraced(function* () {
        const pages = yield* reported(pagesOf);
        return {
          pages: pages.pages.map((page) => ({
            file: page.file,
            name: page.name,
            route: page.route,
            space: page.space,
          })),
        };
      }),

      read_canvas: Effect.fnUntraced(function* ({ space }) {
        const id = yield* spaceOf(space);
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

      read_page: Effect.fnUntraced(function* ({ route, space }) {
        const page = yield* pageAt(route, space);
        const state = yield* documents((d) => d.get(page.id));
        if (state.problem !== undefined) {
          return yield* missing(
            `${page.file} is not a valid page: ${state.problem}`
          );
        }
        return {
          document: asJson({ root: state.root, version: 1 }),
          file: page.file,
          hash: state.hash,
        };
      }),

      rename_page: Effect.fnUntraced(function* ({ route, space, to }) {
        const page = yield* pageAt(route, space);
        const moved = yield* reported(
          project.use(
            Effect.flatMap(PagesService, (pages) => pages.rename(page.id, to))
          )
        );
        return { file: moved.file, route: moved.route };
      }),

      reply_to_comment: Effect.fnUntraced(function* ({ id, space, text }) {
        const inSpace = yield* spaceOf(space);
        const comment = yield* reported(
          project.use(
            Effect.flatMap(CommentsService, (comments) =>
              comments.reply({ id, space: inSpace, text })
            )
          )
        );
        return { replies: comment.replies.length };
      }),

      resolve_comment: Effect.fnUntraced(function* ({ id, space }) {
        const inSpace = yield* spaceOf(space);
        const comment = yield* reported(
          project.use(
            Effect.flatMap(CommentsService, (comments) =>
              comments.update({ id, resolved: true, space: inSpace })
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
