/**
 * The tools of the design system and the components: the design system as recorded, read from
 * the stylesheets or written, and the repository's components with an instance to start from.
 */
import { Json } from "@ultrapaint/contracts/base";
import { newInstance } from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { CatalogueService } from "../catalogue.ts";
import { DesignSystemService } from "../design-system.ts";
import { makeLookup } from "./lookup.ts";
import {
  AnyJson,
  asJson,
  missing,
  opt,
  reported,
  ToolFailure,
} from "./tool-helpers.ts";

const Failure = ToolFailure;

const ComponentSummary = Schema.Struct({
  importFrom: Schema.String,
  name: Schema.String,
  props: Schema.Array(Schema.String),
  variants: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});

export const ScanDesignSystem = Tool.make("scan_design_system", {
  description:
    "A first design-system.json, read by fixed rules from the Tailwind v4 @theme blocks of the stylesheets the preview imports, with the files read and notes on what could not be interpreted. The start of /init.",
  failure: Failure,
  success: Schema.Struct({
    designSystem: Json,
    files: Schema.Array(Schema.String),
    notes: Schema.Array(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

export const ReadDesignSystem = Tool.make("read_design_system", {
  description:
    "The design system as recorded: design-system.json (tokens, text styles, component notes) and DESIGN.md (conventions); null when never imported.",
  failure: Failure,
  success: Schema.Struct({
    designSystem: Json,
    notes: Schema.NullOr(Schema.String),
    problem: Schema.optional(Schema.String),
  }),
}).annotate(Tool.Readonly, true);

export const WriteDesignSystem = Tool.make("write_design_system", {
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

export const ListComponents = Tool.make("list_components", {
  description:
    "The repository's components, with their import and variants; match narrows the list. Prefer them to plain HTML.",
  failure: Failure,
  parameters: Schema.Struct({
    /** Narrows the list; leave empty for all of them. */
    match: opt(Schema.String),
  }),
  success: Schema.Struct({ components: Schema.Array(ComponentSummary) }),
}).annotate(Tool.Readonly, true);

export const GetComponent = Tool.make("get_component", {
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

const DesignSystemTools = Toolkit.make(
  ScanDesignSystem,
  ReadDesignSystem,
  WriteDesignSystem,
  ListComponents,
  GetComponent
);

export const designSystemToolHandlers = Effect.gen(function* () {
  const { project } = yield* makeLookup;
  const catalogueOf = project.use(
    Effect.flatMap(CatalogueService, (c) => c.get(false))
  );

  const designSystem = <A, E extends { readonly message: string }>(
    f: (service: DesignSystemService["Service"]) => Effect.Effect<A, E>
  ) => reported(project.use(Effect.flatMap(DesignSystemService, f)));

  return DesignSystemTools.of({
    get_component: Effect.fn("EditorTools.get_component")(function* ({ name }) {
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

    list_components: Effect.fn("EditorTools.list_components")(function* ({
      match,
    }) {
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

    read_design_system: Effect.fn("EditorTools.read_design_system")(
      function* () {
        const state = yield* designSystem((d) => d.get);
        return {
          designSystem: asJson(state.designSystem),
          notes: state.notes,
          ...(state.problem !== undefined && { problem: state.problem }),
        };
      }
    ),

    scan_design_system: Effect.fn("EditorTools.scan_design_system")(
      function* () {
        const found = yield* designSystem((d) => d.scan);
        return {
          designSystem: asJson(found.designSystem),
          files: found.files,
          notes: found.notes,
        };
      }
    ),

    write_design_system: Effect.fn("EditorTools.write_design_system")(
      function* ({ designSystem: input, notes }) {
        yield* designSystem((d) => d.write(input, notes));
        return { saved: true };
      }
    ),
  });
});
