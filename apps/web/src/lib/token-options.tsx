/**
 * The design system's tokens as the options of the inspector's fields: colours with a swatch,
 * sizes with the value they resolve to, spacing as the steps of its scale in pixels.
 */
import type { DesignSystem, Token } from "@ultrapaint/contracts/design-system";
import { tokenRef, toPixels } from "@ultrapaint/design-document/tokens";
import type { StyleOption } from "../components/style-combobox.tsx";
import { useDesignSystem } from "../state/design-system.ts";

export const Swatch = ({ color }: { color: string | undefined }) => (
  <span
    className="size-3 shrink-0 rounded-sm border border-input"
    style={{ background: color }}
  />
);

const tokenOption = (token: Token, prefix: string): StyleOption => ({
  description: token.value,
  label: token.name.startsWith(prefix)
    ? token.name.slice(prefix.length)
    : token.name,
  value: tokenRef(token.name),
});

/** Steps of Tailwind's spacing scale a designer picks from. */
const SPACING_STEPS = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48,
];

export type TokenKind =
  | "color"
  | "radius"
  | "shadow"
  | "size"
  | "weight"
  | "font"
  | "leading"
  | "tracking"
  | "spacing"
  | "borderWidth"
  | "container";

export const tokenOptions = (
  ds: DesignSystem | null,
  kind: TokenKind
): StyleOption[] => {
  if (kind === "spacing") {
    const base = toPixels(ds?.spacing.base ?? "0.25rem") ?? 4;
    return [
      ...SPACING_STEPS.map((step) => ({
        description: `spacing-${step}`,
        label: String(step * base),
        value: String(step * base),
      })),
      ...(ds?.spacing.tokens ?? []).map((t) => tokenOption(t, "spacing-")),
    ];
  }
  if (!ds) {
    return [];
  }
  switch (kind) {
    case "color":
      return ds.colors.flatMap((group) =>
        group.tokens.map((t) => ({
          ...tokenOption(t, "color-"),
          description: group.name,
          preview: <Swatch color={t.value} />,
        }))
      );
    case "radius":
      return ds.radius.map((t) => tokenOption(t, "radius-"));
    case "shadow":
      return ds.shadows.map((t) => tokenOption(t, "shadow-"));
    case "borderWidth":
      return (ds.borderWidths ?? []).map((t) =>
        tokenOption(t, "border-width-")
      );
    case "container":
      return (ds.layout?.containers ?? []).map((t) =>
        tokenOption(t, "container-")
      );
    case "size":
      return ds.typography.sizes.map((t) => tokenOption(t, "text-"));
    case "weight":
      return ds.typography.weights.map((t) => tokenOption(t, "font-weight-"));
    case "font":
      return ds.typography.fonts.map((t) => ({
        ...tokenOption(t, "font-"),
        description: t.value.split(",")[0]?.replaceAll('"', ""),
      }));
    case "leading":
      return (ds.typography.leading ?? []).map((t) =>
        tokenOption(t, "leading-")
      );
    default:
      return (ds.typography.tracking ?? []).map((t) =>
        tokenOption(t, "tracking-")
      );
  }
};

export const useTokenOptions = (kind: TokenKind) =>
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
  return ds?.colors.flatMap((g) => g.tokens).find((t) => t.name === name)
    ?.value;
};
