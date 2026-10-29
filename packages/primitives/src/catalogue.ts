/**
 * The editor's own primitives (ADR 0040), as data: what each is for, the props a design sets, its
 * variant axes, its parts (`data-slot`, which a spec styles and a design fills), the states a spec
 * styles and the layer it draws in. No React here: the server, the agents' briefings and the
 * editor's panels read it without loading a component.
 *
 * A primitive's behaviour is Base UI's, run by the editor; its look is the design's (a spec per
 * primitive, over the default look in `look.ts`). Implementing a design hands the look of each
 * part in each state to an agent, which applies it to whatever the application uses.
 */
import type { ComponentMeta, PropMeta } from "@ultrapaint/contracts/catalogue";
import { PRIMITIVES_FROM, ROOT_SLOT } from "@ultrapaint/contracts/spec-names";

/** Where a primitive draws: in the page's flow, anchored to it above the page, or over the page. */
export type PrimitiveLayer = "inline" | "anchored" | "blocking";

/** A part of a primitive. */
export interface PrimitiveSlot {
  /**
   * The design puts nodes in it: an instance's children marked with this `slot`. The one marked
   * `default` takes the children that name no slot.
   */
  readonly holds?: "nodes" | "default";
  readonly label: string;
  /** How a slot that holds nodes lays them out. */
  readonly layout?: "row" | "column" | "block";
  /** `root`, or the part's `data-slot`. */
  readonly name: string;
}

export interface PrimitiveMeta {
  readonly category: string;
  readonly description: string;
  /** The props a new instance starts with. */
  readonly example: Readonly<Record<string, unknown>>;
  readonly layer: PrimitiveLayer;
  readonly name: string;
  readonly props: readonly PropMeta[];
  /** Its parts, the root first. */
  readonly slots: readonly PrimitiveSlot[];
  /** The states its look can be given for (`SPEC_STATES`). */
  readonly states: readonly string[];
  /** The text a new instance shows, for one that shows text. */
  readonly text?: string;
  /** Variant axes and their members; the first member is the default. */
  readonly variants: Readonly<Record<string, readonly string[]>>;
}

const prop = (
  name: string,
  kind: PropMeta["type"]["kind"],
  raw: string,
  description: string,
  extra: Partial<Omit<PropMeta, "name" | "type" | "description">> & {
    readonly members?: readonly string[];
  } = {}
): PropMeta => ({
  description,
  name,
  required: extra.required ?? false,
  type: {
    kind,
    raw,
    ...(extra.members && { members: extra.members }),
  },
  ...(extra.defaultValue !== undefined && {
    defaultValue: extra.defaultValue,
  }),
});

const text = (name: string, description: string, defaultValue?: string) =>
  prop(name, "string", "string", description, {
    ...(defaultValue !== undefined && { defaultValue }),
  });
const flag = (name: string, description: string) =>
  prop(name, "boolean", "boolean", description, { defaultValue: false });
const choice = (
  name: string,
  members: readonly string[],
  description: string
) =>
  prop(
    name,
    "enum",
    members.map((m) => JSON.stringify(m)).join(" | "),
    description,
    {
      defaultValue: members[0],
      members,
    }
  );
const list = (name: string, description: string) =>
  prop(name, "object", "string[]", description);

const OPEN = flag(
  "open",
  "Drawn open. In the prototype it starts open, and the user opens and closes it."
);
const DISABLED = flag("disabled", "Drawn disabled: it takes no input.");

const BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
const SIZES = ["md", "sm", "lg"] as const;

export const PRIMITIVES: readonly PrimitiveMeta[] = [
  {
    category: "Actions",
    description:
      "A button: its label and any icon are its children, a spinner while it is loading.",
    example: { variant: "primary" },
    layer: "inline",
    name: "Button",
    props: [
      choice("variant", BUTTON_VARIANTS, "How much it stands out."),
      choice(
        "size",
        [...SIZES, "icon"],
        "Its height and padding; `icon` is square."
      ),
      DISABLED,
      flag("loading", "Shows a spinner before its label and takes no input."),
    ],
    slots: [
      { holds: "default", label: "Button", layout: "row", name: ROOT_SLOT },
      { label: "Spinner", name: "button-spinner" },
    ],
    states: ["hover", "focus", "active", "disabled"],
    text: "Button",
    variants: { size: [...SIZES, "icon"], variant: BUTTON_VARIANTS },
  },
  {
    category: "Display",
    description: "A short label: a status, a count, a tag.",
    example: { variant: "default" },
    layer: "inline",
    name: "Badge",
    props: [
      choice(
        "variant",
        ["default", "secondary", "outline", "destructive"],
        "How much it stands out."
      ),
    ],
    slots: [
      { holds: "default", label: "Badge", layout: "row", name: ROOT_SLOT },
    ],
    states: [],
    text: "Badge",
    variants: { variant: ["default", "secondary", "outline", "destructive"] },
  },
  {
    category: "Display",
    description: "A spinner: something is under way.",
    example: {},
    layer: "inline",
    name: "Spinner",
    props: [choice("size", SIZES, "How big it is.")],
    slots: [{ label: "Spinner", name: ROOT_SLOT }],
    states: [],
    variants: { size: SIZES },
  },
  {
    category: "Display",
    description: "A picture of a person, or their initials when there is none.",
    example: { fallback: "AL" },
    layer: "inline",
    name: "Avatar",
    props: [
      text("src", "The picture's URL or a path in the canvas."),
      text("fallback", "What shows without a picture: initials.", "AL"),
      choice("size", SIZES, "How big it is."),
    ],
    slots: [
      { label: "Avatar", name: ROOT_SLOT },
      { label: "Image", name: "avatar-image" },
      { label: "Fallback", name: "avatar-fallback" },
    ],
    states: [],
    variants: { size: SIZES },
  },
  {
    category: "Layout",
    description:
      "A surface that groups content: a header with a title and a description, content, a footer.",
    example: { description: "A short description.", title: "Card title" },
    layer: "inline",
    name: "Card",
    props: [
      text("title", "The header's title; the header slot replaces it."),
      text("description", "The line under the title."),
    ],
    slots: [
      { label: "Card", name: ROOT_SLOT },
      {
        holds: "nodes",
        label: "Header",
        layout: "column",
        name: "card-header",
      },
      { label: "Title", name: "card-title" },
      { label: "Description", name: "card-description" },
      {
        holds: "default",
        label: "Content",
        layout: "column",
        name: "card-content",
      },
      { holds: "nodes", label: "Footer", layout: "row", name: "card-footer" },
    ],
    states: [],
    variants: {},
  },
  {
    category: "Layout",
    description: "A line between groups of content.",
    example: { orientation: "horizontal" },
    layer: "inline",
    name: "Separator",
    props: [
      choice("orientation", ["horizontal", "vertical"], "Which way it runs."),
    ],
    slots: [{ label: "Separator", name: ROOT_SLOT }],
    states: [],
    variants: { orientation: ["horizontal", "vertical"] },
  },
  {
    category: "Forms",
    description: "A text field, with an optional label above it.",
    example: { label: "Email", placeholder: "you@example.com" },
    layer: "inline",
    name: "Input",
    props: [
      text("label", "The label above the field."),
      text("placeholder", "What the empty field says."),
      text("value", "The text in the field."),
      choice(
        "type",
        ["text", "email", "password", "number", "search", "url", "tel"],
        "What the field asks for."
      ),
      choice("size", SIZES, "Its height."),
      DISABLED,
      flag("invalid", "Drawn as wrong."),
    ],
    slots: [
      { label: "Field", name: ROOT_SLOT },
      { label: "Label", name: "field-label" },
      { label: "Input", name: "input" },
    ],
    states: ["hover", "focus", "disabled", "invalid"],
    variants: { size: SIZES },
  },
  {
    category: "Forms",
    description:
      "A text field of several lines, with an optional label above it.",
    example: { label: "Message", placeholder: "Write something…" },
    layer: "inline",
    name: "Textarea",
    props: [
      text("label", "The label above the field."),
      text("placeholder", "What the empty field says."),
      text("value", "The text in the field."),
      prop("rows", "number", "number", "How many lines it shows.", {
        defaultValue: 3,
      }),
      DISABLED,
      flag("invalid", "Drawn as wrong."),
    ],
    slots: [
      { label: "Field", name: ROOT_SLOT },
      { label: "Label", name: "field-label" },
      { label: "Textarea", name: "textarea" },
    ],
    states: ["hover", "focus", "disabled", "invalid"],
    variants: {},
  },
  {
    category: "Forms",
    description: "A box that is ticked or not, with its label.",
    example: { label: "Remember me" },
    layer: "inline",
    name: "Checkbox",
    props: [
      text("label", "The text beside it."),
      flag("checked", "Drawn ticked."),
      DISABLED,
    ],
    slots: [
      { label: "Field", name: ROOT_SLOT },
      { label: "Box", name: "checkbox" },
      { label: "Tick", name: "checkbox-indicator" },
    ],
    states: ["hover", "focus", "checked", "disabled"],
    variants: {},
  },
  {
    category: "Forms",
    description: "A switch that is on or off, with its label.",
    example: { label: "Notifications" },
    layer: "inline",
    name: "Switch",
    props: [
      text("label", "The text beside it."),
      flag("checked", "Drawn on."),
      DISABLED,
    ],
    slots: [
      { label: "Field", name: ROOT_SLOT },
      { label: "Track", name: "switch" },
      { label: "Thumb", name: "switch-thumb" },
    ],
    states: ["hover", "focus", "checked", "disabled"],
    variants: {},
  },
  {
    category: "Navigation",
    description:
      "Tabs: one panel at a time. The children are the selected tab's panel.",
    example: { items: ["Overview", "Activity", "Settings"], value: "Overview" },
    layer: "inline",
    name: "Tabs",
    props: [
      list("items", "The tabs' labels, in order."),
      text("value", "The selected tab's label; the first when left out."),
    ],
    slots: [
      { label: "Tabs", name: ROOT_SLOT },
      { label: "List", name: "tabs-list" },
      { label: "Tab", name: "tab" },
      { label: "Indicator", name: "tabs-indicator" },
      { holds: "default", label: "Panel", layout: "column", name: "tab-panel" },
    ],
    states: ["hover", "focus"],
    variants: {},
  },
  {
    category: "Forms",
    description: "A choice of one among a list, which opens below its trigger.",
    example: {
      items: ["Active", "Paused", "Archived"],
      label: "Status",
      placeholder: "Choose…",
    },
    layer: "anchored",
    name: "Select",
    props: [
      text("label", "The label above the trigger."),
      list("items", "The options, in order."),
      text("value", "The chosen option; the placeholder shows when left out."),
      text("placeholder", "What the trigger says while nothing is chosen."),
      OPEN,
      DISABLED,
    ],
    slots: [
      { label: "Field", name: ROOT_SLOT },
      { label: "Label", name: "field-label" },
      { label: "Trigger", name: "select-trigger" },
      { label: "Value", name: "select-value" },
      { label: "Popup", name: "select-popup" },
      { label: "Item", name: "select-item" },
    ],
    states: ["hover", "focus", "open", "disabled"],
    variants: {},
  },
  {
    category: "Overlays",
    description:
      "A menu of actions, opened by its trigger: the children. An item `-` is a separator.",
    example: { items: ["Profile", "Settings", "-", "Sign out"] },
    layer: "anchored",
    name: "Menu",
    props: [
      list("items", "The actions, in order; `-` is a separator."),
      choice(
        "align",
        ["start", "center", "end"],
        "Where it lines up with the trigger."
      ),
      OPEN,
    ],
    slots: [
      { holds: "default", label: "Trigger", layout: "row", name: ROOT_SLOT },
      { label: "Popup", name: "menu-popup" },
      { label: "Item", name: "menu-item" },
      { label: "Separator", name: "menu-separator" },
    ],
    states: ["open"],
    text: "Open menu",
    variants: {},
  },
  {
    category: "Overlays",
    description:
      "A panel that opens next to its trigger without blocking the page: the trigger slot opens it, the children are its content.",
    example: { title: "Filters" },
    layer: "anchored",
    name: "Popover",
    props: [
      text("title", "The panel's title."),
      choice(
        "side",
        ["bottom", "top", "left", "right"],
        "Which side of the trigger it opens on."
      ),
      OPEN,
    ],
    slots: [
      { holds: "nodes", label: "Trigger", layout: "row", name: "trigger" },
      { label: "Popup", name: "popover" },
      { label: "Title", name: "popover-title" },
      {
        holds: "default",
        label: "Content",
        layout: "column",
        name: "popover-content",
      },
    ],
    states: ["open"],
    variants: {},
  },
  {
    category: "Overlays",
    description:
      "A hint that shows when its trigger, the children, is hovered or focused.",
    example: { content: "A helpful hint" },
    layer: "anchored",
    name: "Tooltip",
    props: [
      text("content", "What it says.", "A helpful hint"),
      choice(
        "side",
        ["top", "bottom", "left", "right"],
        "Which side of the trigger it shows on."
      ),
      OPEN,
    ],
    slots: [
      { holds: "default", label: "Trigger", layout: "row", name: ROOT_SLOT },
      { label: "Popup", name: "tooltip" },
    ],
    states: ["open"],
    text: "Hover me",
    variants: {},
  },
  {
    category: "Overlays",
    description:
      "A dialog over the page, which blocks it: a header with a title and a description, content (the children) and a footer. Centred on a wide page, a sheet at the bottom of a narrow one.",
    example: {
      description: "This cannot be undone.",
      open: true,
      title: "Are you sure?",
    },
    layer: "blocking",
    name: "Dialog",
    props: [
      text("title", "The header's title; the header slot replaces it."),
      text("description", "The line under the title."),
      choice("size", SIZES, "How wide it is on a wide page."),
      OPEN,
    ],
    slots: [
      { holds: "nodes", label: "Trigger", layout: "row", name: "trigger" },
      { label: "Backdrop", name: "dialog-backdrop" },
      { label: "Dialog", name: "dialog" },
      {
        holds: "nodes",
        label: "Header",
        layout: "column",
        name: "dialog-header",
      },
      { label: "Title", name: "dialog-title" },
      { label: "Description", name: "dialog-description" },
      {
        holds: "default",
        label: "Content",
        layout: "column",
        name: "dialog-content",
      },
      { holds: "nodes", label: "Footer", layout: "row", name: "dialog-footer" },
      { label: "Close", name: "dialog-close" },
    ],
    states: ["open"],
    variants: { size: SIZES },
  },
  {
    category: "Overlays",
    description:
      "A notification in the page's corner: a title, a description and an action slot.",
    example: { open: true, title: "Changes saved" },
    layer: "anchored",
    name: "Toast",
    props: [
      text("title", "What happened."),
      text("description", "More about it."),
      choice("variant", ["default", "destructive"], "What kind of news it is."),
      OPEN,
    ],
    slots: [
      { label: "Toast", name: ROOT_SLOT },
      { label: "Title", name: "toast-title" },
      { label: "Description", name: "toast-description" },
      {
        holds: "default",
        label: "Action",
        layout: "row",
        name: "toast-action",
      },
    ],
    states: ["open"],
    variants: { variant: ["default", "destructive"] },
  },
];

const byName = new Map(PRIMITIVES.map((p) => [p.name, p]));

/** The primitive named `name`, if there is one. */
export const primitiveOf = (name: string): PrimitiveMeta | undefined =>
  byName.get(name);

/** The slot a child marked `slot` goes in, or the one that takes unmarked children. */
export const slotFor = (
  meta: PrimitiveMeta,
  slot: string | undefined
): PrimitiveSlot | undefined =>
  slot === undefined
    ? meta.slots.find((s) => s.holds === "default")
    : meta.slots.find((s) => s.name === slot && s.holds !== undefined);

/** A prop as JSX writes it. */
const attributeOf = (key: string, value: unknown) => {
  if (typeof value === "string") {
    return `${key}=${JSON.stringify(value)}`;
  }
  return value === true ? key : `${key}={${JSON.stringify(value)}}`;
};

const snippetOf = (meta: PrimitiveMeta) => {
  const attributes = Object.entries(meta.example)
    .map(([key, value]) => attributeOf(key, value))
    .join(" ");
  const open = `<${meta.name}${attributes ? ` ${attributes}` : ""}`;
  return meta.text === undefined
    ? `${open} />`
    : `${open}>${meta.text}</${meta.name}>`;
};

/** A primitive as the catalogue lists a component: what the palette and the inspector read. */
export const componentMetaOf = (meta: PrimitiveMeta): ComponentMeta => ({
  category: meta.category,
  description: meta.description,
  file: "",
  group: "Primitives",
  importFrom: PRIMITIVES_FROM,
  name: meta.name,
  props: meta.props,
  slots: meta.slots.map((s) => ({
    label: s.label,
    name: s.name,
    ...(s.holds && { holds: s.holds }),
    ...(s.layout && { layout: s.layout }),
  })),
  snippet: snippetOf(meta),
  storyIds: [],
  variants: Object.fromEntries(
    Object.entries(meta.variants).map(([axis, members]) => [axis, [...members]])
  ),
});

/** Every primitive as a catalogue's components. */
export const primitiveComponents = (): ComponentMeta[] =>
  PRIMITIVES.map(componentMetaOf);
