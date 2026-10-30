/**
 * Where a system component's look is edited (ADRs 0041, 0044, 0045): its base, a variant member, a
 * state, or a state in one member, and what a part's fields there take from the places they fall
 * back to. The more specific wins: a member's state over the state, the state over the member,
 * the member over the base; the project's file over the default look. A board's inspector reads
 * a cell's place here, and the server sets one part's style at a place with `withStyle`
 * (`setStyle`).
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type {
  LookMember,
  LookPlace,
  PartStyle,
  PartStyles,
  SystemLook,
} from "@ultrapaint/contracts/components";

/** The fields of a look a place is read in. */
export type LookStyles = Pick<
  SystemLook,
  "base" | "states" | "variantStates" | "variants"
>;

/** A variant member a place is in. */
export type Member = LookMember;

/** Where a field is set: the base when neither, a member, a state, or a state in a member. */
export type Place = LookPlace;

export const BASE: Place = { state: null, variant: null };

/** A place in a few words: `base`, `outline`, `hover`, `outline, hover`. */
export const placeLabel = ({ state, variant }: Place): string =>
  [variant?.member, state].filter(Boolean).join(", ") || "base";

/** The style record a place keeps its parts in. */
const stylesAt = (
  look: LookStyles,
  { state, variant }: Place
): PartStyles | undefined => {
  if (variant && state) {
    return look.variantStates?.[variant.axis]?.[variant.member]?.[state];
  }
  if (variant) {
    return look.variants[variant.axis]?.[variant.member];
  }
  return state ? look.states[state] : look.base;
};

/** One part's style at a place, empty when it sets none. */
export const styleAt = (
  look: LookStyles,
  place: Place,
  slot: string
): PartStyle => stylesAt(look, place)?.[slot] ?? {};

/** A record with one key set, or taken out when its value is empty; an empty record goes too. */
const withKey = <T>(
  record: Readonly<Record<string, T>> | undefined,
  key: string,
  value: T | undefined
): Record<string, T> => {
  const { [key]: _old, ...rest } = record ?? {};
  return value === undefined ? rest : { ...rest, [key]: value };
};

const emptyOr = <T extends object>(value: T): T | undefined =>
  Object.keys(value).length === 0 ? undefined : value;

/** The look with one part's style at a place replaced; what is left empty is taken out. */
export const withStyle = <L extends LookStyles>(
  look: L,
  place: Place,
  slot: string,
  style: PartStyle
): L => {
  const parts = emptyOr(withKey(stylesAt(look, place), slot, emptyOr(style)));
  const { state, variant } = place;
  if (variant && state) {
    const members = look.variantStates?.[variant.axis];
    const states = emptyOr(withKey(members?.[variant.member], state, parts));
    const axes = emptyOr(
      withKey(
        look.variantStates,
        variant.axis,
        emptyOr(withKey(members, variant.member, states))
      )
    );
    const { variantStates: _old, ...rest } = look;
    return (axes ? { ...rest, variantStates: axes } : rest) as L;
  }
  if (variant) {
    const members = look.variants[variant.axis];
    return {
      ...look,
      variants: withKey(
        look.variants,
        variant.axis,
        emptyOr(withKey(members, variant.member, parts))
      ),
    };
  }
  if (state) {
    return { ...look, states: withKey(look.states, state, parts) };
  }
  return { ...look, base: parts ?? {} };
};

/** The places a field falls back to when a place does not set it, the nearest first. */
export const fallbacksOf = ({ state, variant }: Place): Place[] => {
  if (state && variant) {
    return [{ state, variant: null }, { state: null, variant }, BASE];
  }
  return state || variant ? [BASE] : [];
};

/**
 * A part's style as the fields the tab shows, one value each: a border's colour and width apart,
 * padding as one value when it is the same on every side and as each side.
 */
export const fieldsOf = (style: PartStyle): Record<string, JsonValue> => {
  const { border, padding, ...rest } = style;
  const out: Record<string, JsonValue> = { ...rest };
  if (border?.color !== undefined) {
    out["border.color"] = border.color;
  }
  if (border?.width !== undefined) {
    out["border.width"] = border.width;
  }
  if (typeof padding === "string" || typeof padding === "number") {
    out.padding = padding;
    for (const side of ["top", "right", "bottom", "left"]) {
      out[`padding.${side}`] = padding;
    }
  } else if (padding) {
    for (const [side, value] of Object.entries(padding)) {
      if (value !== undefined) {
        out[`padding.${side}`] = value;
      }
    }
  }
  return out;
};

/** A field's value from a place it falls back to, and that place in words. */
export interface Inherited {
  readonly from: string;
  readonly value: JsonValue;
}

/**
 * What each field of a part takes at a place it does not set itself, by the field's name as
 * `fieldsOf` names it: the nearest place of the project's look that sets it, then the default
 * look's, at the place itself first.
 */
export const inheritedAt = (
  look: LookStyles,
  fallback: LookStyles | undefined,
  place: Place,
  slot: string
): Record<string, Inherited> => {
  const out: Record<string, Inherited> = {};
  const take = (from: LookStyles, at: Place, label: string) => {
    for (const [field, value] of Object.entries(
      fieldsOf(styleAt(from, at, slot))
    )) {
      out[field] ??= { from: label, value };
    }
  };
  for (const at of fallbacksOf(place)) {
    take(look, at, placeLabel(at));
  }
  if (fallback) {
    for (const at of [place, ...fallbacksOf(place)]) {
      take(fallback, at, `default ${placeLabel(at)}`);
    }
  }
  return out;
};
