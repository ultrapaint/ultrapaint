/**
 * The tools of a Figma import, offered to agents over MCP.
 *
 * Importing a Figma file is a conversation: the file is read by rules, but which component of
 * this repository stands in for a Figma one is a judgement, and sometimes the user's. These
 * tools let an agent see what the file holds, decide component by component, put a question
 * to the user (with ask_user) where it cannot decide, and write frames as pages once the mapping is settled.
 */
import { Json } from "@ultrapaint/contracts/base";
import {
  ComponentCandidate,
  ComponentMapping,
  FigmaComponent,
  FigmaFrame,
  FigmaPage,
} from "@ultrapaint/contracts/figma";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { CatalogueService } from "../catalogue.ts";
import { DesignSystemService } from "../design-system.ts";
import { FigmaImportService } from "../figma-import.ts";
import {
  AnyJson,
  asJson,
  makeLookup,
  missing,
  opt,
  reported,
  ToolFailure,
} from "./tools.ts";

const Failure = ToolFailure;

const decodeMapping = Schema.decodeUnknownEffect(ComponentMapping);

/** Which import a tool works on; the latest when left out, which is nearly always the one. */
const importRef = {
  import: opt(Schema.String),
};

const ListFigmaImports = Tool.make("list_figma_imports", {
  description:
    "The Figma files brought into the project, newest first; the other figma tools take the newest unless given import.",
  failure: Failure,
  success: Schema.Struct({
    imports: Schema.Array(
      Schema.Struct({
        components: Schema.Number,
        createdAt: Schema.Number,
        frames: Schema.Number,
        id: Schema.String,
        mapped: Schema.Number,
        name: Schema.String,
      })
    ),
  }),
}).annotate(Tool.Readonly, true);

const ReadFigmaImport = Tool.make("read_figma_import", {
  description:
    "A Figma file: its pages and frames (the screens to turn into pages), its components with variants, properties, uses and candidate components of this repository, and the mapping decided so far. Start here.",
  failure: Failure,
  parameters: Schema.Struct(importRef),
  success: Schema.Struct({
    components: Schema.Array(FigmaComponent),
    id: Schema.String,
    mapping: Schema.Record(Schema.String, ComponentMapping),
    name: Schema.String,
    pages: Schema.Array(FigmaPage),
    warnings: Schema.Array(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

const ReadFigmaFrame = Tool.make("read_figma_frame", {
  description:
    "One frame, by id (12:345) or name: its layers as an outline, with each component instance and whether it is mapped, and the page document it converts to now; unmapped instances are expanded into their layers.",
  failure: Failure,
  parameters: Schema.Struct({
    ...importRef,
    /** The frame's id (12:345) or its name. */
    frame: Schema.String,
  }),
  success: Schema.Struct({
    document: Json,
    frame: FigmaFrame,
    outline: Schema.String,
    /** Component key → instances expanded because nothing was decided for them yet. */
    unmapped: Schema.Record(Schema.String, Schema.Number),
    warnings: Schema.Array(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

const ReadFigmaComponent = Tool.make("read_figma_component", {
  description:
    "One Figma component, by key: its variants and properties, candidates, the frames using it, its layers, and what it converts to when kept as it is. Read it before mapping it.",
  failure: Failure,
  parameters: Schema.Struct({
    ...importRef,
    /** The component's key, as read_figma_import lists it. */
    component: Schema.String,
  }),
  success: Schema.Struct({
    candidates: Schema.Array(ComponentCandidate),
    component: FigmaComponent,
    document: Json,
    outline: Schema.String,
    usedIn: Schema.Array(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

const MapFigmaComponent = Tool.make("map_figma_component", {
  description: `Decide what every instance of a Figma component becomes; mapping is one of:
- {kind:"component", component, from?, props?, propMap?, text?}: a component of this repository by export name. props go to every instance. propMap maps Figma properties: {"Size":{prop:"size",values:{"Large":"lg"}}}, {"Label":{text:true}}, {"Disabled":{prop:"disabled"}}. text is "children" for the text the instance shows, or a text property's name.
- {kind:"expand"}: kept as it is, built from rows, columns, text and images.
- {kind:"skip"}: left out.
null forgets the decision.`,
  failure: Failure,
  parameters: Schema.Struct({
    ...importRef,
    component: Schema.String,
    mapping: AnyJson,
  }),
  success: Schema.Struct({
    mapping: Schema.NullOr(ComponentMapping),
    /** Props named in the mapping that the catalogue does not know; they still pass through. */
    notes: Schema.Array(Schema.String),
    /** Components still without a decision, by key. */
    undecided: Schema.Array(Schema.String),
  }),
});

const WriteFigmaFrame = Tool.make("write_figma_frame", {
  description:
    "Write a frame as a page named after it, converted with the mapping as it stands, its images copied to assets and sized as in Figma. Give it a URL when it is a screen of the application. Map the components first; what is unmapped is expanded and reported.",
  failure: Failure,
  parameters: Schema.Struct({
    ...importRef,
    canvas: opt(Schema.String),
    frame: Schema.String,
    /** The URL the page serves, `/settings/billing`; none when left out. */
    route: opt(Schema.String),
  }),
  success: Schema.Struct({
    file: Schema.String,
    route: Schema.optional(Schema.String),
    unmapped: Schema.Record(Schema.String, Schema.Number),
    warnings: Schema.Array(Schema.String),
  }),
});

export const FigmaTools = Toolkit.make(
  ListFigmaImports,
  ReadFigmaImport,
  ReadFigmaFrame,
  ReadFigmaComponent,
  MapFigmaComponent,
  WriteFigmaFrame
);

export const FigmaToolsLive = FigmaTools.toLayer(
  Effect.gen(function* () {
    const { project, canvasOf } = yield* makeLookup;

    const imports = <A, E extends { readonly message: string }>(
      f: (service: FigmaImportService["Service"]) => Effect.Effect<A, E>
    ) => reported(project.use(Effect.flatMap(FigmaImportService, f)));

    /** The import named, or the newest one; a project with none is told to import first. */
    const importOf = Effect.fnUntraced(function* (id: string | undefined) {
      if (id !== undefined) {
        return yield* imports((s) => s.get(id));
      }
      const latest = yield* imports((s) => s.latest);
      return (
        latest ??
        (yield* missing(
          "no Figma file has been imported; the user imports one from the Pages panel"
        ))
      );
    });

    /** The catalogue entry a mapping names, and what it does not know about the mapping's props. */
    const checkMapping = Effect.fnUntraced(function* (
      mapping: ComponentMapping
    ) {
      if (mapping.kind !== "component") {
        return { mapping, notes: [] as string[] };
      }
      const catalogue = yield* reported(
        project.use(Effect.flatMap(CatalogueService, (c) => c.get(false)))
      );
      const component = catalogue.components.find(
        (c) => c.name === mapping.component
      );
      if (!component) {
        const close = catalogue.components
          .filter((c) =>
            c.name.toLowerCase().includes(mapping.component.toLowerCase())
          )
          .map((c) => c.name)
          .slice(0, 5);
        return yield* missing(
          `no component named ${mapping.component} in this repository${close.length > 0 ? `; close: ${close.join(", ")}` : ""}. list_components has them all, or map it as {kind:"expand"} to keep the Figma layers.`
        );
      }
      const { designSystem } = yield* reported(
        project.use(Effect.flatMap(DesignSystemService, (d) => d.get))
      );
      const from =
        mapping.from ??
        designSystem?.components?.[component.name]?.from ??
        component.importFrom;
      const known = new Set(component.props.map((p) => p.name));
      const named = [
        ...Object.keys(mapping.props ?? {}),
        ...Object.values(mapping.propMap ?? {}).flatMap((rule) =>
          rule.prop === undefined ? [] : [rule.prop]
        ),
      ];
      const notes = named
        .filter((prop) => !known.has(prop))
        .map(
          (prop) =>
            `${component.name} does not declare a prop ${prop}; it is passed on anyway`
        );
      return { mapping: { ...mapping, from }, notes };
    });

    return {
      list_figma_imports: Effect.fnUntraced(function* () {
        const all = yield* imports((s) => s.list);
        return {
          imports: all.map((entry) => ({
            components: entry.components.length,
            createdAt: entry.createdAt,
            frames: entry.pages.reduce(
              (sum, page) => sum + page.frames.length,
              0
            ),
            id: entry.id,
            mapped: Object.keys(entry.mapping).length,
            name: entry.name,
          })),
        };
      }),

      map_figma_component: Effect.fnUntraced(function* ({
        component,
        import: id,
        mapping,
      }) {
        const entry = yield* importOf(id);
        let decided: ComponentMapping | null = null;
        let notes: string[] = [];
        if (mapping !== null) {
          const raw = yield* decodeMapping(mapping).pipe(
            Effect.mapError(
              (error) =>
                new ToolFailure({
                  message: `the mapping is not valid: ${error.message}`,
                })
            )
          );
          ({ mapping: decided, notes } = yield* checkMapping(raw));
        }
        const next = yield* imports((s) => s.map(entry.id, component, decided));
        return {
          mapping: decided,
          notes,
          undecided: next.components
            .filter((c) => !(c.key in next.mapping))
            .map((c) => c.key),
        };
      }),

      read_figma_component: Effect.fnUntraced(function* ({
        component,
        import: id,
      }) {
        const entry = yield* importOf(id);
        const preview = yield* imports((s) => s.component(entry.id, component));
        return {
          candidates: preview.component.candidates,
          component: preview.component,
          document: asJson(preview.document),
          outline: preview.outline,
          usedIn: preview.usedIn,
        };
      }),

      read_figma_frame: Effect.fnUntraced(function* ({ frame, import: id }) {
        const entry = yield* importOf(id);
        const preview = yield* imports((s) => s.frame(entry.id, frame));
        return {
          document: asJson(preview.document),
          frame: preview.frame,
          outline: preview.outline,
          unmapped: preview.unmapped,
          warnings: preview.warnings,
        };
      }),

      read_figma_import: Effect.fnUntraced(function* ({ import: id }) {
        const entry = yield* importOf(id);
        return {
          components: entry.components,
          id: entry.id,
          mapping: entry.mapping,
          name: entry.name,
          pages: entry.pages,
          warnings: entry.warnings,
        };
      }),

      write_figma_frame: Effect.fnUntraced(function* ({
        frame,
        import: id,
        route,
        canvas,
      }) {
        const entry = yield* importOf(id);
        const inCanvas = yield* canvasOf(canvas);
        const written = yield* imports((s) =>
          s.writeFrame(entry.id, frame, inCanvas, route)
        );
        return {
          file: written.page.file,
          ...(written.page.route !== undefined && {
            route: written.page.route,
          }),
          unmapped: written.unmapped,
          warnings: written.warnings,
        };
      }),
    };
  })
);
