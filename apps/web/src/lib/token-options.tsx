/**
 * The design system's tokens as the options of the inspector's fields: colours with a swatch,
 * sizes with the value they resolve to, spacing as the steps of its scale in pixels.
 */
import type { DesignSystem, Token } from "@ultrapaint/contracts/design-system";
import {
  SPACING_STEPS,
  shortName,
  spacingBasePx,
  spacingStepName,
  tokensOfKind,
} from "@ultrapaint/contracts/token-table";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import { isRamp, RAMP_STEPS, shadeOf } from "@ultrapaint/design-document/ramp";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import type { StyleOption } from "../components/style-combobox.tsx";
import { useDesignSystem } from "../state/design-system.ts";

export const Swatch = ({ color }: { color: string | undefined }) => (
  <span
    className="size-3 shrink-0 rounded-sm border border-foreground/15"
    style={{ background: color }}
  />
);

const tokenOption = (token: Token): StyleOption => ({
  description: token.value,
  label: shortName(token.name),
  value: tokenRef(token.name),
});

/** The kinds of token a style field of a node picks from. */
export const FIELD_TOKEN_KINDS = [
  "borderWidth",
  "color",
  "container",
  "font",
  "fontSize",
  "fontWeight",
  "leading",
  "radius",
  "shadow",
  "spacing",
  "tracking",
] as const satisfies readonly TokenKind[];
export type FieldTokenKind = (typeof FIELD_TOKEN_KINDS)[number];

/**
 * The colour tokens as options in their groups, each with the colour its swatch shows. A group
 * is a palette when it is a ramp (`isRamp`) whose shades each have a step of their own, so that
 * each has its place in the row (ADR 0146): each of its options says its place.
 */
export const colorGroups = (ds: DesignSystem | null) =>
  (ds?.colors ?? []).map((group) => {
    const steps = group.tokens.map((t) => shadeOf(t.name)?.step);
    const palette = isRamp(group) && new Set(steps).size === steps.length;
    return {
      name: group.name,
      options: group.tokens.map((t, i) => {
        const step = steps[i];
        return {
          ...tokenOption(t),
          swatch: t.value,
          ...(palette &&
            step !== undefined && {
              shade: { color: t.value, palette: group.name, step },
            }),
        };
      }),
    };
  });

/** A palette as a colour field lays it out: its shades at their places, null at an empty step. */
export interface PaletteRow {
  readonly name: string;
  readonly shades: readonly (StyleOption | null)[];
}

/**
 * A colour field's options as it draws them while nothing is typed (ADR 0146): the palettes, one
 * row each in the order they come, and the list of every other option, in its order. A palette at
 * the ramp's steps has a place at each of the eleven, the same across the palettes, empty where it
 * has no shade; one at steps of its own (`chart-1` to `chart-5`) is its shades in step order.
 */
export const splitPalettes = (
  options: readonly StyleOption[]
): {
  readonly list: readonly StyleOption[];
  readonly palettes: readonly PaletteRow[];
} => {
  const list = options.filter((o) => !o.shade);
  const byPalette = new Map<string, StyleOption[]>();
  for (const option of options) {
    if (option.shade) {
      const row = byPalette.get(option.shade.palette) ?? [];
      byPalette.set(option.shade.palette, [...row, option]);
    }
  }
  const atStep = (shades: readonly StyleOption[], step: number) =>
    shades.find((o) => o.shade?.step === step) ?? null;
  const palettes = [...byPalette].map(([name, shades]) => ({
    name,
    shades: shades.every((o) => RAMP_STEPS.some((s) => s === o.shade?.step))
      ? RAMP_STEPS.map((step) => atStep(shades, step))
      : [...shades].sort((a, b) => (a.shade?.step ?? 0) - (b.shade?.step ?? 0)),
  }));
  return { list, palettes };
};

/** A kind's options: its tokens by their short names, spacing first as the scale's named steps. */
export const tokenOptions = (
  ds: DesignSystem | null,
  kind: FieldTokenKind
): StyleOption[] => {
  if (kind === "spacing") {
    const base = spacingBasePx(ds?.spacing.base);
    return [
      ...SPACING_STEPS.map((step) => ({
        description: spacingStepName(step),
        label: String(step * base),
        value: String(step * base),
      })),
      ...tokensOfKind(ds, kind).map(tokenOption),
    ];
  }
  if (kind === "color") {
    // A colour says which group it is of.
    return colorGroups(ds).flatMap((group) =>
      group.options.map(
        ({ swatch, ...option }): StyleOption => ({
          ...option,
          description: group.name,
          preview: <Swatch color={swatch} />,
        })
      )
    );
  }
  return tokensOfKind(ds, kind).map((t) =>
    kind === "font"
      ? {
          ...tokenOption(t),
          description: t.value.split(",")[0]?.replaceAll('"', ""),
        }
      : tokenOption(t)
  );
};

export const useTokenOptions = (kind: FieldTokenKind) =>
  tokenOptions(
    useDesignSystem((s) => s.designSystem),
    kind
  );

/** The colour a value stands for, for its swatch: a token's recorded value, or the CSS. */
export const useColorOf = (value: unknown): string | undefined => {
  const ds = useDesignSystem((s) => s.designSystem);
  if (typeof value !== "string") {
    return undefined;
  }
  if (!value.startsWith("$")) {
    return value;
  }
  const name = value.slice(1);
  return tokensOfKind(ds, "color").find((t) => t.name === name)?.value;
};
