/**
 * The catalogue (ADR 0042): every component a design can place, system and app (ADR 0041), as
 * the palette, the inspector, the renderer and the agents read it. It is a view over the
 * component files, made by system-components' `catalogueOf`; nothing keeps it.
 */
import { Schema } from "effect";
import { Json } from "./base.ts";
import { APP_FROM } from "./component-names.ts";

export const PropType = Schema.Struct({
  kind: Schema.Literals(["string", "number", "boolean", "enum", "list"]),
  members: Schema.optional(Schema.Array(Schema.String)),
});
export type PropType = typeof PropType.Type;

export const PropMeta = Schema.Struct({
  defaultValue: Schema.optional(Json),
  description: Schema.optional(Schema.String),
  name: Schema.String,
  required: Schema.Boolean,
  type: PropType,
});
export type PropMeta = typeof PropMeta.Type;

/** A prop's type as an agent or a tooltip reads it: `"sm" | "md"`, `boolean`. */
export const typeText = (type: PropType): string =>
  type.kind === "enum"
    ? (type.members ?? []).map((m) => JSON.stringify(m)).join(" | ")
    : type.kind;

/**
 * A part of a component (ADR 0040): a system component's by `data-slot`, an app component's
 * slot. A slot that `holds` nodes is filled by the instance's children that name it; `default`
 * takes the rest.
 */
export const SlotLayout = Schema.Literals(["row", "column", "block"]);
export type SlotLayout = typeof SlotLayout.Type;

export const ComponentSlot = Schema.Struct({
  holds: Schema.optional(Schema.Literals(["nodes", "default"])),
  label: Schema.String,
  /** How it lays out what it holds: the catalogue's, a look's `direction` at its base over it. */
  layout: Schema.optional(SlotLayout),
  /**
   * How it lays them out where that differs: in a variant whose look sets a `direction` or whose
   * container's type differs (`<axis>=<member>`), at a breakpoint an app component's container
   * turns at (`md`).
   */
  layoutIn: Schema.optional(Schema.Record(Schema.String, SlotLayout)),
  name: Schema.String,
});
export type ComponentSlot = typeof ComponentSlot.Type;

export const ComponentMeta = Schema.Struct({
  category: Schema.String,
  description: Schema.optional(Schema.String),
  /** The props a new instance starts with, and its thumbnail is drawn with. */
  example: Schema.optional(Schema.Record(Schema.String, Json)),
  /** What an instance names as `from`: `@ultrapaint/system` or `#app`. */
  importFrom: Schema.String,
  name: Schema.String,
  props: Schema.Array(PropMeta),
  /** Its parts, the root first. */
  slots: Schema.Array(ComponentSlot),
  /** The text a new instance shows, for one that shows text. */
  text: Schema.optional(Schema.String),
  /** Variant axes: name -> members. */
  variants: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});
export type ComponentMeta = typeof ComponentMeta.Type;

/** The system components, then the project's app components. */
export type Catalogue = readonly ComponentMeta[];

/** The catalogue's entry for an instance: the same name from the same origin, else by name. */
export const metaOf = (
  catalogue: Catalogue,
  instance: { readonly component: string; readonly from: string }
): ComponentMeta | undefined =>
  catalogue.find(
    (c) => c.name === instance.component && c.importFrom === instance.from
  ) ?? catalogue.find((c) => c.name === instance.component);

/**
 * A component in one line, as an agent picks one: the project's own marked (app), its variants,
 * with `props` its other props, and the slots its children fill, the default one marked `*`
 * (`Dialog — size: md|sm|lg; slots: trigger, dialog-content*, dialog-footer`).
 */
export const componentLine = (
  component: ComponentMeta,
  options: { readonly props?: boolean } = {}
): string => {
  const variants = Object.entries(component.variants).map(
    ([name, members]) => `${name}: ${members.join("|")}`
  );
  const others = options.props
    ? component.props
        .map((p) => p.name)
        .filter((name) => !(name in component.variants))
    : [];
  const slots = component.slots.flatMap((slot) => {
    if (slot.holds === undefined) {
      return [];
    }
    return [slot.holds === "default" ? `${slot.name}*` : slot.name];
  });
  const about = [
    ...variants,
    ...(others.length > 0 ? [`props: ${others.join(", ")}`] : []),
    ...(slots.length > 0 ? [`slots: ${slots.join(", ")}`] : []),
  ].join("; ");
  const origin = component.importFrom === APP_FROM ? " (app)" : "";
  return `${component.name}${origin}${about ? ` — ${about}` : ""}`;
};
