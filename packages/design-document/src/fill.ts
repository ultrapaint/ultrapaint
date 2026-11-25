/**
 * A box's fill as layers (ADR 0134): the editor's reading of the one CSS background a node's
 * `fill` holds, and its writing back. The document keeps the string (ADR 0015); this says it as
 * what a designer edits: colours and linear, radial and conic gradients, the top one first, as
 * CSS paints them, and images (ADR 0149). A value read no other way is one `css` layer, written
 * back as it was. Tokens are read inside a fill wherever they are (`tokensInFill`), which no
 * other field does: a text saying "Save $20" names no token. Pure.
 */

import type { ImageFit } from "@ultrapaint/contracts/document";
import { splitTop } from "./css-split.ts";

export type GradientShape = "linear" | "radial" | "conic";

/** A colour where a gradient changes: a token (`$color-primary`) or CSS, and where it sits. */
export interface FillStop {
  readonly color: string;
  /** As CSS writes it, `40%`; none where CSS places it between its neighbours. */
  readonly position?: string | undefined;
}

export interface ColorLayer {
  readonly color: string;
  readonly kind: "color";
}

export interface GradientLayer {
  /** A linear gradient's direction, or where a conic one starts, in degrees clockwise from up. */
  readonly angle?: number | undefined;
  /**
   * A radial gradient's shape, size and centre (`circle at top`); a conic one's centre
   * (`at 50% 50%`). As written.
   */
  readonly geometry?: string | undefined;
  /** The colour space the stops are mixed in (`oklab`), when the gradient names one. */
  readonly interpolation?: string | undefined;
  readonly kind: "gradient";
  readonly shape: GradientShape;
  /** A linear gradient's direction as a side or a corner, `to top right`, in place of an angle. */
  readonly side?: string | undefined;
  readonly stops: readonly FillStop[];
}

/** How a picture fills its box: an image node's `fit`. */
export type { ImageFit } from "@ultrapaint/contracts/document";

/** A picture (ADR 0149), centred and drawn once. */
export interface ImageLayer {
  /** How it fills the box; none for one written as CSS's default, at its own size and tiled. */
  readonly fit?: ImageFit | undefined;
  readonly kind: "image";
  /** Its file: a path in the canvas (`assets/hero.png`) or a URL, as its `url()` holds it. */
  readonly src: string;
}

/** A fill the editor cannot read as layers (a tiled image among them), kept as it is. */
export interface CssLayer {
  readonly css: string;
  readonly kind: "css";
}

export type FillLayer = ColorLayer | GradientLayer | ImageLayer | CssLayer;

const SHAPES: Record<string, GradientShape> = {
  "conic-gradient": "conic",
  "linear-gradient": "linear",
  "radial-gradient": "radial",
};

const ANGLE_RE = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/i;
const LENGTH_HEAD_RE = /^-?\.?\d/;
const FUNCTION_RE = /^([a-z-]+)\((.*)\)$/is;
const IDENT_RE = /^[a-z][a-z-]*$/i;
const PERCENT_RE = /^(-?\d*\.?\d+)%$/;
const VAR_RE = /^var\(/i;
const HUE_METHODS = new Set(["shorter", "longer", "increasing", "decreasing"]);
const RADIAL_HEAD = new Set([
  "at",
  "circle",
  "closest-corner",
  "closest-side",
  "ellipse",
  "farthest-corner",
  "farthest-side",
  "in",
]);
const COLOR_FUNCTIONS = new Set([
  "color",
  "color-mix",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "light-dark",
  "oklab",
  "oklch",
  "rgb",
  "rgba",
  "var",
]);
/** Words a whole background can be that are no colour. */
const NOT_COLORS = new Set(["none", "inherit", "initial", "unset", "revert"]);

/** An angle in degrees: `0.25turn` is 90. */
const degreesOf = (text: string): number | null => {
  const match: RegExpExecArray | null = ANGLE_RE.exec(text);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  switch ((match[2] ?? "").toLowerCase()) {
    case "turn":
      return n * 360;
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    case "deg":
      return n;
    default:
      // A bare number is an angle only when it is 0.
      return n === 0 ? 0 : null;
  }
};

/** Whether one word of CSS is a colour: a token, a hex, a colour's function or a keyword. */
const isColor = (word: string): boolean => {
  if (word.startsWith("$") || word.startsWith("#")) {
    return true;
  }
  const fn: RegExpExecArray | null = FUNCTION_RE.exec(word);
  if (fn) {
    return COLOR_FUNCTIONS.has((fn[1] ?? "").toLowerCase());
  }
  return IDENT_RE.test(word) && !NOT_COLORS.has(word.toLowerCase());
};

/** Whether a gradient's first argument says how it runs rather than a colour where it starts. */
const isHead = (shape: GradientShape, arg: string): boolean => {
  const [first = ""] = splitTop(arg, " ");
  const word = first.toLowerCase();
  if (word === "in") {
    return true;
  }
  switch (shape) {
    case "linear":
      return word === "to" || degreesOf(word) !== null;
    case "radial":
      return RADIAL_HEAD.has(word) || LENGTH_HEAD_RE.test(word);
    default:
      return word === "from" || word === "at";
  }
};

type Head = Pick<
  GradientLayer,
  "angle" | "geometry" | "interpolation" | "side"
>;

/** A gradient's colour space, `in oklch longer hue`, and the words of its first argument besides. */
const interpolationOf = (
  words: readonly string[]
): { interpolation?: string; rest: readonly string[] } | null => {
  const at = words.findIndex((w) => w.toLowerCase() === "in");
  if (at < 0) {
    return { rest: words };
  }
  if (words[at + 1] === undefined) {
    return null;
  }
  const method = words[at + 2]?.toLowerCase();
  const end =
    method && HUE_METHODS.has(method) && words[at + 3] === "hue"
      ? at + 4
      : at + 2;
  return {
    interpolation: words.slice(at + 1, end).join(" "),
    rest: [...words.slice(0, at), ...words.slice(end)],
  };
};

/** Where a conic gradient starts and its centre: `from 90deg at 50% 50%`. */
const conicHead = (rest: readonly string[]): Head | null => {
  const starts = rest[0]?.toLowerCase() === "from";
  const degrees = starts ? degreesOf(rest[1] ?? "") : null;
  if (starts && degrees === null) {
    return null;
  }
  const place = starts ? rest.slice(2) : rest;
  if (place.length > 0 && place[0]?.toLowerCase() !== "at") {
    return null;
  }
  return {
    angle: degrees === null ? undefined : degrees,
    geometry: place.length > 0 ? place.join(" ") : undefined,
  };
};

/** Where a linear gradient runs: an angle, or a side or corner, `to top right`. */
const linearHead = (rest: readonly string[]): Head | null => {
  if (rest.length === 0) {
    return {};
  }
  if (rest[0]?.toLowerCase() === "to") {
    return rest.length >= 2 && rest.length <= 3
      ? { side: rest.join(" ").toLowerCase() }
      : null;
  }
  const degrees = rest.length === 1 ? degreesOf(rest[0] ?? "") : null;
  return degrees === null ? null : { angle: degrees };
};

/** How a gradient runs, from its first argument; null for what it does not know. */
const headOf = (shape: GradientShape, arg: string): Head | null => {
  const read = interpolationOf(splitTop(arg, " "));
  if (read === null) {
    return null;
  }
  const { interpolation, rest } = read;
  const radial = (): Head => ({
    geometry: rest.length > 0 ? rest.join(" ") : undefined,
  });
  const heads = { conic: conicHead, linear: linearHead, radial };
  const head = heads[shape](rest);
  return head === null ? null : { ...head, interpolation };
};

const stopOf = (arg: string): FillStop | null => {
  const [color, position, ...more] = splitTop(arg, " ");
  if (color === undefined || more.length > 0 || !isColor(color)) {
    return null;
  }
  return position === undefined ? { color } : { color, position };
};

/** A `url()` and the file it holds, quoted or not. */
const URL_RE =
  /^url\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|([^)"'\s]*))\s*\)$/i;
/** An escape of CSS: a code point in hex and the space that ends it, a line continued, a character. */
const ESCAPE_RE =
  /\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([\s\S]))/gi;
/** A file a `url()` can hold unquoted. */
const BARE_URL_RE = /^[^\s()'"\\]+$/;

/** A code point CSS escapes in hex; none it can hold, the replacement character. */
const codePointOf = (hex: string) => {
  const n = Number.parseInt(hex, 16);
  return String.fromCodePoint(n > 0 && n <= 0x10_ff_ff ? n : 0xff_fd);
};

/** The file a `url(…)` holds, or null for what is no `url()`. */
const urlSrc = (text: string): string | null => {
  const match: RegExpExecArray | null = URL_RE.exec(text.trim());
  if (!match) {
    return null;
  }
  const quoted = match[1] ?? match[2];
  return quoted === undefined
    ? (match[3] ?? "")
    : quoted.replace(
        ESCAPE_RE,
        (_whole, hex: string | undefined, _line, char: string | undefined) =>
          hex === undefined ? (char ?? "") : codePointOf(hex)
      );
};

const QUOTED_RE = /["\\]/g;
const LINE_BREAK_RE = /\r\n|[\n\r\f]/g;

/** Text as a CSS string: a quote and a backslash escaped, a line break as its code point. */
const cssString = (text: string) =>
  `"${text.replace(QUOTED_RE, "\\$&").replace(LINE_BREAK_RE, "\\a ")}"`;

/** A file as a `url()`, quoted where it must be. */
const urlCss = (src: string) =>
  `url(${BARE_URL_RE.test(src) ? src : cssString(src)})`;

/** A fit as its `background-size`. */
const IMAGE_SIZES: Record<ImageFit, string> = {
  contain: "contain",
  cover: "cover",
  fill: "100% 100%",
};
const SLASH_RE = /\//g;
const SPACES_RE = /\s+/;
/** The ways the centre is written. */
const CENTRES = new Set(["center", "center center", "50%", "50% 50%"]);

/**
 * How an image's words after its `url()` place it: centred and drawn once at a fit, or nothing
 * where it says nothing; null for any other place, size or repeat, which the editor does not offer.
 * A picture that covers its box, or is stretched over it, is drawn once whether it repeats or not.
 */
const fitOf = (words: string): { fit?: ImageFit } | null => {
  const rest = words.replace(SLASH_RE, " / ").trim().split(SPACES_RE);
  if (rest.length === 1 && rest[0] === "") {
    return {};
  }
  const repeats = rest.filter((w) => w.toLowerCase() === "no-repeat");
  const [place, size, ...more] = rest
    .filter((w) => w.toLowerCase() !== "no-repeat")
    .join(" ")
    .split("/")
    .map((part) => part.trim().toLowerCase());
  const fit = (Object.keys(IMAGE_SIZES) as ImageFit[]).find(
    (f) => IMAGE_SIZES[f] === size
  );
  const once =
    repeats.length === 1 ||
    (repeats.length === 0 && (fit === "cover" || fit === "fill"));
  return once && more.length === 0 && CENTRES.has(place ?? "") && fit
    ? { fit }
    : null;
};

/** An image layer: a `url()` first, then how it is placed; null for anything else. */
const imageOf = (text: string): ImageLayer | null => {
  const [first = "", ...words] = splitTop(text, " ");
  const src = urlSrc(first);
  const placed = src === null ? null : fitOf(words.join(" "));
  return src === null || placed === null
    ? null
    : { kind: "image", src, ...placed };
};

/** One layer of a background, or null for one this does not read. */
const layerOf = (
  text: string
): ColorLayer | GradientLayer | ImageLayer | null => {
  if (isColor(text)) {
    return { color: text, kind: "color" };
  }
  const image = imageOf(text);
  if (image) {
    return image;
  }
  const fn: RegExpExecArray | null = FUNCTION_RE.exec(text);
  const name = (fn?.[1] ?? "").toLowerCase();
  const shape = Object.hasOwn(SHAPES, name) ? SHAPES[name] : undefined;
  if (!(fn && shape)) {
    return null;
  }
  const args = splitTop(fn[2] ?? "", ",");
  const [first = ""] = args;
  const head = isHead(shape, first) ? headOf(shape, first) : {};
  const stops = (isHead(shape, first) ? args.slice(1) : args).map(stopOf);
  if (head === null || stops.length < 2 || stops.some((s) => s === null)) {
    return null;
  }
  const [a, b] = stops as FillStop[];
  // A colour above another is written as a gradient of that colour alone (`fillCss`).
  if (
    shape === "linear" &&
    stops.length === 2 &&
    Object.values(head).every((v) => v === undefined) &&
    a?.position === undefined &&
    b?.position === undefined &&
    a?.color === b?.color &&
    // A variable may hold a position as well as a colour: kept a gradient.
    !VAR_RE.test(a?.color ?? "") &&
    a
  ) {
    return { color: a.color, kind: "color" };
  }
  const layer: GradientLayer = {
    kind: "gradient",
    shape,
    stops: stops as FillStop[],
    ...(head.angle !== undefined && { angle: head.angle }),
    ...(head.geometry !== undefined && { geometry: head.geometry }),
    ...(head.interpolation !== undefined && {
      interpolation: head.interpolation,
    }),
    ...(head.side !== undefined && { side: head.side }),
  };
  return layer;
};

/**
 * A fill as its layers, the top one first: none for no fill, and one `css` layer for a value it
 * cannot read (an image among them, a colour anywhere but at the bottom, CSS it does not know).
 */
export const fillLayers = (fill: string | null | undefined): FillLayer[] => {
  const text = fill?.trim() ?? "";
  if (text === "") {
    return [];
  }
  const parts = splitTop(text, ",");
  // A variable that is the whole fill may hold an image as well as a colour; one under images
  // or in a stop is a colour.
  if (parts.length === 1 && VAR_RE.test(text)) {
    return [{ css: fill ?? "", kind: "css" }];
  }
  const layers = parts.map(layerOf);
  // CSS takes a plain colour as the bottom layer only.
  const colorAbove = parts.some(
    (part, i) => i < parts.length - 1 && isColor(part)
  );
  if (colorAbove || layers.some((l) => l === null)) {
    return [{ css: fill ?? "", kind: "css" }];
  }
  return layers as FillLayer[];
};

/**
 * A fill as its layers when it is more than one colour, a gradient, an image or several layers;
 * null for a fill that is one value, or one read no other way (a tiled image, a variable).
 */
export const layeredFill = (
  fill: string | null | undefined
): FillLayer[] | null => {
  const layers = fillLayers(fill);
  return layers.every((l) => l.kind !== "css") &&
    (layers.length > 1 || layers[0]?.kind !== "color")
    ? layers
    : null;
};

/** The colours of a fill's layers, the top one's first, a gradient's stop by stop. */
export const layerColours = (layers: readonly FillLayer[]): string[] =>
  layers.flatMap((layer) => {
    if (layer.kind === "gradient") {
      return layer.stops.map((stop) => stop.color);
    }
    return layer.kind === "color" ? [layer.color] : [];
  });

/** A linear gradient's side or corner as the angle it runs at: `to right` is 90. */
export const SIDE_DEGREES: Readonly<Record<string, number>> = {
  "to bottom": 180,
  "to bottom left": 225,
  "to bottom right": 135,
  "to left": 270,
  "to left bottom": 225,
  "to left top": 315,
  "to right": 90,
  "to right bottom": 135,
  "to right top": 45,
  "to top": 0,
  "to top left": 315,
  "to top right": 45,
};

/** The angle a gradient runs at: its own, its side's, or CSS's default (down; a conic's up). */
export const angleOf = (layer: GradientLayer): number =>
  layer.angle ??
  (layer.shape === "linear" ? (SIDE_DEGREES[layer.side ?? ""] ?? 180) : 0);

/**
 * What a gradient's first argument says: nothing where it says only the defaults, or, `spelled`,
 * the defaults written out (`to bottom`, `from 0deg`, `ellipse`), for where it cannot be empty.
 */
export const gradientHeadCss = (
  layer: GradientLayer,
  spelled = false
): string => {
  const interpolation =
    layer.interpolation === undefined ? [] : [`in ${layer.interpolation}`];
  const words = (...parts: (string | undefined)[]) =>
    [...parts, ...interpolation].filter((p) => p !== undefined).join(" ");
  switch (layer.shape) {
    case "linear":
      return words(
        layer.angle === undefined
          ? (layer.side ?? (spelled ? "to bottom" : undefined))
          : `${layer.angle}deg`
      );
    case "radial":
      return words(
        layer.geometry ??
          (spelled && interpolation.length === 0 ? "ellipse" : undefined)
      );
    default:
      return words(
        layer.angle === undefined && !spelled
          ? undefined
          : `from ${layer.angle ?? 0}deg`,
        layer.geometry
      );
  }
};

/** A gradient's stops, a first one at 0% and a last one at 100% left where CSS puts them. */
const stopsCss = (stops: readonly FillStop[]) =>
  stops
    .map((stop, i) => {
      const implicit =
        (i === 0 && stop.position === "0%") ||
        (i === stops.length - 1 && stop.position === "100%");
      return stop.position === undefined || implicit
        ? stop.color
        : `${stop.color} ${stop.position}`;
    })
    .join(", ");

const layerCss = (layer: FillLayer, bottom: boolean): string => {
  switch (layer.kind) {
    case "css":
      return layer.css;
    case "color":
      return bottom
        ? layer.color
        : `linear-gradient(${layer.color}, ${layer.color})`;
    case "image":
      return layer.fit === undefined
        ? urlCss(layer.src)
        : `${urlCss(layer.src)} center / ${IMAGE_SIZES[layer.fit]} no-repeat`;
    default: {
      const head = gradientHeadCss(layer);
      return `${layer.shape}-gradient(${head === "" ? "" : `${head}, `}${stopsCss(layer.stops)})`;
    }
  }
};

/** Layers as the one CSS background a fill holds, the first on top; null for none. */
export const fillCss = (
  layers: readonly FillLayer[],
  /** Whether the last layer is the fill's bottom; not where a colour under them is written apart. */
  { bottom = true }: { readonly bottom?: boolean } = {}
): string | null =>
  layers.length === 0
    ? null
    : layers
        .map((l, i) => layerCss(l, bottom && i === layers.length - 1))
        .join(", ");

/** A stop's position in percent, `40%` as 40; null for none, or one in another unit. */
export const percentOf = (position: string | undefined): number | null => {
  const match: RegExpExecArray | null = PERCENT_RE.exec(position ?? "");
  return match ? Number(match[1]) : null;
};

/**
 * A stop's position as a share of its gradient in percent: `40%` as 40, and a conic gradient's
 * angle as its share of the turn, `90deg` as 25; null for none, or a length (`10px`, `calc(…)`),
 * which only the box's size could place.
 */
export const positionPercent = (
  position: string | undefined,
  shape: GradientShape
): number | null => {
  const percent = percentOf(position);
  if (percent !== null || shape !== "conic" || position === undefined) {
    return percent;
  }
  const degrees = degreesOf(position);
  return degrees === null ? null : (degrees / 360) * 100;
};

/**
 * Whether a stop's colour is a `var()` whose fallback is more than a colour (`red 20% 40%`),
 * however deep in other variables' fallbacks.
 */
const mayHoldPosition = (color: string): boolean => {
  const fn: RegExpExecArray | null = FUNCTION_RE.exec(color);
  if (!fn || (fn[1] ?? "").toLowerCase() !== "var") {
    return false;
  }
  const [, fallback = ""] = splitTop(fn[2] ?? "", ",");
  const words = splitTop(fallback, " ");
  return words.length > 1 || mayHoldPosition(words[0] ?? "");
};

/**
 * Whether every stop can be placed in percent without moving: given in percent, as a conic
 * gradient's angle, or left for CSS to place. A stop at `10px` or `calc(…)` cannot be, nor one
 * whose `var()` may hold a position of its own.
 */
export const placedInPercent = (
  stops: readonly FillStop[],
  shape: GradientShape
): boolean =>
  stops.every(
    (s) =>
      !mayHoldPosition(s.color) &&
      (s.position === undefined || positionPercent(s.position, shape) !== null)
  );

/**
 * Where CSS draws each stop, in percent of the gradient: a stop without a position between its
 * neighbours, the first at 0 and the last at 100, none before the one ahead of it. A conic
 * gradient's angle is its share of the turn; a length counts as no position.
 */
export const stopPositions = (
  stops: readonly FillStop[],
  shape: GradientShape = "linear"
): number[] => {
  const given = stops.map((s) => positionPercent(s.position, shape));
  const last = given.length - 1;
  if (given[0] === null) {
    given[0] = 0;
  }
  if (last > 0 && given[last] === null) {
    given[last] = 100;
  }
  let highest = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < given.length; i += 1) {
    const v = given[i];
    if (v !== null && v !== undefined) {
      highest = Math.max(highest, v);
      given[i] = highest;
    }
  }
  const out = [...given];
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] !== null) {
      continue;
    }
    let j = i;
    while (out[j] === null) {
      j += 1;
    }
    const from = out[i - 1] ?? 0;
    const to = out[j] ?? 100;
    for (let k = i; k < j; k += 1) {
      out[k] = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    }
  }
  return out.map((v) => v ?? 0);
};

/** A token anywhere in a fill: `$name` at its start or after a bracket, a comma or a space. */
const FILL_TOKEN_RE = /(^|[\s(,])\$([a-z0-9][\w.-]*)/gi;

/**
 * What of a fill names no token whatever it holds: a comment, a URL and a quoted string, whose
 * escapes take any character, a line break included.
 */
const LITERAL_RE =
  /\/\*[\s\S]*?\*\/|url\(\s*(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^)"']*)\s*\)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/gi;

/** A fill split at its literals: the parts that may name tokens, and the literals between. */
const tokenParts = (
  fill: string
): { readonly text: string; readonly literal: string }[] => {
  const parts: { text: string; literal: string }[] = [];
  let start = 0;
  for (const found of fill.matchAll(LITERAL_RE)) {
    parts.push({ literal: found[0], text: fill.slice(start, found.index) });
    start = found.index + found[0].length;
  }
  parts.push({ literal: "", text: fill.slice(start) });
  return parts;
};

/** The tokens a fill names, wherever in it but a URL or a quoted string, each once, in order. */
export const tokensInFill = (fill: string): string[] => [
  ...new Set(
    tokenParts(fill).flatMap(({ text }) =>
      Array.from(text.matchAll(FILL_TOKEN_RE), (m) => m[2] ?? "")
    )
  ),
];

/** A fill with each token it names as `variable` writes it, its URLs and strings as they are. */
export const resolveFillTokens = (
  fill: string,
  variable: (name: string) => string
): string =>
  tokenParts(fill)
    .map(({ literal, text }) => replaceTokens(text, variable) + literal)
    .join("");

const replaceTokens = (text: string, variable: (name: string) => string) =>
  text.replace(
    FILL_TOKEN_RE,
    (_whole, before: string, name: string) => `${before}${variable(name)}`
  );

/** A `url(…)` at the start of a literal of a fill. */
const URL_HEAD_RE = /^url\(/i;

/**
 * A fill with each file it names as `url` gives it (ADR 0149): a path in the canvas as the
 * address the canvas finds it at. Its tokens and other CSS are as they are.
 */
export const resolveFillUrls = (
  fill: string,
  url: (src: string) => string
): string =>
  tokenParts(fill)
    .map(({ literal, text }) => {
      const src = URL_HEAD_RE.test(literal) ? urlSrc(literal) : null;
      return text + (src === null ? literal : `url(${cssString(url(src))})`);
    })
    .join("");
