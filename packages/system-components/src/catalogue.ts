/**
 * The editor's own system components (ADR 0040), as data: what each is for, the props a design sets, its
 * variant axes, its parts (`data-slot`, which a look styles and a design fills), the states a look
 * styles and the layer it draws in. No React here: the server, the agents' briefings and the
 * editor's panels read it without loading a component.
 *
 * A system component's behaviour is Base UI's, run by the editor; its look is the design's (a file per
 * system component, over the default look in `look.ts`). Implementing a design hands the look of each
 * part in each state to an agent, which applies it to whatever the application uses.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type {
  Catalogue,
  ComponentMeta,
  PropMeta,
} from "@ultrapaint/contracts/catalogue";
import {
  APP_FROM,
  ROOT_SLOT,
  SYSTEM_FROM,
  variantKey,
} from "@ultrapaint/contracts/component-names";
import {
  type AppComponentFile,
  appComponentsIn,
  type ComponentFile,
  type ComponentProperty,
  type SystemComponentFile,
  systemComponentsIn,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { componentSlotOf } from "@ultrapaint/design-document/app-components";
import { findNode } from "@ultrapaint/design-document/tree";

/** Where a system component draws: in the page's flow, anchored to it above the page, or over the page. */
type ComponentLayer = "inline" | "anchored" | "blocking";

/** A part of a system component. */
interface SystemComponentSlot {
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
  /**
   * A look can leave it out (`hidden`): a part that shows something, not one that does
   * something. A behavioural part (a trigger, a popup, an item, a tab list) is never optional.
   */
  readonly optional?: true;
}

export interface SystemComponentMeta {
  readonly category: string;
  readonly description: string;
  /** The props a new instance starts with. */
  readonly example: Readonly<Record<string, JsonValue>>;
  readonly layer: ComponentLayer;
  readonly name: string;
  readonly props: readonly PropMeta[];
  /** Its parts, the root first. */
  readonly slots: readonly SystemComponentSlot[];
  /** The states its look can be given for (`COMPONENT_STATES`). */
  readonly states: readonly string[];
  /** Its items can be drawn by a template of design nodes (`item`): a Select's, a Menu's. */
  readonly templatedItems?: true;
  /** The text a new instance shows, for one that shows text. */
  readonly text?: string;
  /** Variant axes and their members; the first member is the default. */
  readonly variants: Readonly<Record<string, readonly string[]>>;
}

const prop = (
  name: string,
  kind: PropMeta["type"]["kind"],
  extra: Pick<PropMeta, "defaultValue"> & {
    readonly members?: readonly string[];
  } = {}
): PropMeta => ({
  name,
  type: {
    kind,
    ...(extra.members && { members: extra.members }),
  },
  ...(extra.defaultValue !== undefined && {
    defaultValue: extra.defaultValue,
  }),
});

const text = (name: string, defaultValue?: string) =>
  prop(name, "string", {
    ...(defaultValue !== undefined && { defaultValue }),
  });
const flag = (name: string) => prop(name, "boolean", { defaultValue: false });
const choice = (name: string, members: readonly string[]) =>
  prop(name, "enum", { defaultValue: members[0], members });
const list = (name: string) => prop(name, "list");

const OPEN = flag("open");
const DISABLED = flag("disabled");

const BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
const SIZES = ["md", "sm", "lg"] as const;

export const SYSTEM_COMPONENTS: readonly SystemComponentMeta[] = [
  {
    category: "Actions",
    description:
      "A button: its label and any icon are its children, a spinner while it is loading.",
    example: { variant: "primary" },
    layer: "inline",
    name: "Button",
    props: [
      choice("variant", BUTTON_VARIANTS),
      choice("size", [...SIZES, "icon"]),
      DISABLED,
      flag("loading"),
    ],
    slots: [
      { holds: "default", label: "Button", layout: "row", name: ROOT_SLOT },
      { label: "Spinner", name: "button-spinner" },
    ],
    states: ["hover", "focus", "active", "disabled", "open"],
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
      choice("variant", ["default", "secondary", "outline", "destructive"]),
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
    props: [choice("size", SIZES)],
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
    props: [text("src"), text("fallback", "AL"), choice("size", SIZES)],
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
    props: [text("title"), text("description")],
    slots: [
      { label: "Card", name: ROOT_SLOT },
      {
        holds: "nodes",
        label: "Header",
        layout: "column",
        name: "card-header",
      },
      { label: "Title", name: "card-title", optional: true },
      { label: "Description", name: "card-description", optional: true },
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
    props: [choice("orientation", ["horizontal", "vertical"])],
    slots: [{ label: "Separator", name: ROOT_SLOT }],
    states: [],
    variants: { orientation: ["horizontal", "vertical"] },
  },
  {
    category: "Forms",
    description:
      "A text field, with an optional label above it and an icon at the start of its box (input-icon).",
    example: { label: "Email", placeholder: "you@example.com" },
    layer: "inline",
    name: "Input",
    props: [
      text("label"),
      text("placeholder"),
      text("value"),
      choice("type", [
        "text",
        "email",
        "password",
        "number",
        "search",
        "url",
        "tel",
      ]),
      choice("size", SIZES),
      DISABLED,
      flag("invalid"),
    ],
    slots: [
      { label: "Field", name: ROOT_SLOT },
      { label: "Label", name: "field-label", optional: true },
      { label: "Input", name: "input" },
      { holds: "nodes", label: "Icon", layout: "row", name: "input-icon" },
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
      text("label"),
      text("placeholder"),
      text("value"),
      prop("rows", "number", {
        defaultValue: 3,
      }),
      DISABLED,
      flag("invalid"),
    ],
    slots: [
      { label: "Field", name: ROOT_SLOT },
      { label: "Label", name: "field-label", optional: true },
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
    props: [text("label"), flag("checked"), DISABLED],
    slots: [
      { label: "Field", name: ROOT_SLOT },
      { label: "Box", name: "checkbox" },
      { label: "Tick", name: "checkbox-indicator" },
      { label: "Label", name: "field-label", optional: true },
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
    props: [text("label"), flag("checked"), DISABLED],
    slots: [
      { label: "Field", name: ROOT_SLOT },
      { label: "Track", name: "switch" },
      { label: "Thumb", name: "switch-thumb" },
      { label: "Label", name: "field-label", optional: true },
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
    props: [list("items"), text("value")],
    slots: [
      { label: "Tabs", name: ROOT_SLOT },
      { label: "List", name: "tabs-list" },
      { label: "Tab", name: "tab" },
      { label: "Indicator", name: "tabs-indicator", optional: true },
      { holds: "default", label: "Panel", layout: "column", name: "tab-panel" },
    ],
    states: ["hover", "focus", "active"],
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
      text("label"),
      list("items"),
      text("value"),
      text("placeholder"),
      OPEN,
      DISABLED,
    ],
    slots: [
      { label: "Field", name: ROOT_SLOT },
      { label: "Label", name: "field-label", optional: true },
      { label: "Trigger", name: "select-trigger" },
      { label: "Value", name: "select-value" },
      { label: "Icon", name: "select-icon", optional: true },
      { label: "Popup", name: "select-popup" },
      { label: "Item", name: "select-item" },
      { label: "Check", name: "select-item-indicator", optional: true },
    ],
    states: ["hover", "focus", "open", "highlighted", "disabled"],
    templatedItems: true,
    variants: {},
  },
  {
    category: "Overlays",
    description:
      "A menu of actions, opened by its trigger: the children. An item `-` is a separator.",
    example: { items: ["Profile", "Settings", "-", "Sign out"] },
    layer: "anchored",
    name: "Menu",
    props: [list("items"), choice("align", ["start", "center", "end"]), OPEN],
    slots: [
      { holds: "default", label: "Trigger", layout: "row", name: ROOT_SLOT },
      { label: "Popup", name: "menu-popup" },
      { label: "Item", name: "menu-item" },
      { label: "Separator", name: "menu-separator" },
    ],
    states: ["open", "highlighted"],
    templatedItems: true,
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
      text("title"),
      choice("side", ["bottom", "top", "left", "right"]),
      OPEN,
    ],
    slots: [
      { holds: "nodes", label: "Trigger", layout: "row", name: "trigger" },
      { label: "Popup", name: "popover" },
      { label: "Title", name: "popover-title", optional: true },
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
      text("content", "A helpful hint"),
      choice("side", ["top", "bottom", "left", "right"]),
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
    props: [text("title"), text("description"), choice("size", SIZES), OPEN],
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
      { label: "Description", name: "dialog-description", optional: true },
      {
        holds: "default",
        label: "Content",
        layout: "column",
        name: "dialog-content",
      },
      { holds: "nodes", label: "Footer", layout: "row", name: "dialog-footer" },
      { label: "Close", name: "dialog-close", optional: true },
    ],
    states: ["open", "hover"],
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
      text("title"),
      text("description"),
      choice("variant", ["default", "destructive"]),
      OPEN,
    ],
    slots: [
      { label: "Toast", name: ROOT_SLOT },
      { label: "Title", name: "toast-title" },
      { label: "Description", name: "toast-description", optional: true },
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

const byName = new Map(SYSTEM_COMPONENTS.map((p) => [p.name, p]));

/** The system component named `name`, if there is one. */
export const systemComponentOf = (
  name: string
): SystemComponentMeta | undefined => byName.get(name);

/** How each variant of a look lays a part out, where it says (`direction`), by `<axis>=<member>`. */
const layoutsIn = (
  look: SystemComponentFile | undefined,
  part: string
): Record<string, "row" | "column"> =>
  Object.fromEntries(
    Object.entries(look?.variants ?? {}).flatMap(([axis, members]) =>
      Object.entries(members).flatMap(([member, styles]) => {
        const direction = styles[part]?.direction;
        return direction
          ? [[variantKey(axis, member), direction] as const]
          : [];
      })
    )
  );

/**
 * A system component as the catalogue lists a component, its slots laid out as the project's look
 * says (`direction`, at its base and in each variant) over the catalogue's own layout.
 */
const systemEntryOf = (
  meta: SystemComponentMeta,
  look: SystemComponentFile | undefined
): ComponentMeta => ({
  category: meta.category,
  description: meta.description,
  example: meta.example,
  importFrom: SYSTEM_FROM,
  name: meta.name,
  props: meta.props,
  slots: meta.slots.map((s) => {
    const layout = look?.base[s.name]?.direction ?? s.layout;
    const layoutIn = s.holds ? layoutsIn(look, s.name) : {};
    return {
      label: s.label,
      name: s.name,
      ...(s.holds && { holds: s.holds }),
      ...(layout && { layout }),
      ...(Object.keys(layoutIn).length > 0 && { layoutIn }),
    };
  }),
  ...(meta.text !== undefined && { text: meta.text }),
  variants: Object.fromEntries(
    Object.entries(meta.variants).map(([axis, members]) => [axis, [...members]])
  ),
});

/** A property as a catalogue's prop: what the inspector edits and an agent reads. */
const propOf = (property: ComponentProperty): PropMeta => ({
  defaultValue: property.default,
  name: property.name,
  type:
    property.kind === "choice"
      ? { kind: "enum", members: property.members ?? [] }
      : { kind: property.kind === "boolean" ? "boolean" : "string" },
});

/** How a container of a type lays out what it holds. */
const layoutOfType = (type: string | undefined): "row" | "column" | "block" => {
  if (type === "row" || type === "column") {
    return type;
  }
  return type === "page" ? "column" : "block";
};

/**
 * How a slot's container lays out what it holds: at its base, and where its type turns, in a
 * choice's member (`size=lg`) or at a breakpoint (`md`), as its `at` keeps it.
 */
const slotLayoutsOf = (tree: DesignNode, id: string) => {
  const node = findNode(tree, id);
  const at = (node?.at ?? {}) as Record<string, { type?: string }>;
  const layoutIn = Object.fromEntries(
    Object.entries(at).flatMap(([key, over]) =>
      over.type === undefined ? [] : [[key, layoutOfType(over.type)] as const]
    )
  );
  return {
    layout: layoutOfType(node?.type),
    ...(Object.keys(layoutIn).length > 0 && { layoutIn }),
  };
};

/**
 * An app component as the catalogue lists a component (ADR 0041): its properties as props, its
 * choices as variant axes, its slots as a system component's are, placed with `from: "#app"`.
 */
const appEntryOf = (file: AppComponentFile): ComponentMeta => ({
  category: file.category ?? "App",
  ...(file.description !== undefined && { description: file.description }),
  importFrom: APP_FROM,
  name: file.name,
  props: file.properties.map(propOf),
  slots: file.slots.map((s) => ({
    ...componentSlotOf(s),
    ...slotLayoutsOf(file.tree, s.node),
  })),
  variants: Object.fromEntries(
    file.properties.flatMap((p) =>
      p.kind === "choice" ? [[p.name, [...(p.members ?? [])]]] : []
    )
  ),
});

/**
 * The catalogue (ADR 0042): what a design can place, over the project's component files. The
 * system components, each as the editor ships it laid out as its look says, then the app
 * components that read; the server gives it to the agents and the web to its panels, from the
 * same files.
 */
export const catalogueOf = (files: readonly ComponentFile[]): Catalogue => {
  const looks = new Map(systemComponentsIn(files).map((f) => [f.name, f]));
  return [
    ...SYSTEM_COMPONENTS.map((meta) =>
      systemEntryOf(meta, looks.get(meta.name))
    ),
    ...appComponentsIn(files).map(appEntryOf),
  ];
};
