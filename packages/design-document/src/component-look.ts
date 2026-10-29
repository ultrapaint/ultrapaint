/**
 * A system component's look drawn over it (ADRs 0029, 0040, 0041). The renderer marks every
 * instance with the component it is and the variant props it was given; a look, the style fields
 * of each part at its base, in each variant and in each state, becomes a stylesheet keyed on
 * those marks, so the component keeps its behaviour and takes the design's look. The project's
 * looks are unlayered and come after the default looks' layer, so they win over it without
 * `!important`, and a property a look does not set stays the default's.
 */

import {
  COMPONENT_STATES,
  ROOT_SLOT,
} from "@ultrapaint/contracts/component-names";
import type {
  ComponentState,
  PartStyle,
  PartStyles,
} from "@ultrapaint/contracts/components";
import type { Border, Padding } from "@ultrapaint/contracts/document";
import { ITEMS, JUSTIFY, type StyleContext } from "./css.ts";

/** A system component's look as it is drawn: its file's fields, with what the catalogue says of it. */
export interface ComponentLook {
  /** Style fields every instance starts from, per part. */
  readonly base: PartStyles;
  readonly component: string;
  /** The member each variant axis starts in when an instance does not say. */
  readonly defaults: Readonly<Record<string, string>>;
  /** The optional parts it leaves out. */
  readonly hidden?: readonly string[] | undefined;
  /** Its parts, the root first: the order their rules are written in. */
  readonly parts: readonly string[];
  /** Style fields per state, per part. */
  readonly states: Readonly<Record<string, PartStyles>>;
  /** Style fields per variant axis, per member, per part. */
  readonly variants: Readonly<
    Record<string, Readonly<Record<string, PartStyles>>>
  >;
}

/** The attribute values the renderer puts on an instance's root. */
export const COMPONENT_ATTRIBUTE = "data-ed-c";
export const VARIANT_ATTRIBUTE = "data-ed-v";
export const STATE_ATTRIBUTE = "data-ed-state";
/**
 * What a system component's part outside its instance's element carries (ADR 0040): an overlay's popup,
 * portalled into the frame's body, is the component's as a portal, not as its root.
 */
export const PORTAL_ATTRIBUTE = "data-ed-p";
/** The div the renderer draws around a component that does not forward its props (0015). */
const WRAPPER_ATTRIBUTE = "data-ed-wrapper";

const WHITESPACE_RE = /\s+/g;
const CSS_STRING_RE = /["\\\n\r\f]/g;

/** Props that are content, not a variant. */
const NOT_VARIANTS: ReadonlySet<string> = new Set(["children"]);

/**
 * `variant:outline size:sm` from an instance's props: every string, number and boolean prop,
 * whitespace in values replaced by `_`, sorted by key, so a look can match one token of it.
 */
export const variantAttributeOf = (
  props: Readonly<Record<string, unknown>> | undefined
): string =>
  Object.entries(props ?? {})
    .filter(
      ([key, value]) =>
        !NOT_VARIANTS.has(key) &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean")
    )
    // An object's keys are distinct, so no two compare equal.
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([key, value]) =>
        `${key.replace(WHITESPACE_RE, "_")}:${String(value).replace(WHITESPACE_RE, "_")}`
    )
    .join(" ");

/** A value as the inside of a double-quoted CSS string. */
const cssString = (value: string): string =>
  value.replace(CSS_STRING_RE, (c) =>
    c === '"' || c === "\\" ? `\\${c}` : `\\${c.charCodeAt(0).toString(16)} `
  );

const attribute = (name: string, op: "" | "~" | "^" | "*", value: string) =>
  `[${name}${op}="${cssString(value)}"]`;

/** Padding on every side at once, or side by side. */
const paddingCss = (
  value: Padding,
  css: (v: string | number) => string
): Record<string, string> => {
  if (typeof value === "number" || typeof value === "string") {
    return { padding: css(value) };
  }
  const out: Record<string, string> = {};
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const length = value[side];
    if (length !== undefined) {
      out[`padding-${side}`] = css(length);
    }
  }
  return out;
};

/**
 * A border. A width draws a line the way a node's border does, solid unless it says otherwise;
 * a colour alone recolours the code's own border without adding one.
 */
const borderCss = (
  border: Border,
  css: (v: string | number) => string
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (border.color !== undefined) {
    out["border-color"] = css(border.color);
  }
  if (border.width !== undefined) {
    out["border-width"] = css(border.width);
  }
  if (border.style !== undefined || border.width !== undefined) {
    out["border-style"] = border.style ?? "solid";
  }
  return out;
};

/** The CSS of one part's style as declarations, kebab-case property to value, tokens resolved. */
export const partStyleCss = (
  style: PartStyle,
  ctx: StyleContext
): Record<string, string> => {
  const { css } = ctx.resolver;
  const out: Record<string, string> = {};
  if (style.fill !== undefined) {
    out["background-color"] = css(style.fill);
  }
  if (style.color !== undefined) {
    out.color = css(style.color);
  }
  if (style.border) {
    Object.assign(out, borderCss(style.border, css));
  }
  if (style.radius !== undefined) {
    out["border-radius"] = css(style.radius);
  }
  if (style.padding !== undefined) {
    Object.assign(out, paddingCss(style.padding, css));
  }
  if (style.height !== undefined) {
    out.height = css(style.height);
  }
  if (style.width !== undefined) {
    out.width = css(style.width);
  }
  if (style.gap !== undefined) {
    out.gap = css(style.gap);
  }
  if (style.opacity !== undefined) {
    out.opacity = String(style.opacity);
  }
  if (style.shadow !== undefined) {
    out["box-shadow"] = css(style.shadow);
  }
  if (style.fontSize !== undefined) {
    out["font-size"] = css(style.fontSize);
  }
  if (style.fontWeight !== undefined) {
    out["font-weight"] =
      typeof style.fontWeight === "number"
        ? String(style.fontWeight)
        : css(style.fontWeight);
  }
  Object.assign(out, layoutCss(style));
  return out;
};

/** How a part lays out what it holds, and where it goes among its siblings. */
const layoutCss = (style: PartStyle): Record<string, string> => {
  const out: Record<string, string> = {};
  if (style.direction !== undefined) {
    out.display = "flex";
    out["flex-direction"] = style.direction;
  }
  if (style.align !== undefined) {
    out["justify-content"] = JUSTIFY[style.align] ?? "flex-start";
  }
  if (style.crossAlign !== undefined) {
    out["align-items"] = ITEMS[style.crossAlign] ?? "stretch";
  }
  if (style.order !== undefined) {
    out.order = String(style.order);
  }
  return out;
};

/**
 * What a state is in the DOM: its pseudo-class and the attributes the headless libraries set
 * (Base UI, Radix, React Aria). `data-ed-state` pins it on the instance for the look's matrix.
 */
const STATE_SELECTORS: Record<ComponentState, readonly string[]> = {
  // A tab that is the selected one is active, as Base UI marks it.
  active: [":active", "[data-pressed]", "[data-active]"],
  checked: [
    "[data-checked]",
    '[data-state="checked"]',
    '[aria-checked="true"]',
    ":checked",
  ],
  disabled: [":disabled", "[data-disabled]", '[aria-disabled="true"]'],
  focus: [":focus-visible", "[data-focus-visible]"],
  highlighted: ["[data-highlighted]"],
  hover: [":hover", "[data-hovered]"],
  invalid: ['[aria-invalid="true"]', "[data-invalid]"],
  open: [
    "[data-open]",
    "[data-popup-open]",
    '[data-state="open"]',
    '[aria-expanded="true"]',
  ],
};

/** The states in the order their rules are written: disabled last, so it wins over the rest. */
const STATE_ORDER: readonly ComponentState[] = [
  ...COMPONENT_STATES.filter((s) => s !== "disabled"),
  "disabled",
];

/**
 * Where a rule matches. `host` is added to the element the renderer marks (the component's root,
 * or the wrapper drawn around it); `target` to the component's own root element, where its
 * pseudo-classes and the headless libraries' attributes are; `part` to the part itself, where
 * Base UI puts a part's own state (a checkbox's `data-checked`, a tab's `data-active`, an item's
 * `data-highlighted`).
 */
interface Match {
  readonly host: string;
  readonly part?: string;
  readonly target: string;
}

/**
 * The selectors of a slot under one match: the root as drawn bare and as wrapped. A part is also
 * found in a portal of the component's (an overlay's popup), inside it or as the portalled
 * element itself.
 */
const selectorsOf = (
  component: string,
  slot: string,
  { host, part: onPart = "", target }: Match
): string[] => {
  const marked = attribute(COMPONENT_ATTRIBUTE, "", component);
  if (slot === ROOT_SLOT) {
    // The root is the part: a state on it is the root's.
    const own = `${target}${onPart}`;
    return [
      `${marked}:not([${WRAPPER_ATTRIBUTE}])${host}${own}`,
      `${marked}[${WRAPPER_ATTRIBUTE}]${host} > *${own}`,
    ];
  }
  const part = `${attribute("data-slot", "", slot)}${onPart}`;
  const portal = attribute(PORTAL_ATTRIBUTE, "", component);
  return [
    `${marked}:not([${WRAPPER_ATTRIBUTE}])${host}${target} ${part}`,
    `${marked}[${WRAPPER_ATTRIBUTE}]${host} > *${target} ${part}`,
    `${portal}${host}${target} ${part}`,
    `${portal}${host}${target}${part}`,
  ];
};

/** The parts a style record sets, the look's own order first. */
const slotsOf = (look: ComponentLook, styles: PartStyles): string[] => {
  const named = [ROOT_SLOT, ...look.parts];
  const keys = Object.keys(styles);
  return [...new Set([...named.filter((n) => keys.includes(n)), ...keys])];
};

const ruleOf = (
  selectors: readonly string[],
  declarations: Record<string, string>
): string | null => {
  const body = Object.entries(declarations);
  if (body.length === 0) {
    return null;
  }
  return `${selectors.join(",\n")} {\n${body
    .map(([property, value]) => `  ${property}: ${value};`)
    .join("\n")}\n}`;
};

/** The rules of one style record, a rule per slot, matched by any of `matches`. */
const rulesOf = (
  look: ComponentLook,
  styles: PartStyles | undefined,
  matches: readonly Match[],
  ctx: StyleContext
): string[] => {
  if (!styles) {
    return [];
  }
  return slotsOf(look, styles).flatMap((slot) => {
    const style = styles[slot];
    const rule =
      style &&
      ruleOf(
        [
          ...new Set(
            matches.flatMap((m) => selectorsOf(look.component, slot, m))
          ),
        ],
        partStyleCss(style, ctx)
      );
    return rule ? [rule] : [];
  });
};

/**
 * One member of a variant axis. The axis' default also matches an instance that does not set
 * the axis: no token of `data-ed-v` starts with `axis:`. Both negations sit in one `:not()`,
 * so the default is exactly as specific as a member named outright, and a state still wins.
 */
const variantMatches = (
  axis: string,
  member: string,
  isDefault: boolean
): Match[] => {
  const named = {
    host: attribute(VARIANT_ATTRIBUTE, "~", `${axis}:${member}`),
    target: "",
  };
  if (!isDefault) {
    return [named];
  }
  const unset = `:not(${attribute(VARIANT_ATTRIBUTE, "^", `${axis}:`)}, ${attribute(VARIANT_ATTRIBUTE, "*", ` ${axis}:`)})`;
  return [named, { host: unset, target: "" }];
};

/**
 * A state as its selectors on the component's root, on the part itself, and pinned on the
 * instance.
 */
const stateMatches = (state: ComponentState): Match[] => [
  ...STATE_SELECTORS[state].map((target) => ({ host: "", target })),
  ...STATE_SELECTORS[state].map((part) => ({ host: "", part, target: "" })),
  { host: attribute(STATE_ATTRIBUTE, "~", state), target: "" },
];

const lookRules = (look: ComponentLook, ctx: StyleContext): string[] => [
  ...rulesOf(look, look.base, [{ host: "", target: "" }], ctx),
  ...Object.entries(look.variants).flatMap(([axis, members]) =>
    Object.entries(members).flatMap(([member, styles]) =>
      rulesOf(
        look,
        styles,
        variantMatches(axis, member, look.defaults[axis] === member),
        ctx
      )
    )
  ),
  ...STATE_ORDER.flatMap((state) =>
    rulesOf(look, look.states[state], stateMatches(state), ctx)
  ),
  ...hiddenRules(look),
];

/** The optional parts a look leaves out, drawn as nothing. */
const hiddenRules = (look: ComponentLook): string[] => {
  const parts = (look.hidden ?? []).filter((p) => p !== ROOT_SLOT);
  if (parts.length === 0) {
    return [];
  }
  const rule = ruleOf(
    parts.flatMap((p) =>
      selectorsOf(look.component, p, { host: "", target: "" })
    ),
    { display: "none" }
  );
  return rule ? [rule] : [];
};

/**
 * The stylesheet that draws looks over their components: base, then each variant axis' members,
 * then the states with disabled last.
 */
export const lookCss = (
  looks: readonly ComponentLook[],
  ctx: StyleContext
): string => {
  const rules = looks.flatMap((look) => lookRules(look, ctx));
  return rules.length === 0 ? "" : `${rules.join("\n\n")}\n`;
};
