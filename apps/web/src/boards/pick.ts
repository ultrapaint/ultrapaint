/**
 * What a board's node stands for, which a click picks (ADR 0045, B6): the grammar of the ids the
 * boards give those nodes, written by `pickId` and read by `pickOfId` alone. A board names a token
 * `token:color-primary-600`, a colour group's title `group:primary`, a text style `style:Body`, a
 * component's tile on the Library's Overview `item:Button` (a click opens it rather than picks
 * it), a cell of a system component's board for the place of the look it shows
 * (`cell:variant=outline:hover`, `cell:base:base` for the base) and an app component's board for
 * the variant it draws (`variant:tone=featured`). Every other node of a board picks nothing.
 * Pure.
 */
import {
  COMPONENT_STATES,
  type ComponentState,
  type LookPlace,
} from "@ultrapaint/contracts/components";

export type Pick =
  | { readonly kind: "token"; readonly name: string }
  | { readonly kind: "group"; readonly name: string }
  | { readonly kind: "style"; readonly name: string }
  | { readonly kind: "item"; readonly name: string }
  | { readonly kind: "cell"; readonly place: LookPlace }
  /** An app component's board, by its name: `tone=featured`, `component` for no choice. */
  | { readonly board: string; readonly kind: "variant" };

/** What of the design system a pick names, by name: a token, a colour group, a text style. */
export type DesignSystemPick = Extract<
  Pick,
  { kind: "token" | "group" | "style" }
>;

/** How the base, a cell's place without a member or a state, is written. */
const BASE = "base";

const cellText = ({ state, variant }: LookPlace) =>
  `${variant ? `${variant.axis}=${variant.member}` : BASE}:${state ?? BASE}`;

/** The place of the look a cell's id shows, after `cell:`; null when it is none. */
const placeOf = (rest: string): LookPlace | null => {
  const at = rest.lastIndexOf(":");
  if (at < 0) {
    return null;
  }
  const member = rest.slice(0, at);
  const state = rest.slice(at + 1);
  const known: ComponentState | null =
    COMPONENT_STATES.find((s) => s === state) ?? null;
  if (state !== BASE && known === null) {
    return null;
  }
  const eq = member.indexOf("=");
  return {
    state: known,
    variant:
      eq < 0
        ? null
        : { axis: member.slice(0, eq), member: member.slice(eq + 1) },
  };
};

/** The id a board gives the node that stands for `pick`. */
export const pickId = (pick: Pick): string => {
  switch (pick.kind) {
    case "cell":
      return `cell:${cellText(pick.place)}`;
    case "variant":
      return `variant:${pick.board}`;
    default:
      return `${pick.kind}:${pick.name}`;
  }
};

/** What a node of a board stands for, by its id; null for a node that picks nothing. */
export const pickOfId = (id: string): Pick | null => {
  const at = id.indexOf(":");
  if (at < 0) {
    return null;
  }
  const rest = id.slice(at + 1);
  const kind = id.slice(0, at);
  switch (kind) {
    case "token":
    case "group":
    case "style":
    case "item":
      return { kind, name: rest };
    case "variant":
      return { board: rest, kind };
    case "cell": {
      const place = placeOf(rest);
      return place ? { kind, place } : null;
    }
    default:
      return null;
  }
};

/** The id of a system component's cell showing a place of its look. */
export const cellId = (place: LookPlace) => pickId({ kind: "cell", place });

/** The place of the look a cell's id shows; null for any other node. */
export const placeOfCell = (id: string): LookPlace | null => {
  const pick = pickOfId(id);
  return pick?.kind === "cell" ? pick.place : null;
};

/** What of the design system a node's id names; null for anything else, or nothing. */
export const designSystemPickOf = (id: string): DesignSystemPick | null => {
  const pick = pickOfId(id);
  return pick?.kind === "token" ||
    pick?.kind === "group" ||
    pick?.kind === "style"
    ? pick
    : null;
};
