/**
 * The editor's own tools, offered to agents over MCP.
 *
 * What an agent otherwise has to piece together by reading the repository — where the designs
 * are, what routes exist, which components it may use and what props they take — the server
 * already knows. These answer it in one call. They only read: the file edits stay the agent's
 * own, through its file tools, so nothing here competes with what it is already good at.
 */
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { EventBus } from "../../events.ts";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { CommentsService } from "../comments.ts";
import { EditService } from "../edit.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";
import { CallingThread } from "./access.ts";

/** What a tool says when it cannot answer: the reason, in words the agent can act on. */
const Failure = Schema.Struct({ message: Schema.String });

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
    "The source of one page, found by its route (/settings/billing) or by its file.",
  failure: Failure,
  parameters: Schema.Struct({ route: Schema.String }),
  success: Schema.Struct({
    file: Schema.String,
    source: Schema.String,
  }),
}).annotate(Tool.Readonly, true);

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
    "One component in full: where to import it from, every prop with its type, its variants, and a snippet that uses it.",
  failure: Failure,
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.Struct({
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
    snippet: Schema.String,
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
    "Add a page at a route. The file goes where the project keeps its designs, named so the route matches, and the space's router is written if it is the first page. Prefer this to creating the file yourself.",
  failure: Failure,
  parameters: Schema.Struct({
    route: Schema.String,
    space: Schema.optional(Schema.String),
    /** One of the project's page templates; the plain one when left out. */
    template: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    file: Schema.String,
    route: Schema.String,
    source: Schema.String,
  }),
});

const RenamePage = Tool.make("rename_page", {
  description:
    "Move a page to another route. The file moves with it, which is what changes the route.",
  failure: Failure,
  parameters: Schema.Struct({ route: Schema.String, to: Schema.String }),
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
  parameters: Schema.Struct({ route: Schema.String }),
  success: Schema.Struct({ route: Schema.String }),
}).annotate(Tool.Readonly, true);

export const EditorTools = Toolkit.make(
  GetContext,
  ListPages,
  ReadPage,
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
const reported = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>
) => Effect.mapError(effect, (error) => ({ message: error.message }));

const missing = (message: string) => Effect.fail({ message });

export const EditorToolsLive = EditorTools.toLayer(
  Effect.gen(function* () {
    const project = yield* ProjectManager;
    const events = yield* EventBus;

    const pagesOf = project.use(Effect.flatMap(PagesService, (p) => p.list));

    /** The space a tool was told to work in, or the only one there is. */
    const spaceOf = Effect.fnUntraced(function* (space: string | undefined) {
      if (space) {
        return space;
      }
      const pages = yield* reported(pagesOf);
      return pages.spaces[0]?.id ?? "";
    });

    const pageAt = Effect.fnUntraced(function* (route: string) {
      const pages = yield* reported(pagesOf);
      const page = pages.pages.find(
        (p) => p.route === route || p.file === route
      );
      return page === undefined
        ? yield* missing(
            `no page at ${route}; call list_pages to see the routes`
          )
        : page;
    });
    const catalogueOf = project.use(
      Effect.flatMap(CatalogueService, (c) => c.get(false))
    );

    return {
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
        const { content } = yield* reported(
          project.use(
            Effect.flatMap(EditService, (edit) => edit.read(page.file))
          )
        );
        return { file: page.file, route: page.route, source: content };
      }),

      focus: Effect.fnUntraced(function* ({ route }) {
        const page = yield* pageAt(route);
        const threadId = yield* Effect.service(CallingThread);
        if (threadId) {
          yield* events.publish("agent.focus", { route: page.route, threadId });
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
        return {
          file: component.file,
          importFrom: component.importFrom,
          name: component.name,
          props: component.props.map((prop) => ({
            name: prop.name,
            required: prop.required,
            type: prop.type.raw,
          })),
          snippet: component.snippet,
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

      read_page: Effect.fnUntraced(function* ({ route }) {
        const page = yield* pageAt(route);
        const { content } = yield* reported(
          project.use(
            Effect.flatMap(EditService, (edit) => edit.read(page.file))
          )
        );
        return { file: page.file, source: content };
      }),

      rename_page: Effect.fnUntraced(function* ({ route, to }) {
        const page = yield* pageAt(route);
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
    };
  })
);
