/**
 * Minimal knowledge about Tailwind utility families, used to decide which classes conflict
 * when the inspector writes a value. Full conflict resolution runs on the server with
 * `tailwind-merge`; this table maps CSS properties to utility prefixes for the UI.
 */
export const propertyToUtility: Record<
  string,
  {
    prefix: string;
    scale?:
      | "spacing"
      | "color"
      | "radius"
      | "font-size"
      | "font-weight"
      | "leading"
      | "tracking"
      | "opacity"
      | "shadow"
      | "width"
      | "height";
  }
> = {
  "padding-top": { prefix: "pt", scale: "spacing" },
  "padding-right": { prefix: "pr", scale: "spacing" },
  "padding-bottom": { prefix: "pb", scale: "spacing" },
  "padding-left": { prefix: "pl", scale: "spacing" },
  "margin-top": { prefix: "mt", scale: "spacing" },
  "margin-right": { prefix: "mr", scale: "spacing" },
  "margin-bottom": { prefix: "mb", scale: "spacing" },
  "margin-left": { prefix: "ml", scale: "spacing" },
  gap: { prefix: "gap", scale: "spacing" },
  "row-gap": { prefix: "gap-y", scale: "spacing" },
  "column-gap": { prefix: "gap-x", scale: "spacing" },
  width: { prefix: "w", scale: "width" },
  height: { prefix: "h", scale: "height" },
  "min-width": { prefix: "min-w", scale: "width" },
  "max-width": { prefix: "max-w", scale: "width" },
  "min-height": { prefix: "min-h", scale: "height" },
  "max-height": { prefix: "max-h", scale: "height" },
  "font-size": { prefix: "text", scale: "font-size" },
  "font-weight": { prefix: "font", scale: "font-weight" },
  "line-height": { prefix: "leading", scale: "leading" },
  "letter-spacing": { prefix: "tracking", scale: "tracking" },
  color: { prefix: "text", scale: "color" },
  "background-color": { prefix: "bg", scale: "color" },
  "border-color": { prefix: "border", scale: "color" },
  "border-width": { prefix: "border" },
  "border-radius": { prefix: "rounded", scale: "radius" },
  opacity: { prefix: "opacity", scale: "opacity" },
  "box-shadow": { prefix: "shadow", scale: "shadow" },
};

export const displayClasses: Record<string, string> = {
  block: "block",
  flex: "flex",
  "inline-flex": "inline-flex",
  grid: "grid",
  inline: "inline",
  "inline-block": "inline-block",
  none: "hidden",
  contents: "contents",
};

export const spacingScale = [
  "0",
  "px",
  "0.5",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "14",
  "16",
  "20",
  "24",
  "28",
  "32",
  "36",
  "40",
  "44",
  "48",
  "52",
  "56",
  "60",
  "64",
  "72",
  "80",
  "96",
] as const;

export const fontSizeScale = [
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
] as const;
export const fontWeightScale = [
  "thin",
  "extralight",
  "light",
  "normal",
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
] as const;
export const radiusScale = [
  "none",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "full",
] as const;
export const shadowScale = ["none", "2xs", "xs", "sm", "md", "lg", "xl", "2xl"] as const;
export const leadingScale = ["none", "tight", "snug", "normal", "relaxed", "loose"] as const;
export const trackingScale = ["tighter", "tight", "normal", "wide", "wider", "widest"] as const;

/** Spacing step in px for the default Tailwind 4 scale (0.25rem base, 16px root). */
export const spacingToPx = (step: string): number | null => {
  if (step === "px") return 1;
  const n = Number(step);
  return Number.isFinite(n) ? n * 4 : null;
};

export const pxToSpacing = (px: number): string | null => {
  if (px === 1) return "px";
  const step = px / 4;
  const asString = Number.isInteger(step) ? String(step) : String(step);
  return (spacingScale as readonly string[]).includes(asString) ? asString : null;
};

/** Builds a Tailwind class for a property and value, using a scale step when possible. */
export const classFor = (prefix: string, value: string): string => `${prefix}-${value}`;

/** Wraps an arbitrary CSS value as a Tailwind arbitrary value: `p-[13px]`. */
export const arbitrary = (prefix: string, css: string): string =>
  `${prefix}-[${css.replaceAll(" ", "_")}]`;
