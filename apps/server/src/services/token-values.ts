/**
 * Telling two token values apart the way a person would (ADR 0025): `#3b82f6` and
 * `oklch(0.623 0.188 259.8)` are one colour, `12px` and `0.75rem` one length. Used to compare
 * Figma's values with the code's, and to write Figma's in the unit the code already uses. Pure.
 */

type Rgba = readonly [number, number, number, number];

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const FN_RE = /^(rgba?|hsla?|oklch)\(\s*([^)]*)\)$/i;
const LENGTH_RE = /^(-?\d*\.?\d+)(px|rem)$/;
const NUMBER_RE = /^-?\d*\.?\d+$/;
const SPLIT_RE = /[\s,/]+/;
const SPACES_RE = /\s+/g;
const ZERO_PX_RE = /(^|[\s,(])0px\b/g;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** `50%` as 0.5, `0.5` as it is; `scale` is what 100% is. */
const amount = (part: string | undefined, scale = 1): number => {
  if (part === undefined) {
    return Number.NaN;
  }
  return part.endsWith("%")
    ? (Number.parseFloat(part) / 100) * scale
    : Number.parseFloat(part);
};

const fromHex = (hex: string): Rgba | null => {
  const digits =
    hex.length <= 4
      ? [...hex].map((c) => c + c).join("")
      : hex.padEnd(8, "f").slice(0, 8);
  const full = digits.length === 6 ? `${digits}ff` : digits;
  const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), n(6)];
};

const fromHsl = (h: number, s: number, l: number, a: number): Rgba => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4), a];
};

/** sRGB from OKLCH, through OKLab and linear light. */
const fromOklch = (l: number, c: number, h: number, a: number): Rgba => {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l1 = (l + 0.396_337_777_4 * A + 0.215_803_757_3 * B) ** 3;
  const m1 = (l - 0.105_561_345_8 * A - 0.063_854_172_8 * B) ** 3;
  const s1 = (l - 0.089_484_177_5 * A - 1.291_485_548 * B) ** 3;
  const gamma = (x: number) =>
    clamp01(x <= 0.003_130_8 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return [
    gamma(4.076_741_662_1 * l1 - 3.307_711_591_3 * m1 + 0.230_969_929_2 * s1),
    gamma(-1.268_438_004_6 * l1 + 2.609_757_401_1 * m1 - 0.341_319_396_5 * s1),
    gamma(-0.004_196_086_3 * l1 - 0.703_418_614_7 * m1 + 1.707_614_701 * s1),
    a,
  ];
};

/** A colour as four channels from 0 to 1; null for what is not a colour this reads. */
export const parseColor = (value: string): Rgba | null => {
  const v = value.trim().toLowerCase();
  if (v === "white") {
    return [1, 1, 1, 1];
  }
  if (v === "black") {
    return [0, 0, 0, 1];
  }
  if (v === "transparent") {
    return [0, 0, 0, 0];
  }
  const hex: RegExpExecArray | null = HEX_RE.exec(v);
  if (hex?.[1]) {
    return fromHex(hex[1]);
  }
  const fn: RegExpExecArray | null = FN_RE.exec(v);
  if (!(fn?.[1] && fn[2] !== undefined)) {
    return null;
  }
  const parts = fn[2].split(SPLIT_RE).filter(Boolean);
  const alpha = parts[3] === undefined ? 1 : amount(parts[3]);
  const [, kind] = fn;
  let rgba: Rgba;
  if (kind.startsWith("rgb")) {
    rgba = [
      amount(parts[0], 255) / 255,
      amount(parts[1], 255) / 255,
      amount(parts[2], 255) / 255,
      alpha,
    ];
  } else if (kind.startsWith("hsl")) {
    rgba = fromHsl(
      Number.parseFloat(parts[0] ?? ""),
      amount(parts[1]?.endsWith("%") ? parts[1] : `${parts[1]}%`),
      amount(parts[2]?.endsWith("%") ? parts[2] : `${parts[2]}%`),
      alpha
    );
  } else {
    rgba = fromOklch(
      amount(parts[0]),
      amount(parts[1], 0.4),
      Number.parseFloat(parts[2] ?? "0") || 0,
      alpha
    );
  }
  return rgba.some((n) => Number.isNaN(n)) ? null : rgba;
};

/** A length in pixels, a rem being 16; null for anything else. */
const pixels = (value: string): number | null => {
  const m: RegExpExecArray | null = LENGTH_RE.exec(value.trim());
  if (!m?.[1]) {
    return null;
  }
  const n = Number.parseFloat(m[1]);
  return m[2] === "rem" ? n * 16 : n;
};

const normalised = (value: string) =>
  value.trim().toLowerCase().replace(ZERO_PX_RE, "$10").replace(SPACES_RE, " ");

/** Whether two token values come to the same thing. */
export const sameValue = (a: string | undefined, b: string | undefined) => {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (ca && cb) {
    // One step of 255 either way is rounding, not a different colour.
    return ca.every((n, i) => Math.abs(n - (cb[i] ?? 0)) <= 1.5 / 255);
  }
  const pa = pixels(a);
  const pb = pixels(b);
  if (pa !== null && pb !== null) {
    return Math.abs(pa - pb) < 0.01;
  }
  if (NUMBER_RE.test(a.trim()) && NUMBER_RE.test(b.trim())) {
    return Math.abs(Number(a) - Number(b)) < 0.0001;
  }
  return normalised(a) === normalised(b);
};

/**
 * Figma's value written the way the code writes this token: a length in rem when the code's is
 * in rem. Anything else is written as Figma has it.
 */
export const inCodeUnits = (figma: string, code: string | undefined) => {
  const px = pixels(figma);
  if (px !== null && code?.trim().endsWith("rem")) {
    return `${Math.round((px / 16) * 10_000) / 10_000}rem`;
  }
  return figma;
};
