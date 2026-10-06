/**
 * A node as code: the JSX and Tailwind v4 utilities the rules agents implement a page by (the
 * `/implement` briefing) turn it into. The application's code is still written by an agent, in
 * the repository's own conventions (ADR 0015); this is the reference translation the editor
 * shows, so a user can see what a design means before an agent writes it. It reads the fields
 * the way `css.ts` draws them, and says what the canvas draws in the utilities that draw the same.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  InstanceNode,
  Length,
  Padding,
  Size,
  TextNode,
} from "@ultrapaint/contracts/document";
import type { InstanceDrawn } from "@ultrapaint/contracts/preview";
import {
  layoutOf,
  makeStyleContext,
  type ParentLayout,
  type StyleContext,
  tagOf,
  typeSettingsOf,
} from "./css.ts";
import { isToken, tokenName, toPixels } from "./tokens.ts";
import { childrenOf, nodeLabel } from "./tree.ts";

const INDENT = "  ";
/** Past this width an opening tag puts each attribute on a line of its own. */
const LINE_WIDTH = 80;

const WHITESPACE_RE = /\s+/g;
/** What JSX text would read as markup or an expression, or would collapse. */
const JSX_UNSAFE_RE = /[{}<>\n]|^\s|\s$/;
/** What JSX decodes in text and in a quoted attribute: `&amp;`, `&#169;`. */
const ENTITY_RE = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i;
const ATTRIBUTE_NAME_RE = /^[A-Za-z_$][\w$-]*$/;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const WORD_RE = /[A-Za-z0-9]+/g;

/** Tailwind v4's own names for the font weights, which a number set in the document maps to. */
const WEIGHTS: Record<number, string> = {
  100: "thin",
  200: "extralight",
  300: "light",
  400: "normal",
  500: "medium",
  600: "semibold",
  700: "bold",
  800: "extrabold",
  900: "black",
};

/** CSS lengths that have a utility of their own. */
const LENGTH_KEYWORDS: Record<string, string> = {
  "0": "0",
  "100%": "full",
  "100dvh": "dvh",
  "100vh": "screen",
  "100vw": "screen",
  auto: "auto",
  "fit-content": "fit",
  "max-content": "max",
  "min-content": "min",
};

const COLOR_KEYWORDS: Record<string, string> = {
  black: "black",
  currentColor: "current",
  currentcolor: "current",
  inherit: "inherit",
  transparent: "transparent",
  white: "white",
};

const JUSTIFY: Record<string, string> = {
  around: "justify-around",
  between: "justify-between",
  center: "justify-center",
  end: "justify-end",
  start: "justify-start",
};

const TEXT_ALIGN: Record<string, string> = {
  center: "text-center",
  end: "text-right",
  start: "text-left",
};

export interface CodeOptions {
  /**
   * Name of the function a page is written as; given, a page node becomes that component.
   * Left out, the page is written as its markup alone.
   */
  readonly component?: string | undefined;
  /**
   * The `href` a link is written with: a link naming a page file is the URL that page serves.
   * Left out, the link is written as it is.
   */
  readonly hrefOf?: ((link: string) => string) | undefined;
  /**
   * How the preview drew the instances, by node id (`ed:instances`): how each lays out its
   * children, and whether its component keeps its props, so that its box goes on a `div` around
   * it. An instance left out is taken to pass its props on and to lay its children out as a
   * block.
   */
  readonly instances?: Readonly<Record<string, InstanceDrawn>> | undefined;
  /** How the node's parent lays it out, which `fill` and `hug` are relative to. */
  readonly parent?: ParentLayout | undefined;
}

/** What writing every node of one call needs. */
interface Writing {
  /** The name each module's default export is imported as, unique in the file. */
  readonly defaultNames: ReadonlyMap<string, string>;
  readonly hrefOf: (link: string) => string;
  readonly instances: Readonly<Record<string, InstanceDrawn>>;
  readonly scale: Scale;
  /** The design system's styles, made once for every node. */
  readonly styles: Omit<StyleContext, "parent">;
}

// ---- Values as utilities ----

/** CSS in an arbitrary value: Tailwind reads an underscore as the canvas a class cannot hold. */
const arbitrary = (prefix: string, value: string) =>
  `${prefix}-[${value.trim().replace(WHITESPACE_RE, "_")}]`;

/**
 * A token as a utility. A token of the namespace the utility reads (`$color-primary` for `bg`)
 * is the utility Tailwind generates from it, `bg-primary`; one of another namespace is still
 * the variable, `bg-(--radius-lg)`.
 */
const fromToken = (
  prefix: string,
  token: string,
  namespaces: readonly string[]
) => {
  const name = tokenName(token);
  const namespace = namespaces.find((ns) => name.startsWith(`${ns}-`));
  return namespace === undefined
    ? `${prefix}-(--${name})`
    : `${prefix}-${name.slice(namespace.length + 1)}`;
};

interface Scale {
  /** Pixels of one spacing step, `--spacing`. */
  readonly step: number;
}

/**
 * A length on the spacing scale: a number is the step it lands on (16 over a 4px base is `4`)
 * and pixels only when it is off the scale, as the briefing asks of agents.
 */
const spacing = (prefix: string, value: Length, scale: Scale): string => {
  if (typeof value === "number") {
    const steps = value / scale.step;
    // Tailwind v4 takes any quarter of a step, but past the half steps its scale has always had
    // (`p-2.5`), a value reads as off the grid, which is what brackets say.
    return Number.isInteger(steps * 2)
      ? `${prefix}-${steps}`
      : arbitrary(prefix, `${value}px`);
  }
  const keyword = LENGTH_KEYWORDS[value.trim()];
  if (keyword !== undefined) {
    return `${prefix}-${keyword}`;
  }
  return isToken(value)
    ? fromToken(prefix, value, ["spacing", "container"])
    : arbitrary(prefix, value);
};

const color = (prefix: string, value: string): string => {
  const keyword = COLOR_KEYWORDS[value.trim()];
  if (keyword !== undefined) {
    return `${prefix}-${keyword}`;
  }
  return isToken(value)
    ? fromToken(prefix, value, ["color"])
    : arbitrary(prefix, value);
};

const radius = (value: Length): string => {
  if (typeof value === "number") {
    if (value === 0) {
      return "rounded-none";
    }
    return value >= 9999 ? "rounded-full" : arbitrary("rounded", `${value}px`);
  }
  return isToken(value)
    ? fromToken("rounded", value, ["radius"])
    : arbitrary("rounded", value);
};

const shadow = (value: string): string => {
  if (value.trim() === "none") {
    return "shadow-none";
  }
  return isToken(value)
    ? fromToken("shadow", value, ["shadow"])
    : arbitrary("shadow", value);
};

/** A spacing class that may go below zero, as a margin can: `-mt-2`. */
const signedSpacing = (prefix: string, value: Length, scale: Scale): string =>
  typeof value === "number" && value < 0
    ? `-${spacing(prefix, -value, scale)}`
    : spacing(prefix, value, scale);

/** Padding (`p`) or margin (`m`): one class for every side, one per axis, else one per side. */
const sidesClasses = (
  letter: "p" | "m",
  value: Padding,
  scale: Scale
): string[] => {
  const cls = (suffix: string, v: Length) =>
    signedSpacing(`${letter}${suffix}`, v, scale);
  if (typeof value === "number" || typeof value === "string") {
    return [cls("", value)];
  }
  const { bottom, left, right, top } = value;
  const out: string[] = [];
  if (top !== undefined && top === bottom && left === top && right === top) {
    return [cls("", top)];
  }
  if (left !== undefined && left === right) {
    out.push(cls("x", left));
  } else {
    if (left !== undefined) {
      out.push(cls("l", left));
    }
    if (right !== undefined) {
      out.push(cls("r", right));
    }
  }
  if (top !== undefined && top === bottom) {
    out.push(cls("y", top));
  } else {
    if (top !== undefined) {
      out.push(cls("t", top));
    }
    if (bottom !== undefined) {
      out.push(cls("b", bottom));
    }
  }
  return out;
};

/** One axis of a node's size, as `sizeStyle` in `css.ts` draws it. */
const sizeClasses = (
  axis: "w" | "h",
  size: Size | undefined,
  parent: ParentLayout,
  scale: Scale
): string[] => {
  if (size === undefined) {
    return [];
  }
  const main =
    (parent === "row" && axis === "w") || (parent === "column" && axis === "h");
  const flex = parent === "row" || parent === "column";
  if (typeof size === "number") {
    const fixed = spacing(axis, size, scale);
    return main ? [fixed, "shrink-0"] : [fixed];
  }
  if (size === "hug") {
    if (main) {
      return [`${axis}-fit`, "shrink-0"];
    }
    return flex ? [`${axis}-fit`, "self-start"] : [`${axis}-fit`];
  }
  if (main) {
    return ["flex-1", `min-${axis}-0`];
  }
  return flex ? ["self-stretch"] : [`${axis}-full`];
};

const borderClasses = (node: DesignNode): string[] => {
  const { border } = node;
  if (!border) {
    return [];
  }
  const out: string[] = [];
  const { width } = border;
  if (width === undefined || width === 1) {
    out.push("border");
  } else if (typeof width === "number") {
    // Tailwind has a utility for a whole number of pixels only.
    out.push(
      Number.isInteger(width) && width >= 0
        ? `border-${width}`
        : arbitrary("border", `${width}px`)
    );
  } else {
    out.push(
      isToken(width)
        ? `border-(length:--${tokenName(width)})`
        : arbitrary("border", width)
    );
  }
  if (border.style === "dashed" || border.style === "dotted") {
    out.push(`border-${border.style}`);
  }
  // Left out, Tailwind v4's border is the current colour, which is what the canvas draws.
  if (border.color !== undefined) {
    out.push(color("border", border.color));
  }
  return out;
};

// ---- Typography ----

const fontSize = (value: Length): string => {
  if (typeof value === "number") {
    return arbitrary("text", `${value}px`);
  }
  return isToken(value)
    ? fromToken("text", value, ["text"])
    : arbitrary("text", `length:${value}`);
};

const lineHeight = (value: Length, scale: Scale): string => {
  // A bare number below 4 is a multiple of the font size, as in CSS and in the canvas.
  if (typeof value === "number") {
    return value < 4
      ? arbitrary("leading", String(value))
      : spacing("leading", value, scale);
  }
  return isToken(value)
    ? fromToken("leading", value, ["leading"])
    : arbitrary("leading", value);
};

const fontWeight = (value: Length): string => {
  if (typeof value === "number") {
    const name = WEIGHTS[value];
    return name === undefined
      ? arbitrary("font", String(value))
      : `font-${name}`;
  }
  return isToken(value)
    ? fromToken("font", value, ["font-weight"])
    : arbitrary("font", value);
};

const fontFamily = (value: string): string =>
  isToken(value)
    ? fromToken("font", value, ["font"])
    : arbitrary("font", `family-name:${value}`);

const tracking = (value: Length): string => {
  if (typeof value === "number") {
    return arbitrary("tracking", `${value}px`);
  }
  return isToken(value)
    ? fromToken("tracking", value, ["tracking"])
    : arbitrary("tracking", value);
};

/** A text style's settings with the node's own over them, as the canvas sets the text. */
const textClasses = (
  node: TextNode,
  ctx: StyleContext,
  scale: Scale
): string[] => {
  const settings = typeSettingsOf(node, ctx);
  const out: string[] = [];
  if (settings.font !== undefined) {
    out.push(fontFamily(settings.font));
  }
  if (settings.size !== undefined) {
    out.push(fontSize(settings.size));
  }
  if (settings.weight !== undefined) {
    out.push(fontWeight(settings.weight));
  }
  if (settings.lineHeight !== undefined) {
    out.push(lineHeight(settings.lineHeight, scale));
  }
  if (settings.tracking !== undefined) {
    out.push(tracking(settings.tracking));
  }
  if (node.color !== undefined) {
    out.push(color("text", node.color));
  }
  if (node.align) {
    out.push(TEXT_ALIGN[node.align] ?? "text-left");
  }
  // The canvas keeps the line breaks typed into the text; the application has to ask for them.
  if (node.text.includes("\n")) {
    out.push("whitespace-pre-wrap");
  }
  return out;
};

// ---- Node classes ----

const layoutClasses = (node: DesignNode, scale: Scale): string[] => {
  if (node.type !== "page" && node.type !== "row" && node.type !== "column") {
    return [];
  }
  const out = node.type === "row" ? ["flex"] : ["flex", "flex-col"];
  if (node.type === "page" && node.minHeight === undefined) {
    out.push("min-h-screen");
  }
  if (node.wrap) {
    out.push("flex-wrap");
  }
  if (node.align) {
    out.push(JUSTIFY[node.align] ?? "justify-start");
  }
  if (node.crossAlign) {
    out.push(`items-${node.crossAlign}`);
  }
  if (node.gap !== undefined) {
    out.push(spacing("gap", node.gap, scale));
  }
  return out;
};

const boxClasses = (
  node: DesignNode,
  parent: ParentLayout,
  scale: Scale
): string[] => {
  const out = [
    ...sizeClasses("w", node.width, parent, scale),
    ...sizeClasses("h", node.height, parent, scale),
  ];
  if (node.minWidth !== undefined) {
    out.push(spacing("min-w", node.minWidth, scale));
  }
  if (node.maxWidth !== undefined) {
    out.push(spacing("max-w", node.maxWidth, scale));
  }
  if (node.minHeight !== undefined) {
    out.push(spacing("min-h", node.minHeight, scale));
  }
  if (node.maxHeight !== undefined) {
    out.push(spacing("max-h", node.maxHeight, scale));
  }
  if (node.padding !== undefined) {
    out.push(...sidesClasses("p", node.padding, scale));
  }
  if (node.margin !== undefined) {
    out.push(...sidesClasses("m", node.margin, scale));
  }
  return out;
};

const appearanceClasses = (node: DesignNode): string[] => {
  const out: string[] = [];
  if (node.fill !== undefined) {
    out.push(color("bg", node.fill));
  }
  out.push(...borderClasses(node));
  if (node.radius !== undefined) {
    out.push(radius(node.radius));
  }
  if (node.shadow !== undefined) {
    out.push(shadow(node.shadow));
  }
  if (node.opacity !== undefined) {
    out.push(`opacity-${Math.round(node.opacity * 100)}`);
  }
  if (node.type === "image") {
    out.push(`object-${node.fit ?? "cover"}`);
  }
  return out;
};

/** The utilities a node is written with, the design system's styles and scale made already. */
const classesWith = (
  node: DesignNode,
  styles: Omit<StyleContext, "parent">,
  scale: Scale,
  parent: ParentLayout
): string[] => {
  const classes = [
    ...layoutClasses(node, scale),
    ...boxClasses(node, parent, scale),
    ...(node.type === "text"
      ? textClasses(node, { ...styles, parent }, scale)
      : []),
    ...appearanceClasses(node),
  ];
  return [...new Set(classes)];
};

/** The utilities a node is written with: layout, size, spacing, type, then appearance. */
export const classesOf = (
  node: DesignNode,
  ds: DesignSystem | null | undefined,
  parent: ParentLayout = "free"
): string[] =>
  classesWith(node, makeStyleContext(ds), { step: spacingStep(ds) }, parent);

const spacingStep = (ds: DesignSystem | null | undefined) => {
  const step = toPixels(ds?.spacing.base ?? "0.25rem");
  return step && step > 0 ? step : 4;
};

// ---- Imports ----

/** `@acme/ui/date-picker` → `DatePicker`: what a default export is imported as. */
const defaultImportName = (from: string) => {
  const base = from.split("/").at(-1) ?? from;
  const words = base.match(WORD_RE) ?? ["Component"];
  const name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return IDENTIFIER_RE.test(name) ? name : `Component${name}`;
};

const tagOfInstance = (node: InstanceNode, w: Writing) =>
  node.component === "default"
    ? (w.defaultNames.get(node.from) ?? defaultImportName(node.from))
    : node.component;

/**
 * The imports the visible instances under a node need, one statement per module, and the name
 * each module's default export is imported as: two `…/button` modules are `Button` and `Button2`,
 * and neither takes the name of a component imported by name.
 */
const importsFor = (
  root: DesignNode
): { defaultNames: Map<string, string>; lines: string[] } => {
  const modules = new Map<string, { named: Set<string>; fallback: boolean }>();
  const visit = (node: DesignNode) => {
    if (node.hidden) {
      return;
    }
    if (node.type === "instance") {
      const entry = modules.get(node.from) ?? {
        fallback: false,
        named: new Set<string>(),
      };
      if (node.component === "default") {
        entry.fallback = true;
      } else {
        entry.named.add(node.component);
      }
      modules.set(node.from, entry);
    }
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(root);
  const sorted = [...modules.entries()].sort(([a], [b]) => a.localeCompare(b));
  const taken = new Set(sorted.flatMap(([, { named }]) => [...named]));
  const defaultNames = new Map<string, string>();
  for (const [from, { fallback }] of sorted) {
    if (fallback) {
      const base = defaultImportName(from);
      let name = base;
      for (let n = 2; taken.has(name); n += 1) {
        name = `${base}${n}`;
      }
      taken.add(name);
      defaultNames.set(from, name);
    }
  }
  const lines = sorted.map(([from, { named }]) => {
    const names = [...named].sort((a, b) => a.localeCompare(b));
    const fallback = defaultNames.get(from);
    const parts = [
      ...(fallback ? [fallback] : []),
      ...(names.length > 0 ? [`{ ${names.join(", ")} }`] : []),
    ];
    return `import ${parts.join(", ")} from ${JSON.stringify(from)};`;
  });
  return { defaultNames, lines };
};

// ---- JSX ----

type Child =
  | { readonly kind: "element"; readonly element: Element }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "comment"; readonly text: string };

interface Element {
  readonly attributes: readonly string[];
  readonly children: readonly Child[];
  readonly tag: string;
}

const element = (
  tag: string,
  attributes: readonly string[],
  children: readonly Child[] = []
): Child => ({ element: { attributes, children, tag }, kind: "element" });

/** Text as a JSX child: as it is, or as a string expression when JSX would read it otherwise. */
const jsxText = (text: string) =>
  JSX_UNSAFE_RE.test(text) || ENTITY_RE.test(text)
    ? `{${JSON.stringify(text)}}`
    : text;

/** An attribute's string: quoted, or an expression when JSX would read an entity or a quote. */
const stringAttribute = (name: string, value: string) =>
  value.includes('"') || value.includes("\\") || ENTITY_RE.test(value)
    ? `${name}={${JSON.stringify(value)}}`
    : `${name}="${value}"`;

const propAttribute = (name: string, value: JsonValue): string => {
  if (typeof value === "string") {
    return stringAttribute(name, value);
  }
  if (value === true) {
    return name;
  }
  return `${name}={${JSON.stringify(value)}}`;
};

const classAttribute = (classes: readonly string[]) =>
  classes.length > 0 ? [stringAttribute("className", classes.join(" "))] : [];

/** An instance's props as attributes; names JSX cannot hold go in a spread. */
const propAttributes = (
  props: InstanceNode["props"],
  classes: readonly string[]
): string[] => {
  const out: string[] = [];
  const spread: Record<string, JsonValue> = {};
  let className = classes.join(" ");
  for (const [name, value] of Object.entries(props ?? {})) {
    if (name === "children") {
      continue;
    }
    if (name === "className" && typeof value === "string") {
      className = [value, className].filter(Boolean).join(" ");
    } else if (ATTRIBUTE_NAME_RE.test(name)) {
      out.push(propAttribute(name, value));
    } else {
      spread[name] = value;
    }
  }
  if (Object.keys(spread).length > 0) {
    out.push(`{...${JSON.stringify(spread)}}`);
  }
  if (className) {
    out.push(stringAttribute("className", className));
  }
  return out;
};

/** How a node lays out its children: an instance as the preview saw its component do it. */
const childLayoutOf = (node: DesignNode, w: Writing): ParentLayout =>
  node.type === "instance"
    ? (w.instances[node.id]?.layout ?? "block")
    : layoutOf(node);

const childrenFor = (node: DesignNode, w: Writing): Child[] => {
  const parent = childLayoutOf(node, w);
  return childrenOf(node).map((child) => childFor(child, w, parent));
};

/** A node below the one written: hidden ones are left out, and say so. */
const childFor = (node: DesignNode, w: Writing, parent: ParentLayout): Child =>
  node.hidden
    ? { kind: "comment", text: `Hidden: ${nodeLabel(node)}` }
    : jsxOf(node, w, parent);

/** A link is a plain anchor here: in the application it is its router's own link. */
const linked = (node: DesignNode, w: Writing, child: Child): Child =>
  node.link
    ? element("a", [stringAttribute("href", w.hrefOf(node.link))], [child])
    : child;

const jsxOf = (node: DesignNode, w: Writing, parent: ParentLayout): Child => {
  const classes = classesWith(node, w.styles, w.scale, parent);
  switch (node.type) {
    case "text":
      return linked(
        node,
        w,
        element(tagOf(node), classAttribute(classes), [
          { kind: "text", text: jsxText(node.text) },
        ])
      );
    case "image":
      return linked(
        node,
        w,
        element("img", [
          stringAttribute("alt", node.alt ?? ""),
          ...classAttribute(classes),
          stringAttribute("src", node.src),
        ])
      );
    case "instance": {
      const children = childrenOf(node);
      let content: Child[] = [];
      if (children.length > 0) {
        content = childrenFor(node, w);
      } else if (node.text) {
        content = [{ kind: "text", text: jsxText(node.text) }];
      }
      // A component that keeps its props to itself cannot take the classes: they go on a div
      // around it, which stretches it across, as the canvas draws it.
      if (w.instances[node.id]?.wrapped && classes.length > 0) {
        return linked(
          node,
          w,
          element("div", classAttribute(["flex", "flex-col", ...classes]), [
            element(
              tagOfInstance(node, w),
              propAttributes(node.props, []),
              content
            ),
          ])
        );
      }
      return linked(
        node,
        w,
        element(
          tagOfInstance(node, w),
          propAttributes(node.props, classes),
          content
        )
      );
    }
    default: {
      // A container that is a link is the anchor itself, so it keeps its place in the layout.
      const attributes = node.link
        ? [
            stringAttribute("href", w.hrefOf(node.link)),
            ...classAttribute(classes),
          ]
        : classAttribute(classes);
      return element(node.link ? "a" : "div", attributes, childrenFor(node, w));
    }
  }
};

const printChild = (child: Child, depth: number): string[] => {
  const pad = INDENT.repeat(depth);
  if (child.kind === "text") {
    return [`${pad}${child.text}`];
  }
  if (child.kind === "comment") {
    return [`${pad}{/* ${child.text.replaceAll("*/", "* /")} */}`];
  }
  const { attributes, children, tag } = child.element;
  const inline = attributes.map((a) => ` ${a}`).join("");
  const fits = pad.length + tag.length + inline.length + 3 <= LINE_WIDTH;
  const opening =
    fits || attributes.length === 0
      ? [`${pad}<${tag}${inline}`]
      : [`${pad}<${tag}`, ...attributes.map((a) => `${pad}${INDENT}${a}`), pad];
  const last = opening.length - 1;
  const head = opening.slice(0, last);
  const tail = opening[last] ?? pad;
  const glue = tail === pad ? "" : " ";
  if (children.length === 0) {
    return [...head, `${tail}${glue}/>`];
  }
  const [only] = children;
  if (fits && children.length === 1 && only?.kind === "text") {
    const line = `${tail}>${only.text}</${tag}>`;
    if (line.length <= LINE_WIDTH) {
      return [line];
    }
  }
  return [
    ...head,
    `${tail}>`,
    ...children.flatMap((c) => printChild(c, depth + 1)),
    `${pad}</${tag}>`,
  ];
};

/** `/settings/billing` → `SettingsBillingPage`, `/` → `HomePage`. */
export const pageComponentName = (route: string): string => {
  const words = route.match(WORD_RE) ?? [];
  const name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  if (name === "") {
    return "HomePage";
  }
  return IDENTIFIER_RE.test(name) ? `${name}Page` : `Page${name}`;
};

/**
 * The code a node stands for, with everything under it: the imports its instances need, then
 * its markup. A page given a component name is written as that component.
 */
export const toCode = (
  node: DesignNode,
  ds: DesignSystem | null | undefined,
  options: CodeOptions = {}
): string => {
  const parent = options.parent ?? "free";
  const { defaultNames, lines: imports } = importsFor(
    node.hidden ? { ...node, hidden: false } : node
  );
  const notes = node.hidden
    ? ["// Hidden in the design: the application leaves it out."]
    : [];
  const asComponent = node.type === "page" && options.component !== undefined;
  const writing: Writing = {
    defaultNames,
    hrefOf: options.hrefOf ?? ((link: string) => link),
    instances: options.instances ?? {},
    scale: { step: spacingStep(ds) },
    styles: makeStyleContext(ds),
  };
  const markup = printChild(jsxOf(node, writing, parent), asComponent ? 2 : 0);
  const body = asComponent
    ? [
        `export default function ${options.component}() {`,
        `${INDENT}return (`,
        ...markup,
        `${INDENT});`,
        "}",
      ]
    : markup;
  const head = [...imports, ...(imports.length > 0 ? [""] : []), ...notes];
  return [...head, ...body].join("\n");
};
