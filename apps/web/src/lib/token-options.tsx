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
import { tokenRef } from "@ultrapaint/design-document/tokens";
import type { StyleOption } from "../components/style-combobox.tsx";
import { useDesignSystem } from "../state/design-system.ts";

export const Swatch = ({ color }: { color: string | undefined }) => (
  <span
    className="size-3 shrink-0 rounded-sm border border-input"
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
    return (ds?.colors ?? []).flatMap((group) =>
      group.tokens.map((t) => ({
        ...tokenOption(t),
        description: group.name,
        preview: <Swatch color={t.value} />,
      }))
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
