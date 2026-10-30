/**
 * What is picked on a board, as a chip of the chat (ADR 0045, B11): a token, a colour group, a
 * text style, the foundation open when nothing is, a guideline, a component, a system component's
 * look at the cell picked, an app component at the variant picked or edited in place. The agent is
 * told what it is, what it is now and the file it is kept in (`boardPickText` on the server), so
 * no tool has to be asked. Pure: the stores' facts are given.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import {
  APP_FROM,
  type ComponentFile,
  componentFileOf,
} from "@ultrapaint/contracts/components";
import {
  DESIGN_MD_FILE,
  DESIGN_SYSTEM_FILE,
  type DesignDocument,
  type DesignSystem,
  type TextStyle,
} from "@ultrapaint/contracts/design-system";
import type { BoardAttachment } from "@ultrapaint/contracts/threads";
import { tokenOf } from "@ultrapaint/contracts/token-table";
import { firstTheme } from "../boards/board-nodes.ts";
import {
  appBoardName,
  appInPlace,
  appVariantOfBoard,
  OVERVIEW,
} from "../boards/library-boards.ts";
import { designSystemPickOf, pickOfId, placeOfCell } from "../boards/pick.ts";
import { isGuideline, systemItemName } from "../boards/system-boards.ts";
import type { BoardPick, BoardPlace } from "../state/board.ts";
import { frameRefOf } from "../state/frame-ref.ts";

/** What the stores know that a board's chip says. */
export interface BoardFacts {
  readonly catalogue: readonly ComponentMeta[];
  readonly components: readonly ComponentFile[];
  readonly designsDir: string;
  readonly document: DesignDocument | null;
  readonly ds: DesignSystem | null;
  /** The board an app component's tree is edited in place on; null when none is. */
  readonly editedOn: string | null;
}

/** A token's value in each theme: `light #2563eb, dark #60a5fa`, or the one value it has. */
const valuesOf = (ds: DesignSystem, name: string): string | undefined => {
  const token = tokenOf(ds, name);
  if (!token) {
    return;
  }
  const others = (ds.themes ?? []).slice(1).flatMap((theme) => {
    const value = token.values?.[theme];
    return value === undefined ? [] : [`${theme} ${value}`];
  });
  return others.length > 0
    ? [`${firstTheme(ds)} ${token.value}`, ...others].join(", ")
    : token.value;
};

/** A colour group's size and its first and last tokens. */
const groupOf = (ds: DesignSystem, name: string): string | undefined => {
  const tokens = ds.colors.find((g) => g.name === name)?.tokens ?? [];
  const [first] = tokens;
  const last = tokens.at(-1);
  if (!(first && last)) {
    return;
  }
  return tokens.length === 1
    ? `1 token, ${first.name}`
    : `${tokens.length} tokens, ${first.name} to ${last.name}`;
};

const STYLE_FIELDS: readonly [keyof TextStyle, string][] = [
  ["font", "font"],
  ["size", "size"],
  ["weight", "weight"],
  ["lineHeight", "line height"],
  ["tracking", "tracking"],
];

/** A text style's fields: `size 14px, weight 500`. */
const styleOf = (ds: DesignSystem, name: string): string | undefined => {
  const style = ds.typography.styles.find((s) => s.name === name);
  if (!style) {
    return;
  }
  const fields = STYLE_FIELDS.flatMap(([key, label]) =>
    style[key] === undefined ? [] : [`${label} ${String(style[key])}`]
  );
  return fields.length > 0 ? fields.join(", ") : undefined;
};

const withDetail = (
  chip: BoardAttachment,
  detail: string | undefined
): BoardAttachment => (detail ? { ...chip, detail } : chip);

/** Design system's chip: the token, group or text style picked, else the item open. */
const systemChip = (
  item: string,
  pick: BoardPick | null,
  facts: BoardFacts
): BoardAttachment => {
  const { designsDir, document, ds } = facts;
  if (isGuideline(item)) {
    return {
      file: document?.path ?? DESIGN_MD_FILE,
      kind: "board",
      name: systemItemName(item, document),
      pick: "guideline",
    };
  }
  const file = `${designsDir}/${DESIGN_SYSTEM_FILE}`;
  const picked = pick ? designSystemPickOf(pick.nodeId) : null;
  const of = (
    kind: BoardAttachment["pick"],
    name: string,
    detail: string | undefined
  ) => withDetail({ file, kind: "board", name, pick: kind }, detail);
  if (ds && picked?.kind === "token") {
    return of("token", picked.name, valuesOf(ds, picked.name));
  }
  if (ds && picked?.kind === "group") {
    return of("group", picked.name, groupOf(ds, picked.name));
  }
  if (ds && picked?.kind === "style") {
    return of("textStyle", picked.name, styleOf(ds, picked.name));
  }
  return of(
    "foundation",
    systemItemName(item, document),
    ds
      ? undefined
      : "no design system yet: the neutral one every design starts with"
  );
};

/** The variant an app component's chip is at: the board edited in place on, else the one picked. */
const appBoardPicked = (
  open: BoardPlace,
  pick: BoardPick | null,
  editedOn: string | null
): string | null => {
  const edited = editedOn ? frameRefOf(editedOn) : null;
  if (
    edited?.kind === "board" &&
    edited.view === open.view &&
    edited.item === open.item
  ) {
    return edited.name;
  }
  const picked = pick ? pickOfId(pick.nodeId) : null;
  return picked?.kind === "variant" ? picked.board : null;
};

/** The Library's chip: the component open, at the place or the variant picked. */
const libraryChip = (
  open: BoardPlace,
  pick: BoardPick | null,
  facts: BoardFacts
): BoardAttachment | null => {
  const { item } = open;
  const meta = facts.catalogue.find((c) => c.name === item);
  if (item === OVERVIEW || !meta) {
    return null;
  }
  const saved = facts.components.find((c) => c.name === item);
  const file = `${facts.designsDir}/${componentFileOf(item)}`;
  if (meta.importFrom === APP_FROM) {
    const board = appBoardPicked(open, pick, facts.editedOn);
    const variant = board ? appVariantOfBoard(board) : null;
    if (!variant) {
      return { file, kind: "board", name: item, pick: "appComponent" };
    }
    // The choice's default member is the component's own fields, not an override.
    const own =
      saved?.origin === "app" && appInPlace(saved, variant).variant === null;
    return withDetail(
      {
        file,
        kind: "board",
        name: item,
        pick: "appComponent",
        variant: appBoardName(variant),
      },
      own
        ? "its choice's default member: the component's own fields"
        : undefined
    );
  }
  const place = pick ? placeOfCell(pick.nodeId) : null;
  return withDetail(
    {
      file,
      kind: "board",
      name: item,
      pick: "systemComponent",
      ...(place?.variant && {
        variant: `${place.variant.axis}=${place.variant.member}`,
      }),
      ...(place?.state && { state: place.state }),
    },
    saved ? undefined : "in its default look: it has no file yet"
  );
};

/** The chip of what is picked on the board view open; null where there is nothing to tell. */
export const boardChipOf = (
  open: BoardPlace,
  pick: BoardPick | null,
  facts: BoardFacts
): BoardAttachment | null =>
  open.view === "system"
    ? systemChip(open.item, pick, facts)
    : libraryChip(open, pick, facts);

/** How a board's chip reads: `Button · variant=outline, hover`. */
export const boardChipLabel = (chip: BoardAttachment) => {
  const place = [chip.variant, chip.state].filter(Boolean).join(", ");
  return place ? `${chip.name} · ${place}` : chip.name;
};
