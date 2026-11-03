/**
 * What the main area of the canvas workspace is (ADR 0045): the page canvas, or a board view in
 * its place. Both are panned and zoomed by the one camera (`camera.ts`) over frames of their own,
 * and differ in what those frames are and what can be done there: the board view's frames are its
 * boards, it takes a selection only in an app component's tree, it has a few tools, its rail has
 * Layers only with a tree, its right panel is the inspector of what is picked, its ground is no
 * document and a press on it lets the pick go, and the commands that are about pages (their code,
 * their comments, the grid) are not offered there.
 *
 * Every module that asks "on a board?" asks the surface instead, which is the same question for
 * every caller, and a test sets a board view open to be on one (`openBoard`), nothing to import.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import { useMemo } from "react";
import {
  BOARD_MODES,
  type BoardPlace,
  boardTakesSelection,
  editSelectedOnBoard,
  pickOf,
  pickOnBoard,
  railTabsFor,
  useBoard,
} from "./board.ts";
import { useComments } from "./comments.ts";
import { type LeftTab, type Mode, railTabs, useEditor } from "./editor.ts";
import { pageCanvasFrames } from "./page-layout.ts";
import { selectPage } from "./selection.ts";

export interface Surface {
  /** Its ground: the page canvas's (its grid), or the board view's tinted dots. */
  readonly background: "page" | "board";
  /**
   * What Escape lets go of there before the selection (`stepBack` in `shortcuts.ts`): a board's
   * pick. Whether there was anything.
   */
  readonly escape: () => boolean;
  /** Every frame on it, by id: what fits, zooms, drops and reveals look at. */
  readonly frames: () => Record<string, Box>;
  /** Whether something dropped on the ground lands there: as a node beside the pages, or nowhere. */
  readonly groundDrops: boolean;
  /** The page canvas, or a board view. */
  readonly kind: "page" | "board";
  /** The tools it has. */
  readonly modes: readonly Mode[];
  /** Whether a command of `commands.ts`, by its id, is offered there, by the palette and its keys. */
  readonly offers: (commandId: string) => boolean;
  /** A press on the ground, on nothing: what is selected or picked is let go. */
  readonly onGroundPress: () => void;
  /**
   * The left panels it shows itself, as the components known now say (an app component's board
   * has Layers). The rail lists every place: one not shown here leads back to the page canvas.
   */
  readonly railTabs: () => readonly LeftTab[];
  /** The right panel: the page's tabs (Design, Code, Comments), or the inspector of the pick. */
  readonly rightPanel: "tabs" | "inspector";
  /** What a selection made in one of its frames does besides being made. */
  readonly selectedIn: (frame: string) => void;
  /** Whether a selection can be made in one of its frames. */
  readonly takesSelection: (frame: string) => boolean;
}

const MODES: readonly Mode[] = [
  "select",
  "group",
  "text",
  "interact",
  "pan",
  "comment",
];

const pageSurface: Surface = {
  background: "page",
  escape: () => false,
  // Read when asked: the layout's module is one this one's own imports lean on.
  frames: () => pageCanvasFrames(),
  groundDrops: true,
  kind: "page",
  modes: MODES,
  offers: (id) => {
    const panel = panelOf(id);
    return panel === null || railTabs.includes(panel);
  },
  onGroundPress: () => {
    selectPage(null);
    useComments.getState().setDraft(null);
    useComments.getState().setOpen(null);
  },
  railTabs: () => railTabs,
  rightPanel: "tabs",
  selectedIn: () => undefined,
  takesSelection: () => true,
};

/** The rail's place a `panel:<tab>` command shows; null for any other command. */
const panelOf = (id: string): LeftTab | null =>
  id.startsWith("panel:") ? (id.slice("panel:".length) as LeftTab) : null;

/** What a board view has nothing for: the pages' code, comments and grid, and the page tools. */
const NOT_ON_BOARDS = new Set([
  "right:code",
  "right:comments",
  "toggleComments",
  "grid",
]);

/** The board view open on `place`. */
const boardSurface = (place: BoardPlace): Surface => {
  const tabs = () => railTabsFor(place);
  return {
    background: "board",
    escape: () => {
      if (!pickOf(useBoard.getState())) {
        return false;
      }
      pickOnBoard(null);
      return true;
    },
    frames: () => ({ ...useBoard.getState().frames }),
    groundDrops: false,
    kind: "board",
    modes: BOARD_MODES,
    offers: (id) => {
      // A panel the board does not show is offered too: it leads back to the page canvas.
      if (panelOf(id) !== null) {
        return true;
      }
      if (id.startsWith("tool:")) {
        return BOARD_MODES.includes(id.slice("tool:".length) as Mode);
      }
      // Only a node of an app component's tree is ever selected there.
      if (id === "zoomSelection") {
        return useEditor.getState().selection !== null;
      }
      return !NOT_ON_BOARDS.has(id);
    },
    onGroundPress: () => pickOnBoard(null),
    railTabs: tabs,
    rightPanel: "inspector",
    selectedIn: editSelectedOnBoard,
    takesSelection: boardTakesSelection,
  };
};

const surfaceOf = (open: BoardPlace | null): Surface =>
  open ? boardSurface(open) : pageSurface;

/** The main area as it is now. */
export const surfaceNow = (): Surface => surfaceOf(useBoard.getState().open);

/** `surfaceNow` for a component: the same surface while the board view open is the same. */
export const useSurface = (): Surface => {
  const open = useBoard((s) => s.open);
  return useMemo(() => surfaceOf(open), [open]);
};

/** Every frame of the main area: the page canvas's pages and nodes, or the boards open. */
export const allFrames = (): Record<string, Box> => surfaceNow().frames();

/** Whether the page canvas is on screen: the canvas workspace, no board view in its place. */
export const onPageCanvas = () =>
  useEditor.getState().workspace === "design" && surfaceNow().kind === "page";
