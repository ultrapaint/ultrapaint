/**
 * A box's fill as layers (ADR 0134): the editor's reading of the one CSS background a node's
 * `fill` holds, and its writing back. The document keeps the string (ADR 0015); this says it as
 * what a designer edits: colours and linear, radial and conic gradients, the top one first, as
 * CSS paints them. A value read no other way is one `css` layer, written back as it was. Tokens
 * are read inside a fill wherever they are (`tokensInFill`), which no other field does: a text
 * saying "Save $20" names no token. Pure.
 */

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

/** A fill the editor cannot read as layers (an image among them), kept as it is. */
export interface CssLayer {
  readonly css: string;
  readonly kind: "css";
}

export type FillLayer = ColorLayer | GradientLayer | CssLayer;

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

const SPACES = new Set([" ", "\n", "\t"]);

/** How deep in brackets a character leaves the text, or which quote it is in. */
interface Scan {
  depth: number;
  quote: string | null;
}

/** Steps `scan` over one character; true where it stands outside brackets and quotes. */
const outside = (scan: Scan, c: string): boolean => {
  if (scan.quote !== null) {
    scan.quote = c === scan.quote ? null : scan.quote;
    return false;
  }
  if (c === '"' || c === "'") {
    scan.quote = c;
  } else if (c === "(") {
    scan.depth += 1;
  } else if (c === ")") {
    scan.depth -= 1;
  }
  return scan.depth === 0;
};

/** `text` split where `separator` stands outside brackets and quotes, each part trimmed. */
const splitTop = (text: string, separator: "," | " "): string[] => {
  const parts: string[] = [];
  const scan: Scan = { depth: 0, quote: null };
  const splits = (c: string) => (separator === "," ? c === "," : SPACES.has(c));
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if (outside(scan, c) && splits(c)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== "");
};

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

const round = (n: number) => Math.round(n * 100) / 100;

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
    angle: degrees === null ? undefined : round(degrees),
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
  return degrees === null ? null : { angle: round(degrees) };
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

/** One layer of a background, or null for one this does not read. */
const layerOf = (text: string): ColorLayer | GradientLayer | null => {
  if (isColor(text)) {
    return { color: text, kind: "color" };
  }
  const fn: RegExpExecArray | null = FUNCTION_RE.exec(text);
  const shape = fn ? SHAPES[(fn[1] ?? "").toLowerCase()] : undefined;
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
          : `${round(layer.angle)}deg`
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
          : `from ${round(layer.angle ?? 0)}deg`,
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
    default: {
      const head = gradientHeadCss(layer);
      return `${layer.shape}-gradient(${head === "" ? "" : `${head}, `}${stopsCss(layer.stops)})`;
    }
  }
};

/** Layers as the one CSS background a fill holds, the first on top; null for none. */
export const fillCss = (layers: readonly FillLayer[]): string | null =>
  layers.length === 0
    ? null
    : layers.map((l, i) => layerCss(l, i === layers.length - 1)).join(", ");

/** A stop's position in percent, `40%` as 40; null for none, or one in another unit. */
export const percentOf = (position: string | undefined): number | null => {
  const match: RegExpExecArray | null = PERCENT_RE.exec(position ?? "");
  return match ? Number(match[1]) : null;
};

/**
 * Whether every stop is placed in percent or left for CSS to place, so that each can be placed
 * in percent without moving: a stop at `10px`, `calc(…)` or a conic's `90deg` cannot be.
 */
export const placedInPercent = (stops: readonly FillStop[]): boolean =>
  stops.every(
    (s) => s.position === undefined || percentOf(s.position) !== null
  );

/**
 * Where CSS draws each stop, in percent of the gradient: a stop without a position between its
 * neighbours, the first at 0 and the last at 100, none before the one ahead of it. A position
 * in another unit counts as none.
 */
export const stopPositions = (stops: readonly FillStop[]): number[] => {
  const given = stops.map((s) => percentOf(s.position));
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
      out[k] = round(from + ((to - from) * (k - i + 1)) / (j - i + 1));
    }
  }
  return out.map((v) => v ?? 0);
};

/** A token anywhere in a fill: `$name` at its start or after a bracket, a comma or a space. */
const FILL_TOKEN_RE = /(^|[\s(,])\$([a-z0-9][\w.-]*)/gi;

/** What of a fill names no token whatever it holds: a URL and a quoted string. */
const LITERAL_RE = /url\([^)]*\)|"[^"]*"|'[^']*'/gi;

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
