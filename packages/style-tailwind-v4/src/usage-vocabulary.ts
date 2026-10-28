/**
 * What the usage scan knows of Tailwind and the DOM, shared by reading the files and holding
 * their values against the design system: the utilities it reads, colours as they are written,
 * and the plain elements a library has a component for. How a class is written and Tailwind's
 * scales are `utilities`'; what a whole value is comes from contracts' `token-value`; the
 * patterns here find colours inside a file's text.
 */
import { parseColor } from "@ultrapaint/contracts/token-value";

export const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const FUNCTION_COLOR_RE =
  /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^()]*\)/gi;
const SPACES_RE = /\s+/g;

export const NAMED_COLORS = new Set([
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

/** The utilities read; `utilities` matches the longest first, so `gap-x` wins over `gap`. */
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
export const UTILITIES = [
  ...COLOR_UTILITIES,
  ...SPACING_UTILITIES,
  ...RADIUS_UTILITIES,
  "font",
  "z",
];
export const COLOR_SET = new Set(COLOR_UTILITIES);
export const SPACING_SET = new Set(SPACING_UTILITIES);
export const RADIUS_SET = new Set(RADIUS_UTILITIES);

/** Plain elements, and the components a library has for them. */
export const ELEMENT_COMPONENTS: Record<string, readonly string[]> = {
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

/**
 * How the inventory lists a colour written out, so one written two ways counts once: `#ABC` →
 * `#aabbcc`, a colour function lower-cased with single spaces. The token that holds it is the
 * token table's to find.
 */
export const normaliseColor = (value: string) => {
  const v = value.trim().toLowerCase();
  if (HEX_RE.test(v) && (v.length === 4 || v.length === 5)) {
    return `#${[...v.slice(1)].map((c) => c + c).join("")}`;
  }
  return v.replace(SPACES_RE, " ");
};

/** A whole value that is a colour: hex, any CSS name, or a colour function of numbers. */
export const isColorLiteral = (value: string) => parseColor(value) !== null;
