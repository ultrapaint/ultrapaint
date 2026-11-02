/**
 * A palette's ramp from one colour (ADR 0045, "Generate ramp from…"): eleven shades, 50 to 950,
 * from light to dark over OKLCH's lightness, the colour given kept as it is at the step whose
 * lightness is nearest its own, the others of its hue with a chroma that swells towards the
 * middle as Tailwind's palettes do, brought into sRGB by taking chroma off. The dark theme's run
 * goes the other way: its 50 is the darkest. Pure.
 */
import {
  type Color,
  formatNumber,
  hexOf,
  inSrgbGamut,
  parseColor,
  toOklch,
} from "@ultrapaint/contracts/token-value";

/** A palette's steps, lightest first. */
export const RAMP_STEPS = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
] as const;
type RampStep = (typeof RAMP_STEPS)[number];

const SHADE_RE = /^(.+)-(\d+)$/;
/** The highest step a palette's shade is named with: Tailwind's palettes go 0 to 1000 at most. */
const LAST_STEP = 1000;

/**
 * A palette's shade read from its token's name: `color-primary-600` is the palette
 * `color-primary` at step 600. Null for a name that is no shade: one with no step, or a step past
 * 1000. Every reader of a palette (the colour boards, "Generate ramp from…", `/init`'s scan) asks
 * here.
 */
export const shadeOf = (
  name: string
): { readonly prefix: string; readonly step: number } | null => {
  const shade: RegExpExecArray | null = SHADE_RE.exec(name);
  const [, prefix, step] = shade ?? [];
  if (prefix === undefined || step === undefined) {
    return null;
  }
  const n = Number(step);
  return n <= LAST_STEP ? { prefix, step: n } : null;
};

/** Each step's lightness, after Tailwind's blue, lightest first. */
const LIGHTNESS = [
  0.97, 0.932, 0.882, 0.809, 0.708, 0.623, 0.546, 0.488, 0.424, 0.379, 0.282,
];

/** How much chroma each step has beside the most colourful, after Tailwind's blue. */
const CHROMA = [0.06, 0.13, 0.24, 0.41, 0.67, 0.87, 1, 0.99, 0.81, 0.66, 0.37];

interface RampShade {
  readonly step: RampStep;
  /** CSS: hex for a colour given in hex, `oklch()` otherwise. */
  readonly value: string;
}

const oklch = (l: number, c: number, h: number): Color => ({
  alpha: 1,
  channels: [l, c, h],
  kind: "color",
  space: "oklch",
});

/** The colour with as much of its chroma as sRGB draws, by halving the difference. */
const inGamut = (l: number, c: number, h: number): Color => {
  if (inSrgbGamut(oklch(l, c, h))) {
    return oklch(l, c, h);
  }
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut(oklch(l, mid, h))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return oklch(l, lo, h);
};

const LAST = LIGHTNESS.length - 1;

/**
 * Each step's lightness with the colour's at step `k`: the steps on either side spread between
 * it and the ends, in the order they had, so the run stays from light to dark.
 */
const lightnessWith = (k: number, base: number): number[] => {
  const top = Math.max(LIGHTNESS[0] as number, base);
  const bottom = Math.min(LIGHTNESS[LAST] as number, base);
  const at = (i: number) => LIGHTNESS[i] as number;
  return LIGHTNESS.map((t, i) => {
    if (i === k) {
      return base;
    }
    if (i < k) {
      const share = (at(0) - t) / (at(0) - at(k));
      return top - (top - base) * share;
    }
    const share = (at(k) - t) / (at(k) - at(LAST));
    return base - (base - bottom) * share;
  });
};

const print = (color: Color, hex: boolean): string => {
  if (hex) {
    return hexOf(color);
  }
  const [l, c, h] = color.channels as [number, number, number];
  return `oklch(${formatNumber(l * 100, 1)}% ${formatNumber(c, 3)} ${formatNumber(h, 1)})`;
};

/**
 * The eleven shades of a palette from one colour, in a theme's order: light's from 50 the
 * lightest, dark's the same colours the other way. Null when the colour is not one this reads.
 */
export const rampOf = (
  base: string,
  theme: "light" | "dark" = "light"
): RampShade[] | null => {
  const color = parseColor(base);
  if (!color) {
    return null;
  }
  const hex = base.trim().startsWith("#");
  const [l, c, h] = toOklch(color);
  const k = LIGHTNESS.reduce(
    (best, t, i) =>
      Math.abs(t - l) < Math.abs((LIGHTNESS[best] as number) - l) ? i : best,
    0
  );
  const peak = c / (CHROMA[k] as number);
  const lightness = lightnessWith(k, l);
  const values = lightness.map((li, i) =>
    i === k
      ? base.trim()
      : print(inGamut(li, peak * (CHROMA[i] as number), h), hex)
  );
  const run = theme === "dark" ? [...values].reverse() : values;
  return RAMP_STEPS.map((step, i) => ({ step, value: run[i] as string }));
};
