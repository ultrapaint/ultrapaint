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
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { EditService } from "../edit.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";

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

export const EditorTools = Toolkit.make(
  GetContext,
  ListPages,
  ReadPage,
  ListComponents,
  GetComponent
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

    const pagesOf = project.use(Effect.flatMap(PagesService, (p) => p.list));
    const catalogueOf = project.use(
      Effect.flatMap(CatalogueService, (c) => c.get(false))
    );

    return {
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
        const pages = yield* reported(pagesOf);
        const page = pages.pages.find(
          (p) => p.route === route || p.file === route
        );
        if (!page) {
          return yield* missing(
            `no page at ${route}; call list_pages to see the routes`
          );
        }
        const { content } = yield* reported(
          project.use(
            Effect.flatMap(EditService, (edit) => edit.read(page.file))
          )
        );
        return { file: page.file, source: content };
      }),
    };
  })
);
