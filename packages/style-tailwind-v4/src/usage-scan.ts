/**
 * What the application's code uses, value by value, for the design-system setup (ADR 0023): the
 * colours, spacing, type sizes and weights, radii, shadows and layers of its Tailwind classes,
 * inline styles and stylesheets, and the plain elements it writes where the library has a
 * component. Read by fixed rules and synchronous: the server lists and reads the files.
 *
 * Classes are found as Tailwind finds them, in every string of a file, so `cn()`, `cva()` and
 * constants count as well as `className`. Whether a value is the design system's is decided
 * afterwards, in `summarise`, against the design system the setup holds.
 */
import { parse } from "@babel/parser";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  UsageInventory,
  UsageKind,
  UsageLocation,
  UsageStatus,
  UsageTotals,
  UsageValue,
} from "@ultrapaint/contracts/design-system-setup";
import { USAGE_KINDS } from "@ultrapaint/contracts/design-system-setup";
import type {
  UsageContext,
  UsageOccurrence,
  UsageReader,
} from "@ultrapaint/framework-api/node";
import { parseStylesheet } from "./stylesheet.ts";

const SOURCE_RE = /\.(tsx|jsx|ts|js|mjs|css)$/;
const SKIPPED_FILE_RE =
  /\.(test|spec|stories|story|config|d)\.[cm]?[jt]sx?$|\.min\.(js|css)$/;
const SKIPPED_DIR_RE =
  /(^|\/)(node_modules|dist|build|out|coverage|public|vendor|storybook-static|__tests__|__mocks__|\.[^/]+)\//;
const WORD_RE = /\S+/g;
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const HEX_IN_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const FUNCTION_COLOR_RE =
  /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^()]*\)/gi;
const WHOLE_VAR_RE = /^var\(\s*--([\w-]+)\s*(?:,[^)]*)?\)$/;
const VAR_ALL_RE = /var\(\s*--([\w-]+)/g;
const PALETTE_RE = /^[a-z]+-\d{2,3}$/;
const STEP_RE = /^(\d+(\.\d+)?|px)$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const LENGTH_RE = /^-?\d*\.?\d+(px|rem|em)$/;
const LENGTH_IN_RE = /-?\d*\.?\d+(px|rem|em)\b/g;
const TYPE_HINT_RE = /^([a-z-]+):(.+)$/;
const UNDERSCORE_RE = /_/g;
const SPACES_RE = /\s+/g;
const DASHED_RE = /-([a-z])/g;

/** Tailwind's own scales, which a design system has unless it says otherwise. */
const DEFAULT_SIZES = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
]);
const DEFAULT_WEIGHTS = new Set([
  "thin",
  "extralight",
  "light",
  "normal",
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
]);
const DEFAULT_RADII = new Set([
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
]);
const DEFAULT_SHADOWS = new Set(["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]);
const DEFAULT_LAYERS = new Set(["0", "10", "20", "30", "40", "50"]);
/** Colours that are not a decision: nothing to put on the design system. */
const NO_COLOR = new Set(["transparent", "current", "inherit", "none"]);
const NAMED_COLORS = new Set([
  "aqua",
  "black",
  "blue",
  "brown",
  "coral",
  "crimson",
  "cyan",
  "fuchsia",
  "gold",
  "gray",
  "green",
  "grey",
  "indigo",
  "khaki",
  "lime",
  "magenta",
  "maroon",
  "navy",
  "olive",
  "orange",
  "pink",
  "purple",
  "red",
  "salmon",
  "silver",
  "teal",
  "tomato",
  "violet",
  "white",
  "yellow",
]);

/** The utilities read, longest first so `gap-x` wins over `gap`. */
const COLOR_UTILITIES = [
  "ring-offset",
  "inset-shadow",
  "drop-shadow",
  "decoration",
  "placeholder",
  "outline",
  "divide",
  "accent",
  "border-x",
  "border-y",
  "border-t",
  "border-r",
  "border-b",
  "border-l",
  "border-s",
  "border-e",
  "border",
  "shadow",
  "stroke",
  "caret",
  "fill",
  "from",
  "ring",
  "text",
  "via",
  "bg",
  "to",
];
const SPACING_UTILITIES = [
  "space-x",
  "space-y",
  "inset-x",
  "inset-y",
  "bottom",
  "gap-x",
  "gap-y",
  "inset",
  "right",
  "left",
  "top",
  "gap",
  "px",
  "py",
  "pt",
  "pr",
  "pb",
  "pl",
  "ps",
  "pe",
  "mx",
  "my",
  "mt",
  "mr",
  "mb",
  "ml",
  "ms",
  "me",
  "p",
  "m",
];
const RADIUS_UTILITIES = [
  "rounded-tl",
  "rounded-tr",
  "rounded-br",
  "rounded-bl",
  "rounded-ss",
  "rounded-se",
  "rounded-es",
  "rounded-ee",
  "rounded-t",
  "rounded-r",
  "rounded-b",
  "rounded-l",
  "rounded-s",
  "rounded-e",
  "rounded",
];
const UTILITIES = [
  ...new Set([
    ...COLOR_UTILITIES,
    ...SPACING_UTILITIES,
    ...RADIUS_UTILITIES,
    "font",
    "z",
  ]),
].sort((a, b) => b.length - a.length);
const COLOR_SET = new Set(COLOR_UTILITIES);
const SPACING_SET = new Set(SPACING_UTILITIES);
const RADIUS_SET = new Set(RADIUS_UTILITIES);

const STYLE_COLOR = new Set([
  "background",
  "backgroundColor",
  "borderBottomColor",
  "borderColor",
  "borderLeftColor",
  "borderRightColor",
  "borderTopColor",
  "caretColor",
  "color",
  "fill",
  "outlineColor",
  "stroke",
  "textDecorationColor",
]);
const STYLE_SPACING = new Set([
  "bottom",
  "columnGap",
  "gap",
  "inset",
  "left",
  "margin",
  "marginBlock",
  "marginBottom",
  "marginInline",
  "marginLeft",
  "marginRight",
  "marginTop",
  "padding",
  "paddingBlock",
  "paddingBottom",
  "paddingInline",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "right",
  "rowGap",
  "top",
]);
const STYLE_KIND: Record<string, UsageKind> = {
  borderRadius: "radius",
  boxShadow: "shadow",
  fontSize: "fontSize",
  fontWeight: "fontWeight",
  zIndex: "zIndex",
};

/** Plain elements, and the components a library has for them. */
const ELEMENT_COMPONENTS: Record<string, readonly string[]> = {
  button: ["Button"],
  dialog: ["Dialog"],
  hr: ["Separator"],
  input: ["Input"],
  "input:checkbox": ["Checkbox"],
  "input:radio": ["RadioGroup", "Radio"],
  "input:range": ["Slider"],
  label: ["Label"],
  progress: ["Progress"],
  select: ["Select", "NativeSelect"],
  table: ["Table"],
  textarea: ["Textarea"],
};

const includes = (file: string) =>
  SOURCE_RE.test(file) &&
  !SKIPPED_FILE_RE.test(file) &&
  !SKIPPED_DIR_RE.test(`/${file}`);

/** `#ABC` → `#aabbcc`; functional colours lower-cased with single spaces. */
const normaliseColor = (value: string) => {
  const v = value.trim().toLowerCase();
  if (HEX_RE.test(v) && (v.length === 4 || v.length === 5)) {
    return `#${[...v.slice(1)].map((c) => c + c).join("")}`;
  }
  return v.replace(SPACES_RE, " ");
};

const isColorLiteral = (value: string) => {
  const v = value.trim().toLowerCase();
  if (HEX_RE.test(v) || NAMED_COLORS.has(v)) {
    return true;
  }
  FUNCTION_COLOR_RE.lastIndex = 0;
  const match: RegExpExecArray | null = FUNCTION_COLOR_RE.exec(v);
  return match?.[0] === v;
};

/** How deep in brackets and parentheses each character of a class is. */
const depthChange = (c: string | undefined) => {
  if (c === "[" || c === "(") {
    return 1;
  }
  return c === "]" || c === ")" ? -1 : 0;
};

/** Where `separator` last (or first) stands outside brackets and parentheses; -1 when nowhere. */
const outside = (text: string, separator: string, last: boolean) => {
  let depth = 0;
  let found = -1;
  for (let i = 0; i < text.length; i += 1) {
    depth += depthChange(text[i]);
    if (text[i] === separator && depth === 0) {
      found = i;
      if (!last) {
        return found;
      }
    }
  }
  return found;
};

/** Where the variants of a class end: the last `:` outside brackets and parentheses. */
const baseOf = (candidate: string) =>
  candidate.slice(outside(candidate, ":", true) + 1);

/** `blue-500/50` → `blue-500`: the opacity modifier, outside brackets. */
const withoutModifier = (value: string) => {
  const at = outside(value, "/", false);
  return at === -1 ? value : value.slice(0, at);
};

/** A class taken apart: what is around the utility, the utility, and its value. */
export interface ClassParts {
  /** `!` written before the utility, or after it. */
  readonly important: "" | "before" | "after";
  /** A colour's opacity, `/50`, kept when the value changes. */
  readonly modifier: string;
  readonly negative: boolean;
  readonly use: string;
  readonly value: string;
  /** `hover:md:`, ending in its colon. */
  readonly variants: string;
}

/** A class taken apart; null for anything this does not look at. */
export const splitClass = (candidate: string): ClassParts | null => {
  const variants = candidate.slice(0, outside(candidate, ":", true) + 1);
  let base = baseOf(candidate);
  let important: ClassParts["important"] = "";
  if (base.startsWith("!")) {
    base = base.slice(1);
    important = "before";
  }
  if (base.endsWith("!")) {
    base = base.slice(0, -1);
    important = "after";
  }
  const negative = base.startsWith("-");
  if (negative) {
    base = base.slice(1);
  }
  const parts = { important, negative, variants };
  for (const use of UTILITIES) {
    if (base === use && (use === "rounded" || use === "shadow")) {
      return { ...parts, modifier: "", use, value: "" };
    }
    if (base.startsWith(`${use}-`)) {
      const rest = base.slice(use.length + 1);
      // `/50` is a colour's opacity; on `left-1/2` it is the value.
      const value = COLOR_SET.has(use) ? withoutModifier(rest) : rest;
      return value
        ? { ...parts, modifier: rest.slice(value.length), use, value }
        : null;
    }
  }
  return null;
};

/** A class, read as a utility and its value; null for anything this does not look at. */
export const readClass = (
  candidate: string
): { readonly use: string; readonly value: string } | null => {
  const parts = splitClass(candidate);
  return parts ? { use: parts.use, value: parts.value } : null;
};

/** The line of each offset of a text, found by halving the list of where its lines start. */
const lineIndex = (text: string) => {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    starts.push(i + 1);
  }
  return (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((starts[mid] ?? 0) <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low + 1;
  };
};

/** Where a piece of a string is in the file, when the string is written there as it reads. */
const spanIn = (base: number | null, index: number, length: number) =>
  base === null ? {} : { end: base + index + length, start: base + index };

/**
 * The classes and colour literals of one string of a source file. `base` is where the string's
 * text starts in the file, or null when it is not written there as it reads (an escape).
 */
const fromString = (
  value: string,
  line: number,
  out: UsageOccurrence[],
  base: number | null = null
) => {
  // A colour on its own, `rgb(0 0 0 / 50%)` included; inside a class it is the class's.
  const whole = value.trim();
  if (whole.includes("(") && isColorLiteral(whole)) {
    out.push({
      line,
      raw: whole,
      use: "literal",
      value: whole,
      ...spanIn(base, value.indexOf(whole), whole.length),
    });
    return;
  }
  for (const match of value.matchAll(WORD_RE)) {
    const [word] = match;
    const where = spanIn(base, match.index, word.length);
    if (HEX_RE.test(word) || (word.includes("(") && isColorLiteral(word))) {
      out.push({ line, raw: word, use: "literal", value: word, ...where });
      continue;
    }
    const read = readClass(word);
    if (read) {
      out.push({ line, raw: word, ...read, ...where });
    }
  }
};

interface AstNode {
  readonly loc?: { readonly start: { readonly line: number } };
  readonly type: string;
  readonly [key: string]: unknown;
}

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

/** Type annotations hold strings that are types, not classes; imports hold module names. */
const SKIPPED_NODES = new Set([
  "ExportAllDeclaration",
  "ImportDeclaration",
  "TSEnumDeclaration",
  "TSInterfaceDeclaration",
  "TSLiteralType",
  "TSTypeAliasDeclaration",
  "TSTypeAnnotation",
]);
const SKIPPED_KEYS = new Set([
  "innerComments",
  "leadingComments",
  "loc",
  "trailingComments",
]);

const childrenOf = (node: AstNode): AstNode[] => {
  const out: AstNode[] = [];
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          out.push(item);
        }
      }
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
};

const lineOf = (node: AstNode) => node.loc?.start.line ?? 0;

/** Where a node is in the file. */
const spanOf = (node: AstNode) =>
  typeof node.start === "number" && typeof node.end === "number"
    ? { end: node.end, start: node.start }
    : {};

/** Where a string's text starts in the file, when it is written there as it reads. */
const textStart = (
  node: AstNode,
  text: string,
  value: string,
  quoted: boolean
): number | null => {
  if (typeof node.start !== "number" || typeof node.end !== "number") {
    return null;
  }
  const from = quoted ? node.start + 1 : node.start;
  const to = quoted ? node.end - 1 : node.end;
  return text.slice(from, to) === value ? from : null;
};

const nameOf = (node: unknown): string | null => {
  if (!isNode(node)) {
    return null;
  }
  if (node.type === "Identifier" || node.type === "JSXIdentifier") {
    return node.name as string;
  }
  if (node.type === "StringLiteral") {
    return node.value as string;
  }
  return null;
};

/** A style property's value when it is written out: a string, a number, `-16` included. */
const styleValueOf = (value: AstNode): string | null => {
  if (value.type === "StringLiteral") {
    return value.value as string;
  }
  if (value.type === "NumericLiteral") {
    return String(value.value);
  }
  const { argument } = value;
  return value.type === "UnaryExpression" &&
    value.operator === "-" &&
    isNode(argument) &&
    argument.type === "NumericLiteral"
    ? `-${String(argument.value)}`
    : null;
};

/** A JSX `style={{ … }}`: each property with a value written out. */
const fromStyle = (object: AstNode, out: UsageOccurrence[]) => {
  for (const property of (object.properties as unknown[] | undefined) ?? []) {
    if (!isNode(property) || property.type !== "ObjectProperty") {
      continue;
    }
    const key = nameOf(property.key);
    const { value } = property;
    if (!(key && isNode(value))) {
      continue;
    }
    const written = styleValueOf(value);
    if (written === null) {
      continue;
    }
    out.push({
      line: lineOf(property),
      raw: `style ${key}: ${written}`,
      use: `style:${key}`,
      value: written,
      ...spanOf(value),
      ...(value.type !== "StringLiteral" && { numeric: true }),
    });
  }
};

/** `<input type="checkbox">` is `input:checkbox`. */
const elementOf = (opening: AstNode): string | null => {
  const name = nameOf(opening.name);
  if (!name || name !== name.toLowerCase()) {
    return null;
  }
  if (name !== "input") {
    return name in ELEMENT_COMPONENTS ? name : null;
  }
  for (const attribute of (opening.attributes as unknown[] | undefined) ?? []) {
    if (
      isNode(attribute) &&
      attribute.type === "JSXAttribute" &&
      nameOf(attribute.name) === "type" &&
      isNode(attribute.value) &&
      attribute.value.type === "StringLiteral"
    ) {
      const type = `input:${attribute.value.value as string}`;
      return type in ELEMENT_COMPONENTS ? type : "input";
    }
  }
  return "input";
};

/** The object of a JSX `style={{ … }}` attribute. */
const styleObjectOf = (node: AstNode): AstNode | null => {
  if (node.type !== "JSXAttribute" || nameOf(node.name) !== "style") {
    return null;
  }
  const container = node.value;
  if (!isNode(container) || container.type !== "JSXExpressionContainer") {
    return null;
  }
  const { expression } = container;
  return isNode(expression) && expression.type === "ObjectExpression"
    ? expression
    : null;
};

/** The strings and plain elements of one node, its children aside. */
const fromNode = (node: AstNode, text: string, out: UsageOccurrence[]) => {
  if (node.type === "StringLiteral") {
    const value = node.value as string;
    fromString(value, lineOf(node), out, textStart(node, text, value, true));
  } else if (node.type === "TemplateElement") {
    const quasi = node.value as { cooked?: string | null; raw: string };
    const value = quasi.cooked ?? quasi.raw;
    fromString(value, lineOf(node), out, textStart(node, text, value, false));
  } else if (node.type === "JSXOpeningElement") {
    const element = elementOf(node);
    if (element) {
      const [tag, type] = element.split(":");
      out.push({
        line: lineOf(node),
        raw: type ? `<${tag} type="${type}">` : `<${tag}>`,
        use: "element",
        value: element,
      });
    }
  }
};

const fromScript = (text: string): UsageOccurrence[] => {
  let ast: unknown;
  try {
    ast = parse(text, {
      errorRecovery: true,
      plugins: ["jsx", "typescript"],
      sourceType: "module",
    });
  } catch {
    // A file Babel cannot read at all uses nothing this can tell.
    return [];
  }
  const out: UsageOccurrence[] = [];
  const visit = (node: AstNode) => {
    if (SKIPPED_NODES.has(node.type)) {
      return;
    }
    const style = styleObjectOf(node);
    if (style) {
      fromStyle(style, out);
      return;
    }
    fromNode(node, text, out);
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  if (isNode(ast)) {
    visit(ast);
  }
  return out;
};

/**
 * A stylesheet's declarations and `@apply`, outside the `@theme` blocks, and not the custom
 * properties: those define the design system rather than use it.
 */
const fromStylesheet = (text: string): UsageOccurrence[] => {
  const parsed = parseStylesheet("", text);
  const lineAt = lineIndex(text);
  const out: UsageOccurrence[] = [];
  for (const statement of parsed.statements) {
    if (statement.name === "apply" && !statement.prelude.includes("@theme")) {
      fromString(
        statement.params,
        lineAt(statement.paramsStart),
        out,
        statement.paramsStart
      );
    }
  }
  for (const decl of parsed.declarations) {
    if (
      decl.name.startsWith("--") ||
      decl.prelude.includes("@theme") ||
      decl.value.startsWith("@")
    ) {
      continue;
    }
    out.push({
      end: decl.valueEnd,
      line: lineAt(decl.declStart),
      raw: `${decl.name}: ${decl.value}`,
      start: decl.valueStart,
      use: `css:${decl.name}`,
      value: decl.value,
    });
  }
  return out;
};

const scanFile = (file: string, text: string): readonly UsageOccurrence[] =>
  file.endsWith(".css") ? fromStylesheet(text) : fromScript(text);

/** A use held against the design system: what kind of value it is, and whose. */
export interface Classified {
  readonly kind: UsageKind;
  /** In a style or a declaration, the value as it is written there. */
  readonly literal?: string;
  readonly status: UsageStatus;
  readonly token?: string;
  readonly value: string;
}

export interface Known {
  /** Each colour value, normalised, and the first colour token that has it. */
  readonly colorByValue: Map<string, string>;
  readonly colors: Set<string>;
  readonly layers: Set<string>;
  readonly radii: Set<string>;
  readonly shadows: Set<string>;
  readonly sizes: Set<string>;
  readonly spacing: Set<string>;
  readonly weights: Set<string>;
}

export const knownOf = (
  ds: DesignSystem,
  own: readonly string[] | null
): Known => {
  // Before a design system is saved, the theme's scan stands in for it, Tailwind's defaults
  // included; only what the repository declares itself counts as its own then.
  const mine = own ? new Set(own) : null;
  const keep = (name: string) => mine === null || mine.has(name);
  const names = (tokens: readonly { readonly name: string }[] | undefined) =>
    new Set((tokens ?? []).map((t) => t.name).filter(keep));
  const colorTokens = new Map<string, string>();
  for (const group of ds.colors) {
    for (const token of group.tokens) {
      if (keep(token.name)) {
        colorTokens.set(token.name, token.value);
      }
    }
  }
  const colorByValue = new Map<string, string>();
  for (const [name, value] of colorTokens) {
    const normalised = normaliseColor(value);
    if (!colorByValue.has(normalised)) {
      colorByValue.set(normalised, name);
    }
  }
  return {
    colorByValue,
    colors: new Set(colorTokens.keys()),
    layers: new Set(
      (ds.elevation ?? []).flatMap((level) =>
        level.layer === undefined ? [] : [String(level.layer)]
      )
    ),
    radii: names(ds.radius),
    shadows: names(ds.shadows),
    sizes: names(ds.typography.sizes),
    spacing: names(ds.spacing.tokens),
    weights: names(ds.typography.weights),
  };
};

const rawColor = (known: Known, literal: string): Classified => {
  const value = normaliseColor(literal);
  // The colour token whose value is exactly this literal.
  const token = known.colorByValue.get(value);
  return {
    kind: "color",
    literal: literal.trim(),
    status: "raw",
    value,
    ...(token !== undefined && { token }),
  };
};

/** The namespace of a kind's tokens: `var(--primary)` is `color-primary` when that exists. */
const NAMESPACE: Partial<Record<UsageKind, string>> = {
  color: "color",
  fontSize: "text",
  fontWeight: "font-weight",
  radius: "radius",
  shadow: "shadow",
  spacing: "spacing",
};

/**
 * `var(--color-primary)` as the token it names. A custom property the design system has no token
 * for (`--card-spacing`) passes a value on from elsewhere, where it is counted: null.
 */
const fromVar = (
  kind: UsageKind,
  name: string,
  known: Set<string>
): Classified | null => {
  const namespaced = `${NAMESPACE[kind] ?? ""}-${name}`;
  const token = [name, namespaced].find((n) => known.has(n));
  return token ? { kind, status: "system", token, value: token } : null;
};

/** The custom property an arbitrary value is, when it is nothing but `var(--name)`. */
const wholeVar = (inside: string) => {
  const match: RegExpExecArray | null = WHOLE_VAR_RE.exec(inside);
  return match?.[1] ?? null;
};

/** `calc(…)`, `var(--a) * 2`, `--spacing(3)`: worked out, not written out. */
const isComputed = (inside: string) =>
  inside.includes("var(") || inside.includes("calc(") || inside.includes("--");

/** `[…]` of an arbitrary class: its inside with underscores as spaces, and its type hint. */
const arbitrary = (value: string) => {
  if (!(value.startsWith("[") && value.endsWith("]"))) {
    if (value.startsWith("(") && value.endsWith(")")) {
      return { hint: "", inside: `var(${value.slice(1, -1)})` };
    }
    return null;
  }
  const inside = value.slice(1, -1).replace(UNDERSCORE_RE, " ").trim();
  const hinted: RegExpExecArray | null = TYPE_HINT_RE.exec(inside);
  if (hinted && !inside.startsWith("var(") && !HEX_RE.test(inside)) {
    return { hint: hinted[1] ?? "", inside: hinted[2] ?? "" };
  }
  return { hint: "", inside };
};

const classifyColor = (value: string, known: Known): Classified | null => {
  const free = arbitrary(value);
  if (free) {
    if (free.hint && free.hint !== "color") {
      return null;
    }
    const named = wholeVar(free.inside);
    if (named) {
      return fromVar("color", named, known.colors);
    }
    return isColorLiteral(free.inside) ? rawColor(known, free.inside) : null;
  }
  if (NO_COLOR.has(value)) {
    return null;
  }
  const token = `color-${value}`;
  if (known.colors.has(token)) {
    return { kind: "color", status: "system", token, value: token };
  }
  if (PALETTE_RE.test(value) || value === "black" || value === "white") {
    return { kind: "color", status: "default", token, value: token };
  }
  return null;
};

/** A length off the scale, `13px`; null when it is not one. */
const rawLength = (kind: UsageKind, inside: string): Classified | null =>
  LENGTH_RE.test(inside) || NUMBER_RE.test(inside)
    ? { kind, status: "raw", value: inside }
    : null;

const classifyScale = (
  kind: UsageKind,
  value: string,
  prefix: string,
  known: Set<string>,
  defaults: Set<string>
): Classified | null => {
  const free = arbitrary(value);
  if (free) {
    const named = wholeVar(free.inside);
    if (named) {
      return fromVar(kind, named, known);
    }
    if (kind === "shadow") {
      return free.inside === "none"
        ? null
        : { kind, status: "raw", value: free.inside };
    }
    return rawLength(kind, free.inside);
  }
  const token = prefix ? `${prefix}-${value}` : prefix;
  if (known.has(token)) {
    return { kind, status: "system", token, value: token };
  }
  return defaults.has(value)
    ? { kind, status: "default", token, value: token }
    : null;
};

const classifyShadow = (value: string, known: Known): Classified | null => {
  if (value === "") {
    return { kind: "shadow", status: "default", value: "shadow" };
  }
  return value === "none" || value === "inner"
    ? null
    : classifyScale("shadow", value, "shadow", known.shadows, DEFAULT_SHADOWS);
};

const classifyRadius = (value: string, known: Known): Classified | null => {
  if (value === "none" || value === "full") {
    return null;
  }
  if (value === "") {
    return { kind: "radius", status: "default", value: "radius" };
  }
  return classifyScale("radius", value, "radius", known.radii, DEFAULT_RADII);
};

const classifySpacing = (value: string, known: Known): Classified | null => {
  if (STEP_RE.test(value)) {
    // Every multiple of the base is on the scale: `p-4` is four steps of `--spacing`.
    return value === "0"
      ? null
      : { kind: "spacing", status: "system", value: `spacing ${value}` };
  }
  const free = arbitrary(value);
  if (free) {
    const named = wholeVar(free.inside);
    if (named) {
      return fromVar("spacing", named, known.spacing);
    }
    return isComputed(free.inside) ? null : rawLength("spacing", free.inside);
  }
  const token = `spacing-${value}`;
  return known.spacing.has(token)
    ? { kind: "spacing", status: "system", token, value: token }
    : null;
};

const classifyLayer = (value: string, known: Known): Classified | null => {
  const free = arbitrary(value);
  if (free) {
    return NUMBER_RE.test(free.inside)
      ? { kind: "zIndex", status: "raw", value: free.inside }
      : null;
  }
  if (known.layers.has(value)) {
    return { kind: "zIndex", status: "system", value };
  }
  return DEFAULT_LAYERS.has(value)
    ? { kind: "zIndex", status: "default", value }
    : null;
};

/** What a utility's value is once it is not a colour: by the utility, the first that says. */
const classifyOther = (
  use: string,
  value: string,
  known: Known
): Classified | null => {
  if (use === "text") {
    return classifyScale("fontSize", value, "text", known.sizes, DEFAULT_SIZES);
  }
  if (use === "shadow") {
    return classifyShadow(value, known);
  }
  if (use === "font") {
    return classifyScale(
      "fontWeight",
      value,
      "font-weight",
      known.weights,
      DEFAULT_WEIGHTS
    );
  }
  if (RADIUS_SET.has(use)) {
    return classifyRadius(value, known);
  }
  if (SPACING_SET.has(use)) {
    return classifySpacing(value, known);
  }
  return use === "z" ? classifyLayer(value, known) : null;
};

const classifyClass = (
  use: string,
  value: string,
  known: Known
): Classified | null =>
  (COLOR_SET.has(use) ? classifyColor(value, known) : null) ??
  classifyOther(use, value, known);

/** The tokens of a kind, which a `var()` in a declaration may name. */
const tokensOf = (kind: UsageKind, known: Known): Set<string> =>
  ({
    color: known.colors,
    element: new Set<string>(),
    fontSize: known.sizes,
    fontWeight: known.weights,
    radius: known.radii,
    shadow: known.shadows,
    spacing: known.spacing,
    zIndex: known.layers,
  })[kind];

/** The colours a declared value writes out; a shadow with none is written out as a whole. */
const writtenColors = (
  kind: "color" | "shadow",
  value: string,
  rest: string,
  known: Known,
  named: number
): Classified[] => {
  const out: Classified[] = [];
  FUNCTION_COLOR_RE.lastIndex = 0;
  for (const match of rest.matchAll(FUNCTION_COLOR_RE)) {
    out.push(rawColor(known, match[0]));
  }
  HEX_IN_RE.lastIndex = 0;
  for (const match of rest.matchAll(HEX_IN_RE)) {
    out.push(rawColor(known, match[0]));
  }
  if (kind === "color" && NAMED_COLORS.has(rest.trim().toLowerCase())) {
    out.push(rawColor(known, rest));
  }
  if (
    kind === "shadow" &&
    out.length + named === 0 &&
    value.trim() !== "none"
  ) {
    out.push({
      kind,
      literal: value.trim(),
      status: "raw",
      value: value.trim(),
    });
  }
  return out;
};

/** The lengths or numbers a declared value writes out. */
const writtenValues = (kind: UsageKind, rest: string): Classified[] => {
  if (kind === "spacing" || kind === "fontSize" || kind === "radius") {
    return [...rest.matchAll(LENGTH_IN_RE)]
      .filter((match) => Number.parseFloat(match[0]) !== 0)
      .map((match) => ({
        kind,
        literal: match[0],
        status: "raw" as const,
        value: match[0],
      }));
  }
  return NUMBER_RE.test(rest.trim())
    ? [{ kind, literal: rest.trim(), status: "raw", value: rest.trim() }]
    : [];
};

/** Every var() a declared value refers to, and the literals it writes, for a kind. */
const classifyDeclared = (
  kind: UsageKind,
  value: string,
  known: Known
): Classified[] => {
  const out: Classified[] = [];
  let rest = value;
  for (const match of value.matchAll(VAR_ALL_RE)) {
    const name = match[1] ?? "";
    // `calc(var(--spacing) * 4)` is a step of the scale.
    const token =
      kind === "spacing" && name === "spacing"
        ? ({ kind, status: "system", value: "spacing" } as const)
        : fromVar(kind, name, tokensOf(kind, known));
    if (token) {
      out.push(token);
    }
    rest = rest.replace(match[0], " ");
  }
  return [
    ...out,
    ...(kind === "color" || kind === "shadow"
      ? writtenColors(kind, value, rest, known, out.length)
      : writtenValues(kind, rest)),
  ];
};

/** `background-color` → `backgroundColor`, so stylesheets and style objects read alike. */
const camel = (property: string) =>
  property.replace(DASHED_RE, (_, c: string) => c.toUpperCase());

/** Shorthands whose value may hold a colour: `border: 1px solid #ccc`. */
const COLOR_SHORTHANDS = new Set([
  "border",
  "borderBottom",
  "borderLeft",
  "borderRight",
  "borderTop",
  "outline",
]);

const kindOfProperty = (property: string): UsageKind | null => {
  if (
    STYLE_COLOR.has(property) ||
    COLOR_SHORTHANDS.has(property) ||
    property.endsWith("Color")
  ) {
    return "color";
  }
  if (STYLE_SPACING.has(property)) {
    return "spacing";
  }
  return STYLE_KIND[property] ?? null;
};

export const classify = (
  use: UsageOccurrence,
  known: Known,
  ctx: UsageContext,
  file: string
): Classified[] => {
  if (use.use === "literal") {
    return [rawColor(known, use.value)];
  }
  if (use.use === "element") {
    if (ctx.libraryDirs.some((dir) => file.startsWith(`${dir}/`))) {
      return [];
    }
    const component = (ELEMENT_COMPONENTS[use.value] ?? []).find((name) =>
      ctx.components.includes(name)
    );
    return component
      ? [{ kind: "element", status: "raw", token: component, value: use.value }]
      : [];
  }
  if (use.use.startsWith("style:") || use.use.startsWith("css:")) {
    const property = camel(use.use.slice(use.use.indexOf(":") + 1));
    const kind = kindOfProperty(property);
    if (!kind) {
      return [];
    }
    // A number in a style object is pixels, but a weight or a layer is a number of its own.
    const value =
      use.use.startsWith("style:") &&
      NUMBER_RE.test(use.value) &&
      (kind === "spacing" || kind === "fontSize" || kind === "radius")
        ? `${use.value}px`
        : use.value;
    return classifyDeclared(kind, value, known);
  }
  const one = classifyClass(use.use, use.value, known);
  return one ? [one] : [];
};

const PER_GROUP = 60;
const LOCATIONS = 8;
const EXAMPLES = 5;
const STATUS_ORDER: Record<UsageStatus, number> = {
  default: 1,
  raw: 0,
  system: 2,
};

interface Group {
  count: number;
  readonly examples: Set<string>;
  readonly files: Set<string>;
  readonly locations: UsageLocation[];
  readonly value: Classified;
}

const recommend = (
  ownColors: number,
  colors: UsageTotals | undefined
): UsageInventory["recommendation"] => {
  const total = colors ? colors.system + colors.default + colors.raw : 0;
  const off = colors ? colors.default + colors.raw : 0;
  const share = total > 0 ? Math.round((off / total) * 100) : 0;
  if (ownColors < 3) {
    return {
      mode: "propose",
      reason: `The theme declares ${ownColors === 0 ? "no colour tokens" : `${ownColors} colour token${ownColors === 1 ? "" : "s"}`} of its own, so the code's colours are Tailwind's palette and values written out.`,
    };
  }
  if (share > 50) {
    return {
      mode: "propose",
      reason: `${share}% of the colours the code uses are not the theme's.`,
    };
  }
  return {
    mode: "adopt",
    reason: `The theme declares ${ownColors} colours of its own${total > 0 ? `, and ${100 - share}% of the colours in the code are among them` : ""}.`,
  };
};

/** One use counted into its value's group, and into its kind's totals. */
const count = (
  groups: Map<string, Group>,
  totals: Map<UsageKind, UsageTotals>,
  value: Classified,
  use: UsageOccurrence,
  file: string
) => {
  const key = `${value.kind}|${value.status}|${value.value}`;
  const group = groups.get(key) ?? {
    count: 0,
    examples: new Set<string>(),
    files: new Set<string>(),
    locations: [],
    value,
  };
  group.count += 1;
  group.files.add(file);
  if (group.examples.size < EXAMPLES) {
    group.examples.add(use.raw);
  }
  if (group.locations.length < LOCATIONS) {
    group.locations.push({ file, line: use.line });
  }
  groups.set(key, group);
  const total = totals.get(value.kind);
  if (total) {
    totals.set(value.kind, {
      ...total,
      [value.status]: total[value.status] + 1,
    });
  }
};

const summarise: UsageReader["summarise"] = (files, ctx, at) => {
  const known = knownOf(ctx.designSystem, ctx.ownTokens);
  const groups = new Map<string, Group>();
  const totals = new Map<UsageKind, UsageTotals>(
    USAGE_KINDS.map(({ kind }) => [
      kind,
      { default: 0, kind, raw: 0, system: 0 },
    ])
  );
  for (const { file, uses } of files) {
    for (const use of uses) {
      for (const value of classify(use, known, ctx, file)) {
        count(groups, totals, value, use, file);
      }
    }
  }
  const sorted = [...groups.values()].sort(
    (a, b) =>
      STATUS_ORDER[a.value.status] - STATUS_ORDER[b.value.status] ||
      b.count - a.count ||
      a.value.value.localeCompare(b.value.value)
  );
  const taken = new Map<string, number>();
  const values: UsageValue[] = [];
  for (const group of sorted) {
    const key = `${group.value.kind}|${group.value.status}`;
    const n = taken.get(key) ?? 0;
    if (n >= (ctx.perGroup ?? PER_GROUP)) {
      continue;
    }
    taken.set(key, n + 1);
    values.push({
      count: group.count,
      examples: [...group.examples],
      files: group.files.size,
      kind: group.value.kind,
      locations: group.locations,
      status: group.value.status,
      value: group.value.value,
      ...(group.value.token !== undefined && { token: group.value.token }),
    });
  }
  const ownColors =
    ctx.ownTokens === null
      ? known.colors.size
      : ctx.ownTokens.filter((name) => name.startsWith("color-")).length;
  return {
    against: ctx.ownTokens === null ? "saved" : "theme",
    at,
    files: files.length,
    ownColors,
    recommendation: recommend(ownColors, totals.get("color")),
    totals: [...totals.values()],
    values,
  };
};

export const scanning: Pick<
  UsageReader,
  "includes" | "scanFile" | "summarise"
> = { includes, scanFile, summarise };
