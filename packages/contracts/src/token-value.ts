/**
 * What a token's value is: a CSS value read as a colour, a length, a duration, a number or
 * something else, with the one notion of "the same value" everything that compares tokens uses
 * (ADR 0025): `#3b82f6` and `oklch(0.623 0.188 259.8)` are one colour, `12px` and `0.75rem` one
 * length, `1s` and `1000ms` one duration. Sync, DESIGN.md's mirror, the code's agreement and the
 * setup's rules all compare through `sameValue`, and the token table finds the tokens that hold a
 * value through `comparable` and `sameAs`, its two halves; DTCG, DESIGN.md and Tailwind read
 * values through `parseValue` and keep only their formats' own encodings.
 *
 * A colour keeps the space it is written in and its channels in that space's own ranges, as CSS
 * gives a percentage of them and as the DTCG format keeps them: sRGB's from 0 to 1 (hex, names,
 * `rgb()` and `color(srgb …)` alike), HSL's and HWB's saturation and lightness from 0 to 100, Lab's
 * lightness from 0 to 100, OKLab's from 0 to 1, a hue in degrees. A root `rem` is 16px.
 *
 * What the code writes that a token cannot hold is worked out here too: `var()` followed through
 * the code's variables (`resolveVars`), a `calc()` of lengths (`resolveCalc`), both at once
 * (`resolveCss`). Pure and synchronous.
 */

/** The colour spaces read: CSS's colour functions and the spaces `color()` names. */
export const COLOR_SPACES = [
  "srgb",
  "srgb-linear",
  "hsl",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "xyz-d50",
  "xyz-d65",
] as const;
export type ColorSpace = (typeof COLOR_SPACES)[number];

/** A channel of a colour, `none` where CSS leaves it out (an achromatic colour's hue). */
export type Channel = number | "none";

export interface Color {
  /** From 0 to 1. */
  readonly alpha: number;
  readonly channels: readonly [Channel, Channel, Channel];
  readonly kind: "color";
  readonly space: ColorSpace;
}

/** CSS's length units read, lower-cased; a percentage is read as a length in `%`. */
export const LENGTH_UNITS = [
  "px",
  "rem",
  "em",
  "%",
  "ch",
  "ex",
  "lh",
  "vw",
  "vh",
  "vmin",
  "vmax",
  "dvw",
  "dvh",
  "svw",
  "svh",
  "lvw",
  "lvh",
  "pt",
  "pc",
  "cm",
  "mm",
  "in",
] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

export interface Length {
  readonly kind: "length";
  readonly unit: LengthUnit;
  readonly value: number;
}

export interface Duration {
  readonly kind: "duration";
  readonly unit: "ms" | "s";
  readonly value: number;
}

export interface PlainNumber {
  readonly kind: "number";
  readonly value: number;
}

/** A value read as none of the others: a shadow, a font list, a `var()`, a `calc()`. */
export interface OtherValue {
  readonly css: string;
  readonly kind: "other";
}

export type TokenValue = Color | Duration | Length | OtherValue | PlainNumber;

/** How many pixels a root `rem` is. */
export const ROOT_PX = 16;

const NUMBER_RE = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?$/i;
const QUANTITY_RE = /^([-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?)([a-z%]+)$/i;
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION_RE = /^([a-z-]+)\(([^()]*)\)$/i;
/** A colour function, of any content: what CSS works out from others (`color-mix()`) too. */
const ANY_COLOR_FUNCTION_RE =
  /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(.*\)$/is;
const LIST_RE = /[\s,]+/;
const SPACES_RE = /\s+/g;
const ZERO_PX_RE = /(^|[\s,(])0px\b/g;

/** A number written without float noise, to `places` decimals: 1.1111 rather than 1.1111111111. */
export const formatNumber = (n: number, places = 4): string =>
  String(Number(n.toFixed(places)));

// Colours.

/** CSS's named colours, as `name rrggbb` pairs. */
const NAMED =
  "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc " +
  "bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a " +
  "burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 " +
  "cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b " +
  "darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 " +
  "darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 " +
  "darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b " +
  "darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 " +
  "deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff " +
  "firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc " +
  "ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f " +
  "grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 " +
  "khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd " +
  "lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 " +
  "lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a " +
  "lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 " +
  "lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 " +
  "magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 " +
  "mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a " +
  "mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa " +
  "mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 " +
  "olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa " +
  "palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 " +
  "peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 " +
  "rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 " +
  "salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 " +
  "skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa " +
  "springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 " +
  "turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 " +
  "yellowgreen 9acd32 transparent 00000000";

const NAMED_COLORS: ReadonlyMap<string, string> = (() => {
  const words = NAMED.split(" ");
  const out = new Map<string, string>();
  for (let i = 0; i + 1 < words.length; i += 2) {
    out.set(words[i] ?? "", words[i + 1] ?? "");
  }
  return out;
})();

/** How a colour function's channels are read. */
interface ChannelRule {
  /** Which channel is a hue, the one that may be written with an angle's unit. */
  readonly hue?: number;
  /** What 100% is for each channel; undefined where a percentage is not allowed. */
  readonly percent: readonly [number?, number?, number?];
  /** What a plain number is divided by: `rgb()`'s 0–255. */
  readonly scale?: number;
  readonly space: ColorSpace;
}

const FUNCTIONS: Record<string, ChannelRule> = {
  hsl: { hue: 0, percent: [undefined, 100, 100], space: "hsl" },
  hwb: { hue: 0, percent: [undefined, 100, 100], space: "hwb" },
  lab: { percent: [100, 125, 125], space: "lab" },
  lch: { hue: 2, percent: [100, 150], space: "lch" },
  oklab: { percent: [1, 0.4, 0.4], space: "oklab" },
  oklch: { hue: 2, percent: [1, 0.4], space: "oklch" },
  rgb: { percent: [1, 1, 1], scale: 255, space: "srgb" },
};
/** The legacy names of colour functions, which take the same channels. */
const LEGACY_NAMES: Record<string, string> = { hsla: "hsl", rgba: "rgb" };
/** The spaces `color()` names, `xyz` being `xyz-d65`. */
const PREDEFINED: Record<string, ColorSpace> = {
  "a98-rgb": "a98-rgb",
  "display-p3": "display-p3",
  "prophoto-rgb": "prophoto-rgb",
  rec2020: "rec2020",
  srgb: "srgb",
  "srgb-linear": "srgb-linear",
  xyz: "xyz-d65",
  "xyz-d50": "xyz-d50",
  "xyz-d65": "xyz-d65",
};
/** An angle's unit in degrees. */
const ANGLES: Record<string, number> = {
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** A number and its unit, lower-cased; the unit is empty for a plain number. */
const quantity = (
  text: string
): { readonly n: number; readonly unit: string } | null => {
  if (NUMBER_RE.test(text)) {
    return { n: Number(text), unit: "" };
  }
  const m: RegExpExecArray | null = QUANTITY_RE.exec(text);
  return m?.[1] && m[2] ? { n: Number(m[1]), unit: m[2].toLowerCase() } : null;
};

const channelOf = (
  part: string,
  rule: ChannelRule,
  i: number
): Channel | null => {
  if (part.toLowerCase() === "none") {
    return "none";
  }
  const q = quantity(part);
  if (q === null) {
    return null;
  }
  if (q.unit === "%") {
    const scale = rule.percent[i];
    return scale === undefined ? null : (q.n / 100) * scale;
  }
  if (q.unit !== "") {
    const degrees = ANGLES[q.unit];
    return rule.hue === i && degrees !== undefined ? q.n * degrees : null;
  }
  return q.n / (rule.scale ?? 1);
};

const alphaOf = (part: string | undefined): number | null => {
  if (part === undefined) {
    return 1;
  }
  const q = quantity(part.trim());
  if (q === null || !(q.unit === "" || q.unit === "%")) {
    return null;
  }
  return clamp01(q.unit === "%" ? q.n / 100 : q.n);
};

const fromHex = (hex: string): Color => {
  const digits = (
    hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex
  ).padEnd(8, "f");
  const n = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16) / 255;
  return {
    alpha: n(6),
    channels: [n(0), n(2), n(4)],
    kind: "color",
    space: "srgb",
  };
};

const fromFunction = (name: string, inner: string): Color | null => {
  const [main = "", alphaPart, extra] = inner.split("/");
  const parts = main.trim().split(LIST_RE).filter(Boolean);
  const rule: ChannelRule | undefined =
    name === "color"
      ? (() => {
          const space = PREDEFINED[parts.shift()?.toLowerCase() ?? ""];
          return space && { percent: [1, 1, 1], space };
        })()
      : FUNCTIONS[LEGACY_NAMES[name] ?? name];
  // The legacy `rgba(0, 0, 0, 0.5)` gives the alpha as a fourth channel.
  const legacyAlpha =
    alphaPart === undefined && parts.length === 4 ? parts.pop() : alphaPart;
  if (rule === undefined || extra !== undefined || parts.length !== 3) {
    return null;
  }
  const [a = null, b = null, c = null] = parts.map((p, i) =>
    channelOf(p, rule, i)
  );
  const alpha = alphaOf(legacyAlpha);
  if (a === null || b === null || c === null || alpha === null) {
    return null;
  }
  return { alpha, channels: [a, b, c], kind: "color", space: rule.space };
};

/** A colour this reads: hex, a name, or a colour function of numbers; null for anything else. */
export const parseColor = (css: string): Color | null => {
  const v = css.trim().toLowerCase();
  if (HEX_RE.test(v)) {
    return fromHex(v.slice(1));
  }
  const named = NAMED_COLORS.get(v);
  if (named !== undefined) {
    return fromHex(named);
  }
  const fn: RegExpExecArray | null = FUNCTION_RE.exec(v);
  return fn?.[1] && fn[2] !== undefined ? fromFunction(fn[1], fn[2]) : null;
};

/**
 * Whether CSS takes this as a colour: one `parseColor` reads, or a colour function it does not
 * work out (`color-mix()`, a relative colour) with no variable left in it. `currentColor` is not.
 */
export const isColor = (css: string): boolean => {
  const v = css.trim();
  if (parseColor(v) !== null) {
    return true;
  }
  return ANY_COLOR_FUNCTION_RE.test(v) && !v.includes("var(");
};

// Converting to sRGB, as CSS Color 4's sample code does.

type Vec = readonly [number, number, number];
type Matrix = readonly [Vec, Vec, Vec];

const times = (m: Matrix, v: Vec): Vec => {
  const row = (r: Vec) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
  return [row(m[0]), row(m[1]), row(m[2])];
};

const XYZ_TO_LINEAR_SRGB: Matrix = [
  [3.240_969_941_904_522_6, -1.537_383_177_570_094, -0.498_610_760_293_003_4],
  [-0.969_243_636_280_879_6, 1.875_967_501_507_720_2, 0.041_555_057_407_175_59],
  [
    0.055_630_079_696_993_66, -0.203_976_958_888_976_52,
    1.056_971_514_242_878_6,
  ],
];
const P3_TO_XYZ: Matrix = [
  [0.486_570_948_648_216_2, 0.265_667_693_169_093_06, 0.198_217_285_234_362_5],
  [0.228_974_564_069_748_8, 0.691_738_521_836_506_4, 0.079_286_914_093_745],
  [0, 0.045_113_381_858_902_64, 1.043_944_368_900_976],
];
const A98_TO_XYZ: Matrix = [
  [0.576_669_042_910_130_5, 0.185_558_237_906_546_3, 0.188_228_646_234_994_7],
  [0.297_344_975_250_536_05, 0.627_363_566_255_466_1, 0.075_291_458_493_997_8],
  [0.027_031_361_386_412_34, 0.070_688_852_535_827_23, 0.991_337_536_837_638_8],
];
const REC2020_TO_XYZ: Matrix = [
  [0.636_958_048_301_291_4, 0.144_616_903_586_208_32, 0.168_880_975_164_172_1],
  [0.262_700_212_011_267_1, 0.677_998_071_518_870_8, 0.059_301_716_469_861_96],
  [0, 0.028_072_693_049_087_428, 1.060_985_057_710_791],
];
/** ProPhoto is relative to D50. */
const PROPHOTO_TO_XYZ_D50: Matrix = [
  [0.797_766_644_900_642_3, 0.135_181_297_400_533_08, 0.031_347_734_128_392_2],
  [0.288_074_828_819_401_3, 0.711_835_234_241_873, 0.000_089_936_938_725_64],
  [0, 0, 0.825_104_602_510_460_2],
];
/** Bradford's adaptation from D50's white to D65's. */
const D50_TO_D65: Matrix = [
  [0.955_473_421_488_075, -0.023_098_454_948_764_71, 0.063_259_243_200_570_72],
  [
    -0.028_369_709_333_863_7, 1.009_995_398_081_304_1,
    0.021_041_441_191_917_323,
  ],
  [
    0.012_314_014_864_481_998, -0.020_507_649_298_898_964,
    1.330_365_926_242_124,
  ],
];
const D50_WHITE: Vec = [0.964_295_676_429_567_7, 1, 0.825_104_602_510_460_2];

const each = (v: Vec, f: (n: number) => number): Vec => [
  f(v[0]),
  f(v[1]),
  f(v[2]),
];
const signed = (n: number, f: (x: number) => number) =>
  Math.sign(n) * f(Math.abs(n));

/** sRGB's transfer function, which Display P3 shares. */
const srgbToLinear = (n: number) =>
  signed(n, (x) => (x <= 0.040_45 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
const linearToSrgb = (n: number) =>
  signed(n, (x) =>
    x <= 0.003_130_8 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  );
const a98ToLinear = (n: number) => signed(n, (x) => x ** (563 / 256));
const prophotoToLinear = (n: number) =>
  signed(n, (x) => (x <= 16 / 512 ? x / 16 : x ** 1.8));
const rec2020ToLinear = (n: number) => {
  const a = 1.099_296_826_809_44;
  const b = 0.018_053_968_510_807;
  return signed(n, (x) =>
    x < b * 4.5 ? x / 4.5 : ((x + a - 1) / a) ** (1 / 0.45)
  );
};

const hslToSrgb = (h: number, s: number, l: number): Vec => {
  const hue = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
};

const hwbToSrgb = (h: number, w: number, b: number): Vec => {
  if (w + b >= 1) {
    const gray = w / (w + b);
    return [gray, gray, gray];
  }
  return each(hslToSrgb(h, 1, 0.5), (n) => n * (1 - w - b) + w);
};

const polar = (l: number, c: number, h: number): Vec => {
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
};

/** XYZ relative to D50, from CIE Lab. */
const labToXyzD50 = ([l, a, b]: Vec): Vec => {
  const kappa = 24_389 / 27;
  const epsilon = 216 / 24_389;
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const inverse = (f: number) =>
    f ** 3 > epsilon ? f ** 3 : (116 * f - 16) / kappa;
  const y = l > kappa * epsilon ? fy ** 3 : l / kappa;
  return [inverse(fx) * D50_WHITE[0], y, inverse(fz) * D50_WHITE[2]];
};

/** Linear sRGB from OKLab, through its cone responses. */
const oklabToLinearSrgb = ([l, a, b]: Vec): Vec => {
  const l1 = (l + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m1 = (l - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s1 = (l - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return [
    4.076_741_662_1 * l1 - 3.307_711_591_3 * m1 + 0.230_969_929_2 * s1,
    -1.268_438_004_6 * l1 + 2.609_757_401_1 * m1 - 0.341_319_396_5 * s1,
    -0.004_196_086_3 * l1 - 0.703_418_614_7 * m1 + 1.707_614_701 * s1,
  ];
};

const fromXyz = (xyz: Vec): Vec =>
  each(times(XYZ_TO_LINEAR_SRGB, xyz), linearToSrgb);
const fromXyzD50 = (xyz: Vec): Vec => fromXyz(times(D50_TO_D65, xyz));
const fromLinear = (rgb: Vec): Vec => each(rgb, linearToSrgb);

/** The colour in gamma-encoded sRGB, out of gamut as it may be. */
const unclampedSrgb = (color: Color): Vec => {
  const n = (c: Channel) => (c === "none" ? 0 : c);
  const [c0, c1, c2] = color.channels;
  const v: Vec = [n(c0), n(c1), n(c2)];
  switch (color.space) {
    case "srgb":
      return v;
    case "srgb-linear":
      return fromLinear(v);
    case "hsl":
      return hslToSrgb(v[0], v[1] / 100, v[2] / 100);
    case "hwb":
      return hwbToSrgb(v[0], v[1] / 100, v[2] / 100);
    case "lab":
      return fromXyzD50(labToXyzD50(v));
    case "lch":
      return fromXyzD50(labToXyzD50(polar(...v)));
    case "oklab":
      return fromLinear(oklabToLinearSrgb(v));
    case "oklch":
      return fromLinear(oklabToLinearSrgb(polar(...v)));
    case "display-p3":
      return fromXyz(times(P3_TO_XYZ, each(v, srgbToLinear)));
    case "a98-rgb":
      return fromXyz(times(A98_TO_XYZ, each(v, a98ToLinear)));
    case "prophoto-rgb":
      return fromXyzD50(times(PROPHOTO_TO_XYZ_D50, each(v, prophotoToLinear)));
    case "rec2020":
      return fromXyz(times(REC2020_TO_XYZ, each(v, rec2020ToLinear)));
    case "xyz-d50":
      return fromXyzD50(v);
    case "xyz-d65":
      return fromXyz(v);
    default:
      return v;
  }
};

/** The colour as four sRGB channels from 0 to 1, the last its alpha; out of gamut is clamped. */
export const toSrgb = (
  color: Color
): readonly [number, number, number, number] => {
  const [r, g, b] = each(unclampedSrgb(color), clamp01);
  return [r, g, b, color.alpha];
};

const byte = (n: number) =>
  Math.round(clamp01(n) * 255)
    .toString(16)
    .padStart(2, "0");

/** `#rrggbb` in sRGB, with an alpha byte when the colour is not opaque. */
export const hexOf = (color: Color): string => {
  const [r, g, b, a] = toSrgb(color);
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a) : ""}`;
};

/** A colour's CSS in its own space's function: `rgb()` for sRGB, `color()` for a predefined one. */
export const printColor = (color: Color): string => {
  const num = (n: number) => formatNumber(n, 6);
  const slash = color.alpha < 1 ? ` / ${num(color.alpha)}` : "";
  const parts = (f: (n: number, i: number) => string) =>
    color.channels.map((c, i) => (c === "none" ? "none" : f(c, i))).join(" ");
  switch (color.space) {
    case "srgb":
      return `rgb(${parts((n) => String(Math.round(n * 255)))}${slash})`;
    case "hsl":
    case "hwb":
      return `${color.space}(${parts((n, i) => (i === 0 ? num(n) : `${num(n)}%`))}${slash})`;
    case "lab":
    case "lch":
    case "oklab":
    case "oklch":
      return `${color.space}(${parts(num)}${slash})`;
    default:
      return `color(${color.space} ${parts(num)}${slash})`;
  }
};

// Everything else.

const isLengthUnit = (unit: string): unit is LengthUnit =>
  (LENGTH_UNITS as readonly string[]).includes(unit);

/** A length, `12px`, `0.75rem`, `50%`; null for anything else, `0` among it (a number). */
export const parseLength = (css: string): Length | null => {
  const q = quantity(css.trim());
  return q && isLengthUnit(q.unit)
    ? { kind: "length", unit: q.unit, value: q.n }
    : null;
};

/** A plain number, `1.5`; null for anything else. */
export const parseNumber = (css: string): number | null => {
  const v = css.trim();
  return NUMBER_RE.test(v) ? Number(v) : null;
};

/** What a CSS value is: a colour, a length, a duration, a number, or other. */
export const parseValue = (css: string): TokenValue => {
  const color = parseColor(css);
  if (color) {
    return color;
  }
  const v = css.trim();
  const q = quantity(v);
  if (q?.unit === "") {
    return { kind: "number", value: q.n };
  }
  if (q && isLengthUnit(q.unit)) {
    return { kind: "length", unit: q.unit, value: q.n };
  }
  if (q && (q.unit === "ms" || q.unit === "s")) {
    return { kind: "duration", unit: q.unit, value: q.n };
  }
  return { css: v, kind: "other" };
};

/** A length's CSS: `0.75rem`. */
export const printLength = (length: {
  readonly value: number;
  readonly unit: LengthUnit;
}): string => `${formatNumber(length.value)}${length.unit}`;

/**
 * A length in pixels, a `rem` being 16; null for a length in any other unit, or none (a plain
 * number is not a length). An `em` is the size of the font around it, which a token does not
 * know, so it counts only when `em` says how many pixels it is: in a media query, or for a value
 * drawn at the root's size, it is `ROOT_PX`. Comparing tokens leaves it out, so `1em` is never
 * `16px`.
 */
export const toPx = (
  value: Length | string,
  { em }: { readonly em?: number } = {}
): number | null => {
  const length = typeof value === "string" ? parseLength(value) : value;
  switch (length?.unit) {
    case "px":
      return length.value;
    case "rem":
      return length.value * ROOT_PX;
    case "em":
      return em === undefined ? null : length.value * em;
    default:
      return null;
  }
};

const normalised = (value: string) =>
  value.trim().toLowerCase().replace(ZERO_PX_RE, "$10").replace(SPACES_RE, " ");

/** A duration in milliseconds. */
const ms = (d: Duration) => (d.unit === "s" ? d.value * 1000 : d.value);

/** A duration in milliseconds, `0.2s` → 200; null for anything else. */
export const toMs = (css: string): number | null => {
  const v = parseValue(css);
  return v.kind === "duration" ? ms(v) : null;
};

/** A zero of any unit, or none. */
const isZero = (v: TokenValue) =>
  (v.kind === "number" || v.kind === "length" || v.kind === "duration") &&
  v.value === 0;

/**
 * A value read once to be compared with many: what `sameValue` compares, so a list of tokens is
 * read once and not for every value it is held against (the token table's `tokensByValue`).
 */
export interface Comparable {
  /** A colour's four sRGB channels, its alpha last; null for anything else. */
  readonly srgb: readonly [number, number, number, number] | null;
  /** Its text but for case, spacing and `0px` for `0`. */
  readonly text: string;
  readonly value: TokenValue;
}

/** A value read to be compared, `sameAs` with another. */
export const comparable = (css: string): Comparable => {
  const value = parseValue(css);
  return {
    srgb: value.kind === "color" ? toSrgb(value) : null,
    text: normalised(css),
    value,
  };
};

const sameParsed = (a: Comparable, b: Comparable): boolean => {
  if (a.srgb && b.srgb) {
    const cb = b.srgb;
    // One step of 255 either way is rounding, not a different colour.
    return a.srgb.every((n, i) => Math.abs(n - (cb[i] ?? 0)) <= 1.5 / 255);
  }
  const [va, vb] = [a.value, b.value];
  if (va.kind === "length" && vb.kind === "length") {
    const pa = toPx(va);
    const pb = toPx(vb);
    if (pa !== null && pb !== null) {
      return Math.abs(pa - pb) < 0.01;
    }
    return va.unit === vb.unit && Math.abs(va.value - vb.value) < 0.0001;
  }
  if (va.kind === "duration" && vb.kind === "duration") {
    return Math.abs(ms(va) - ms(vb)) < 0.01;
  }
  if (va.kind === "number" && vb.kind === "number") {
    return Math.abs(va.value - vb.value) < 0.0001;
  }
  return false;
};

/** Whether two values read by `comparable` come to the same thing, as `sameValue` says. */
export const sameAs = (a: Comparable, b: Comparable): boolean =>
  (isZero(a.value) && isZero(b.value)) || sameParsed(a, b) || a.text === b.text;

/**
 * Whether two token values come to the same thing: one colour within a step of 255 per channel
 * in sRGB, one length in pixels (`px` and `rem`; any other unit only with itself), one duration,
 * one number; anything else written alike but for case, spacing and `0px` for `0`.
 */
export const sameValue = (
  a: string | undefined,
  b: string | undefined
): boolean =>
  a === undefined || b === undefined
    ? a === b
    : sameAs(comparable(a), comparable(b));

/**
 * A source's value (Figma's) written the way the token is written now, in the design system or
 * the code: a length in rem when that is in rem. Anything else is written as the source has it.
 */
export const inCodeUnits = (source: string, code: string | undefined) => {
  const px = toPx(source);
  if (px !== null && code !== undefined && parseLength(code)?.unit === "rem") {
    return printLength({ unit: "rem", value: px / ROOT_PX });
  }
  return source;
};

// Variables and arithmetic: what the code writes that a token's value cannot hold.

const NAME_CHAR_RE = /[\w-]/;

/** Where a quoted string that opens at `i` ends: the index of its closing quote. */
const stringEnd = (text: string, i: number): number => {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== quote) {
    j += text[j] === "\\" ? 2 : 1;
  }
  return j;
};

/** Where the parenthesis that opens at `open` closes, strings respected; -1 when it does not. */
const closingParen = (text: string, open: number): number => {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\") {
      i += 1;
    } else if (char === '"' || char === "'") {
      i = stringEnd(text, i);
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
    i += 1;
  }
  return -1;
};

/** Where the first comma outside parentheses is; -1 when there is none. */
const topLevelComma = (text: string): number => {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      return i;
    }
  }
  return -1;
};

/** The `var()` that starts at `at`: where it closes, the variable and the fallback it names. */
const referenceAt = (text: string, at: number) => {
  const close = closingParen(text, at + 3);
  if (close === -1) {
    return null;
  }
  const inside = text.slice(at + 4, close);
  const comma = topLevelComma(inside);
  return {
    close,
    fallback: comma === -1 ? undefined : inside.slice(comma + 1).trim(),
    variable: (comma === -1 ? inside : inside.slice(0, comma)).trim(),
  };
};

/** Where the next `var(` of a text is that is not the end of a longer name; -1 when none is. */
const nextVar = (text: string, from: number): number => {
  let at = text.indexOf("var(", from);
  while (at > 0 && NAME_CHAR_RE.test(text[at - 1] ?? "")) {
    at = text.indexOf("var(", at + 4);
  }
  return at;
};

/** How long a value followed through its variables may grow before the rest is left as written. */
const MAX_RESOLVED = 10_000;

/** A value followed through its variables, and whether a `var()` was left as written. */
interface Followed {
  /** A cycle cut it short: what it ends at depends on the path it was reached by. */
  readonly cyclic: boolean;
  /** A reference is left as written: unknown with no fallback, a cycle, unclosed or too long. */
  readonly left: boolean;
  readonly out: string;
}

const followVars = (
  value: string,
  lookup: (variable: string) => string | undefined
): Followed => {
  /** What a variable ends at, when that did not depend on the path it was reached by. */
  const memo = new Map<string, Followed>();

  /** What one `var()` ends at, from the variables on the path to it. */
  const follow = (
    ref: { fallback: string | undefined; variable: string },
    written: string,
    seen: ReadonlySet<string>
  ): Followed => {
    const known = memo.get(ref.variable);
    if (known !== undefined) {
      return known;
    }
    const met = seen.has(ref.variable);
    const found = met ? undefined : lookup(ref.variable);
    if (found !== undefined) {
      const inner = walk(found, new Set([...seen, ref.variable]));
      if (!inner.cyclic) {
        memo.set(ref.variable, inner);
      }
      return inner;
    }
    if (ref.fallback === undefined) {
      return { cyclic: met, left: true, out: written };
    }
    const inner = walk(ref.fallback, seen);
    return { ...inner, cyclic: met || inner.cyclic };
  };

  const walk = (text: string, seen: ReadonlySet<string>): Followed => {
    let out = "";
    let cyclic = false;
    let left = false;
    let from = 0;
    let at = nextVar(text, 0);
    let ref = at === -1 ? null : referenceAt(text, at);
    while (ref) {
      const written = text.slice(at, ref.close + 1);
      const followed = follow(ref, written, seen);
      cyclic ||= followed.cyclic;
      const fits = out.length + followed.out.length <= MAX_RESOLVED;
      left ||= followed.left || !fits;
      out += text.slice(from, at) + (fits ? followed.out : written);
      from = ref.close + 1;
      at = nextVar(text, from);
      ref = at === -1 ? null : referenceAt(text, at);
    }
    // A `var(` that does not close is left as written.
    return { cyclic, left: left || at !== -1, out: out + text.slice(from) };
  };
  return walk(value, new Set());
};

/**
 * A value with every `var()` in it followed to what it ends at, each on its own, `lookup` given
 * the variable as written (`--radius`): an unknown variable takes its fallback, or stays as
 * written, and the others are still followed. A variable met again on its own path is a cycle
 * and is treated as unknown. What a variable ends at is followed once (`--a: var(--b) var(--b)`
 * many levels deep stays quick), and a value that would grow past `MAX_RESOLVED` keeps its
 * remaining references as written.
 */
export const resolveVars = (
  value: string,
  lookup: (variable: string) => string | undefined
): string => followVars(value, lookup).out;

/** A number of a `calc()` in its unit, `""` for a plain number. */
interface Quantity {
  readonly n: number;
  readonly unit: "" | "em" | "px" | "rem";
}

const CALC_TOKEN_RE =
  /\s*(-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)?|infinity|[-+*/()])/iy;
const CALC_QUANTITY_RE = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em)?$/i;

const calcTokens = (text: string): string[] | null => {
  const tokens: string[] = [];
  CALC_TOKEN_RE.lastIndex = 0;
  while (CALC_TOKEN_RE.lastIndex < text.length) {
    const start = CALC_TOKEN_RE.lastIndex;
    // Typed by hand: the linter otherwise takes the result for non-null.
    const match: RegExpExecArray | null = CALC_TOKEN_RE.exec(text);
    const token = match === null ? undefined : match[1];
    if (token === undefined) {
      return text.slice(start).trim() === "" ? tokens : null;
    }
    tokens.push(token.toLowerCase());
  }
  return tokens;
};

/** One number of a `calc()`: a length, a plain number, or infinity. */
const quantityOf = (token: string): Quantity | null => {
  if (token === "infinity") {
    return { n: Number.POSITIVE_INFINITY, unit: "" };
  }
  const match: RegExpExecArray | null = CALC_QUANTITY_RE.exec(token);
  if (match === null) {
    return null;
  }
  const [, n = "", unit = ""] = match;
  return { n: Number(n), unit: unit.toLowerCase() as Quantity["unit"] };
};

/** Two lengths in one unit: `rem` and `px` meet in pixels; `em` meets only `em`. */
const together = (a: Quantity, b: Quantity): [Quantity, Quantity] | null => {
  if (a.unit === b.unit) {
    return [a, b];
  }
  const px = (q: Quantity): Quantity | null => {
    if (q.unit === "px") {
      return q;
    }
    return q.unit === "rem" ? { n: q.n * ROOT_PX, unit: "px" } : null;
  };
  const pa = px(a);
  const pb = px(b);
  return pa && pb ? [pa, pb] : null;
};

/** `a op b`, when the units allow it: a length times a number, a length over one, two lengths summed. */
const combine = (a: Quantity, op: string, b: Quantity): Quantity | null => {
  if (op === "*") {
    return a.unit !== "" && b.unit !== ""
      ? null
      : { n: a.n * b.n, unit: a.unit || b.unit };
  }
  if (op === "/" && b.unit === "") {
    return { n: a.n / b.n, unit: a.unit };
  }
  const both = together(a, b);
  if (!both) {
    return null;
  }
  const [x, y] = both;
  if (op === "/") {
    return { n: x.n / y.n, unit: "" };
  }
  return { n: op === "+" ? x.n + y.n : x.n - y.n, unit: x.unit };
};

/** `calc()`'s arithmetic on lengths and numbers: `+ - * /` and parentheses. */
const evaluate = (tokens: readonly string[]): Quantity | null => {
  let i = 0;
  const next = () => {
    const token = tokens[i];
    i += 1;
    return token;
  };
  const primary = (): Quantity | null => {
    const token = next();
    if (token === "(") {
      const inner = sum();
      return next() === ")" ? inner : null;
    }
    if (token === "-") {
      const inner = primary();
      return inner && { n: -inner.n, unit: inner.unit };
    }
    return token === undefined ? null : quantityOf(token);
  };
  const chain = (
    operand: () => Quantity | null,
    ops: readonly string[]
  ): Quantity | null => {
    let left = operand();
    while (left && ops.includes(tokens[i] ?? "")) {
      const op = next() ?? "";
      const right = operand();
      left = right && combine(left, op, right);
    }
    return left;
  };
  const product = () => chain(primary, ["*", "/"]);
  const sum = (): Quantity | null => chain(product, ["+", "-"]);
  const result = sum();
  return i === tokens.length ? result : null;
};

/** What an infinite length (`calc(infinity * 1px)`, Tailwind's `rounded-full`) is written as. */
export const INFINITE_PX = "9999px";

/**
 * A `calc()` of lengths and numbers worked out, `calc(0.625rem - 4px)` → `6px`: lengths in `px`,
 * `rem` and `em` (`em` meets only `em`), numbers and `infinity`. A value that is no `calc()`
 * is as it is; null when it cannot be worked out (`calc(100% - 2px)`).
 */
export const resolveCalc = (value: string): string | null => {
  const v = value.trim();
  if (!(v.startsWith("calc(") && closingParen(v, 4) === v.length - 1)) {
    return v;
  }
  const tokens = calcTokens(v.slice(5, -1));
  const result = tokens && evaluate(tokens);
  if (!result) {
    return null;
  }
  if (!Number.isFinite(result.n)) {
    return result.unit === "px" ? INFINITE_PX : null;
  }
  return `${formatNumber(result.n)}${result.unit}`;
};

/**
 * A value of the code as plain CSS: every `var()` followed through `lookup` (given the variable
 * as written), then a `calc()` of lengths worked out. Null when a variable is left unknown, in
 * a cycle, or the arithmetic cannot be worked out.
 */
export const resolveCss = (
  value: string,
  lookup: (variable: string) => string | undefined
): string | null => {
  const followed = followVars(value.trim(), lookup);
  return followed.left ? null : resolveCalc(followed.out);
};
