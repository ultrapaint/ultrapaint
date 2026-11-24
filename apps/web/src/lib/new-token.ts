/**
 * The ways onto the design system a field offers for a value outside it (ADR 0136): the nearest
 * token of the field's kind (`nearestToken`), picked as an option is, and a new token made from
 * the value, named first with the kind's prefix. Pure, but `useWaysOnto`, which reads them for
 * the design system drawn and the theme the view is drawn in.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { nearestToken } from "@ultrapaint/contracts/nearest-token";
import { defaultTheme } from "@ultrapaint/contracts/themes";
import {
  isTokenName,
  shortName,
  spacingBasePx,
  TOKEN_NAME_SHAPE,
  tokenKindOf,
  tokenOf,
  tokenPrefix,
} from "@ultrapaint/contracts/token-table";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import type { NearestRow } from "../components/style-combobox.tsx";
import { useBoard } from "../state/board.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import type { FieldTokenKind } from "./token-options.tsx";

/** What a colour field colours, which names its new token's namespace in a detailed system. */
export type ColorRole = "background" | "border" | "text";

/**
 * What a new token from a field's value is named first: its kind's prefix (`radius-`), or in a
 * detailed system (ADR 0062) the namespace of what a colour field colours (`text-color-`).
 */
export const newTokenPrefix = (
  ds: DesignSystem | null,
  kind: FieldTokenKind,
  colors?: ColorRole
): string =>
  kind === "color" && colors && ds?.tokenPreset === "detailed"
    ? `${colors}-color-`
    : tokenPrefix(kind);

/** What the Design system place says of a name a token has already. */
export const takenName = (name: string): string =>
  `${name} exists already. Give the new token another name.`;

/**
 * Whether a name can be the new token's, and why not, in the Design system place's words: not
 * taken, a token's name, and of the field's kind, so the token is listed where the field's are.
 */
export const newTokenName = (
  ds: DesignSystem | null,
  kind: FieldTokenKind,
  name: string,
  prefix: string
): { readonly problem: string | null; readonly ready: boolean } => {
  if (name === prefix || name.trim() === "") {
    return { problem: null, ready: false };
  }
  let problem: string | null = null;
  if (tokenOf(ds, name)) {
    problem = takenName(name);
  } else if (!isTokenName(name)) {
    problem = `A token's name is ${TOKEN_NAME_SHAPE}.`;
  } else if (tokenKindOf(name) !== kind) {
    problem = `${name} is not a name for this kind of token: start it with ${prefix}.`;
  }
  return { problem, ready: problem === null };
};

/**
 * The nearest token to a field's value, in the theme the view is drawn in, as its list offers it:
 * a token by its short name, a step of the spacing scale by its own and set as its pixels (`18`),
 * as the list's steps are. Null when none is near.
 */
export const nearestRow = (
  ds: DesignSystem,
  kind: FieldTokenKind,
  value: JsonValue | undefined,
  theme: string
): NearestRow | null => {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const found = nearestToken(kind, value, ds, { theme });
  if (!found) {
    return null;
  }
  return found.step === undefined
    ? {
        name: shortName(found.name),
        shown: found.value,
        value: tokenRef(found.name),
      }
    : {
        name: found.name,
        shown: found.value,
        value: String(found.step * spacingBasePx(ds.spacing.base)),
      };
};

/** What a field that takes tokens of a kind offers for a value outside the design system. */
export interface WaysOnto {
  /** The field's kind, and the spacing base in pixels that says which spacings are on the scale. */
  readonly field: {
    readonly kind: FieldTokenKind;
    readonly spacingBase: number;
  };
  readonly nameOf: (name: string) => ReturnType<typeof newTokenName>;
  readonly nearest: (value: JsonValue | undefined) => NearestRow | null;
  readonly prefix: string;
}

/** The ways onto the design system for a field of a kind; null without a kind or a design system. */
export const useWaysOnto = (
  kind: FieldTokenKind | undefined,
  colors?: ColorRole
): WaysOnto | null => {
  const ds = useDesignSystem((s) => s.designSystem);
  // The view is drawn in the boards' theme while a board view is open, else in the canvas's.
  const boards = useBoard((s) => (s.open ? (s.theme ?? "") : null));
  const pages = useEditor((s) => s.layout.defaults?.theme);
  if (!(kind && ds)) {
    return null;
  }
  const theme = (boards === null ? pages : boards) || defaultTheme(ds);
  const prefix = newTokenPrefix(ds, kind, colors);
  return {
    field: { kind, spacingBase: spacingBasePx(ds.spacing.base) },
    nameOf: (name) => newTokenName(ds, kind, name, prefix),
    nearest: (value) => nearestRow(ds, kind, value, theme),
    prefix,
  };
};
