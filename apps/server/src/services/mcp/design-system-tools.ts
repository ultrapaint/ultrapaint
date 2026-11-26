/**
 * The tools of the design system and the components: the design system as recorded, read from
 * the stylesheets or written, and the catalogue's components with an instance to start from.
 */
import { Json } from "@ultrapaint/contracts/base";
import { componentLine, typeText } from "@ultrapaint/contracts/catalogue";
import {
  SYSTEM_FROM,
  type SystemComponentFile,
  systemComponentsIn,
} from "@ultrapaint/contracts/components";
import type { DesignFinding } from "@ultrapaint/contracts/design-system";
import { newInstance } from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { systemComponentOf } from "@ultrapaint/system-components/catalogue";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { CodeSide } from "../code-side.ts";
import { ComponentService } from "../components.ts";
import { DesignSystemService } from "../design-system.ts";
import { lookParts } from "../threads/agent-docs.ts";
import { TOOLS } from "../threads/agent-ways.ts";
import { makeLookup } from "./lookup.ts";
import {
  AnyJson,
  asJson,
  doing,
  missing,
  opt,
  reported,
  ToolFailure,
} from "./tool-helpers.ts";

/**
 * What a Select's or a Menu's item is, and how it shows a picture: the renderer gives the item
 * template's image node the item's image and keeps the node's other fields (UP-227).
 */
const ITEMS =
  "An item of items is a label or { label, image }. Its image is drawn in the image node of the look's item template (setItem: { tree, label, image }), keeping that node's tint: an icon in the product's colour.";

/** A look's style places: what an agent reads before it sets a part's whole style at one. */
const drawnLook = (look: SystemComponentFile | undefined) =>
  look && {
    base: look.base,
    states: look.states,
    variants: look.variants,
    ...(look.variantStates && { variantStates: look.variantStates }),
  };

/** A finding of the DESIGN.md linter as one line an agent reads. */
const findingLine = (f: DesignFinding) =>
  `${f.severity}: ${f.path ? `${f.path}: ` : ""}${f.message}`;

const ScanDesignSystem = Tool.make("scan_design_system", {
  description:
    "A first design-system.json read from the code's tokens, with the files read and what it could not place. /init starts here.",
  failure: ToolFailure,
  success: Schema.Struct({
    designSystem: Json,
    files: Schema.Array(Schema.String),
    notes: Schema.Array(Schema.String),
  }),
}).annotateMerge(doing("read"));

const ReadDesignSystem = Tool.make("read_design_system", {
  description:
    "design-system.json (tokens, text styles) and DESIGN.md; null when never imported.",
  failure: ToolFailure,
  success: Schema.Struct({
    designMd: Schema.NullOr(Schema.String),
    designSystem: Json,
    /** What the format's linter says about DESIGN.md. */
    findings: Schema.Array(Schema.String),
    problem: Schema.optional(Schema.String),
  }),
}).annotateMerge(doing("read"));

const WriteDesignSystem = Tool.make("write_design_system", {
  description:
    "Save the design system, every token with its value, and DESIGN.md with designMd; refused with why when invalid. A token is color-primary; a text style says $color-primary. Sync baselines are the tool's: any given are ignored.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** The whole of DESIGN.md. */
    designMd: opt(Schema.String),
    designSystem: AnyJson,
  }),
  success: Schema.Struct({
    /** What the format's linter says, and values put back to the design system's. */
    findings: Schema.Array(Schema.String),
    saved: Schema.Boolean,
  }),
}).annotateMerge(doing("destructive", { idempotent: true }));

const ListComponents = Tool.make("list_components", {
  description:
    "Every component, one line each: variants, props, slots (* the default). match narrows. Prefer them to plain HTML.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** Narrows the list; leave empty for all of them. */
    match: opt(Schema.String),
  }),
  success: Schema.Struct({
    /** One line each (`componentLine`): `Dialog — size: md|sm|lg; slots: trigger, dialog-content*`. */
    components: Schema.Array(Schema.String),
    /**
     * The components' files that do not read, each with why (UP-227): such a component is left
     * out, or drawn in its default look, until its file is fixed.
     */
    problems: Schema.optional(Schema.Array(Schema.String)),
  }),
}).annotateMerge(doing("read"));

const GetComponent = Tool.make("get_component", {
  description:
    "One component: what it is for, props with types, variants, slots and an instance node to start from.",
  failure: ToolFailure,
  parameters: Schema.Struct({ name: Schema.String }),
  success: Schema.Struct({
    description: Schema.optional(Schema.String),
    /** An instance node that uses it, ready for apply_operations: its `from` says its origin. */
    example: Json,
    /** A Select's or a Menu's: what an item is, and how it shows a picture. */
    items: Schema.optional(Schema.String),
    /**
     * A system component's look, its file's or the default when it has none (a field a file
     * leaves out keeps the default's): its parts' style at the base, per variant member, per
     * state and per state in a member. A setStyle's style is the part's whole style at its place.
     */
    look: Schema.optional(Json),
    name: Schema.String,
    /**
     * A system component's parts a look styles (`root`, or a `data-slot`), `?` after those it may
     * leave out.
     */
    parts: Schema.optional(Schema.Array(Schema.String)),
    /** Each prop with its type: `size: "md" | "sm"`. */
    props: Schema.Array(Schema.String),
    /** The parts its children fill, by name (`*` the default), and how each lays them out. */
    slots: Schema.Array(Schema.String),
    /** The states a system component's look can be given for. */
    states: Schema.optional(Schema.Array(Schema.String)),
    variants: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  }),
}).annotateMerge(doing("read"));

export const DesignSystemTools = Toolkit.make(
  ScanDesignSystem,
  ReadDesignSystem,
  WriteDesignSystem,
  ListComponents,
  GetComponent
);

export const DesignSystemToolsLive = DesignSystemTools.toLayer(
  Effect.gen(function* () {
    const { project } = yield* makeLookup;
    const components = <A>(
      f: (service: ComponentService["Service"]) => Effect.Effect<A>
    ) => reported(project.use(Effect.flatMap(ComponentService, f)));
    const catalogue = components((c) => c.catalogue);

    const designSystem = <A, E extends { readonly message: string }>(
      f: (service: DesignSystemService["Service"]) => Effect.Effect<A, E>
    ) => reported(project.use(Effect.flatMap(DesignSystemService, f)));

    return DesignSystemTools.of({
      get_component: Effect.fn("EditorTools.get_component")(function* ({
        name,
      }) {
        const component = (yield* catalogue).find((c) => c.name === name);
        if (!component) {
          return yield* missing(
            `no component named ${name}; call ${TOOLS.list_components} to see what there is`
          );
        }
        const example = newInstance(component, makeIdGenerator());
        const system =
          component.importFrom === SYSTEM_FROM
            ? systemComponentOf(component.name)
            : undefined;
        const file = system
          ? systemComponentsIn(yield* components((c) => c.components)).find(
              (c) => c.name === name
            )
          : undefined;
        return {
          ...(component.description !== undefined && {
            description: component.description,
          }),
          example: asJson(example),
          ...(system?.templatedItems && { items: ITEMS }),
          ...(system && {
            look: asJson(drawnLook(file ?? defaultLookOf(name))),
            parts: lookParts(system),
            states: system.states,
          }),
          name: component.name,
          props: component.props.map(
            (prop) => `${prop.name}: ${typeText(prop.type)}`
          ),
          slots: component.slots.flatMap((slot) =>
            slot.holds === undefined
              ? []
              : [
                  `${slot.name}${slot.holds === "default" ? "*" : ""} (${slot.layout ?? "block"})`,
                ]
          ),
          variants: component.variants,
        };
      }),

      list_components: Effect.fn("EditorTools.list_components")(function* ({
        match,
      }) {
        const needle = match?.toLowerCase();
        const matches = (name: string) =>
          !needle || name.toLowerCase().includes(needle);
        // What does not read is said beside the list, never left for the editor alone (UP-227).
        const problems = (yield* components((c) => c.list)).components
          .filter((e) => e.problem !== undefined && matches(e.file))
          .map((e) => `${e.file}: ${e.problem}`);
        return {
          components: (yield* catalogue)
            .filter((component) => matches(component.name))
            .map((component) => componentLine(component, { props: true })),
          ...(problems.length > 0 && { problems }),
        };
      }),

      read_design_system: Effect.fn("EditorTools.read_design_system")(
        function* () {
          const state = yield* designSystem((d) => d.get);
          // The sync's baselines are the tool's, and a write keeps them: an agent needs none.
          const {
            codeSync: _c,
            designMd: _d,
            sync: _s,
            ...ownFields
          } = state.designSystem ?? {};
          return {
            designMd: state.document?.text ?? null,
            designSystem: asJson(state.designSystem ? ownFields : null),
            findings: (state.document?.findings ?? [])
              .filter((f) => f.severity !== "info")
              .map(findingLine),
            ...(state.problem !== undefined && { problem: state.problem }),
          };
        }
      ),

      scan_design_system: Effect.fn("EditorTools.scan_design_system")(
        function* () {
          const found = yield* reported(
            project.use(Effect.flatMap(CodeSide, (c) => c.scan))
          );
          return {
            designSystem: asJson(found.designSystem),
            files: found.files,
            notes: found.notes,
          };
        }
      ),

      write_design_system: Effect.fn("EditorTools.write_design_system")(
        function* ({ designMd, designSystem: input }) {
          const { findings } = yield* designSystem((d) =>
            d.write(input, designMd)
          );
          return { findings: findings.map(findingLine), saved: true };
        }
      ),
    });
  })
);
