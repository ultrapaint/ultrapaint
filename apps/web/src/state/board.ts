/**
 * The board view (ADR 0045, B4): the main area showing the item picked in Design system or the
 * Library as boards, generated documents drawn as frames on a canvas of their own. It is a view
 * of the canvas workspace, not a third workspace: the page canvas is put aside as it was (its
 * camera, its selection, its tool and the left panel shown) and found again on leaving.
 *
 * While a board view is open the editor's camera is the board's: `useEditor.view`, moved by
 * `camera.ts` as on the page canvas, and the frames it fits and zooms to the boards', laid out
 * here (`showBoards`, `setBoardSize`, by `board-layout.ts`) and read through the board surface
 * (`surface.ts`). The page's camera waits here, and so does the camera each item was left at.
 * What is picked on a board is the board's own (B6), kept per item; the page's selection is not
 * touched by it.
 *
 * The URL says where (`?view=system&item=color`, `url.ts`): opening a board view from the page
 * is a navigation, which back walks; going from item to item replaces it.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import {
  type AppComponentFile,
  componentDocOf,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { create } from "zustand";
import {
  APP_DEFAULT_BOARD,
  appBoardName,
  appInPlace,
  appVariantOfBoard,
  appVariantsOf,
} from "../boards/library-boards.ts";
import {
  boardLayout,
  boardRoom,
  firstBoardView,
  wrappedBoards,
} from "../lib/board-layout.ts";
import { setView, type View, viewportSize } from "./camera.ts";
import { appComponentOf, useComponents } from "./components.ts";
import type { useDocuments } from "./documents.ts";
import {
  type LeftTab,
  type Mode,
  railTabs,
  type Selection,
  unpicked,
  useEditor,
} from "./editor.ts";
import { boardFrameOf, frameRefOf } from "./frame-ref.ts";
import { isolate, leaveIsolation, useIsolation } from "./isolation.ts";
import { type BoardUrl, onUrlChange, readUrl, writeBoard } from "./url.ts";
import type { Picked } from "./workspace-memory.ts";

type BoardView = "system" | "library";

const VIEWS: readonly BoardView[] = ["system", "library"];

/** Where a board view is: which one, and the item it shows. */
export interface BoardPlace {
  readonly item: string;
  readonly view: BoardView;
}

/** What is picked on a board: a node of one of its frames, named for what it stands for. */
export interface BoardPick {
  readonly frame: string;
  readonly nodeId: string;
}

/** How an item's boards are laid out: in a row, in a column, or in rows as wide as the canvas. */
type BoardDirection = "row" | "column" | "wrap";

interface Size {
  readonly height: number;
  readonly width: number;
}

/** The page canvas as a board view found it, put back on leaving. */
interface Left {
  readonly leftTab: LeftTab;
  readonly mode: Mode;
  readonly picked: Picked;
  readonly view: View;
}

interface BoardStore {
  /** The boards of the item open, by frame id, and how they are laid out: the board canvas says. */
  boards: {
    readonly direction: BoardDirection;
    readonly ids: readonly string[];
  };
  /** The camera each item was left at, by `boardKey`. */
  cameras: Readonly<Record<string, View>>;
  /**
   * The item opened for the first time and the camera it was opened with, until its boards are
   * measured and fitted between the panels; null once they are, or the camera was moved.
   */
  fitting: { readonly key: string; readonly view: View } | null;
  /** Where the boards of the item open are, by frame id: laid out from their sizes. */
  frames: Readonly<Record<string, Box>>;
  /** A guideline's text as it is typed in its inspector, drawn on its board until it is saved. */
  guideDraft: { readonly item: string; readonly text: string } | null;
  /** The item each view showed last, which its button opens again. */
  last: Readonly<Partial<Record<BoardView, string>>>;
  /** The page canvas, while a board view is open. */
  left: Left | null;
  /** The board view open; null on the page canvas. */
  open: BoardPlace | null;
  /** What is picked on each item's boards, by `boardKey`. */
  picks: Readonly<Record<string, BoardPick>>;
  /** Each board's size as its frame drew it, by frame id. */
  sizes: Readonly<Record<string, Size>>;
  /** The theme the boards are drawn in; null for the design's first. */
  theme: string | null;
}

const NO_BOARDS: BoardStore["boards"] = { direction: "column", ids: [] };

export const useBoard = create<BoardStore>(() => ({
  boards: NO_BOARDS,
  cameras: {},
  fitting: null,
  frames: {},
  guideDraft: null,
  last: {},
  left: null,
  open: null,
  picks: {},
  sizes: {},
  theme: null,
}));

/** The variant a board of the app component open draws; undefined for no board of it. */
const appBoardOf = (frame: string) => {
  const at = frameRefOf(frame);
  const { open } = useBoard.getState();
  const file =
    at.kind === "board" && open?.view === at.view && open.item === at.item
      ? appOpen(open)
      : undefined;
  if (!(at.kind === "board" && file)) {
    return;
  }
  const variants = appVariantsOf(file);
  const variant = appVariantOfBoard(at.name);
  const known =
    variants.length === 0
      ? at.name === APP_DEFAULT_BOARD
      : variants.some((v) => appBoardName(v) === at.name);
  return known ? { file, variant } : undefined;
};

/**
 * Whether a frame of the board view takes a selection: an app component's board, whose tree is
 * edited in place there (ADR 0045). Nothing else of a board view is selected.
 */
export const boardTakesSelection = (frame: string) =>
  appBoardOf(frame) !== undefined;

/**
 * What is selected in an app component's board (from Layers, or a node of its tree) is edited in
 * place there: the board's instance is isolated, what was selected kept.
 */
export const editSelectedOnBoard = (frame: string) => {
  if (useIsolation.getState().isolated?.frame === frame) {
    return;
  }
  const board = appBoardOf(frame);
  if (!board) {
    return;
  }
  const { instance, variant } = appInPlace(board.file, board.variant);
  isolate(frame, instance, { select: false, variant });
};

/** An item's key among the cameras and the picks. */
const boardKey = (place: BoardPlace) => `${place.view}/${place.item}`;

/** The item a view opens on the first time: Color, and the Library's Overview. */
export const FIRST_ITEM: Readonly<Record<BoardView, string>> = {
  library: "overview",
  system: "color",
};

/** The left panel a board view is navigated from. */
const PANEL_OF: Readonly<Record<BoardView, LeftTab>> = {
  library: "library",
  system: "designSystem",
};

/** The tools a board has: no group, no text and no comment is drawn on one. */
export const BOARD_MODES: readonly Mode[] = ["select", "interact", "pan"];

const boardMode = (mode: Mode): Mode =>
  BOARD_MODES.includes(mode) ? mode : "select";

/** The app component a board view shows, when it shows one. */
const appOpen = (open: BoardPlace | null): AppComponentFile | undefined => {
  const file =
    open?.view === "library"
      ? appComponentOf(useComponents.getState().components, open.item)
      : undefined;
  return file?.origin === "app" ? file : undefined;
};

/** The rail's places on a board view: Layers only where there is a tree, an app component's. */
export const railTabsFor = (open: BoardPlace | null): readonly LeftTab[] =>
  open && !appOpen(open)
    ? railTabs.filter((tab) => tab !== "layers")
    : railTabs;

/**
 * The tree an app component's board view shows in Layers, and the board it is selected in: the
 * one it is edited in place on, else its first variant's. Null on any other board view.
 */
export const boardTree = (
  open: BoardPlace | null,
  docs: ReturnType<typeof useDocuments.getState>["docs"]
): { readonly frame: string; readonly root: DesignNode } | null => {
  const file = appOpen(open);
  if (!(open && file)) {
    return null;
  }
  const { isolated } = useIsolation.getState();
  const [first = null] = appVariantsOf(file);
  const frame =
    isolated?.component === file.name
      ? isolated.frame
      : boardFrameOf({ ...open, name: appBoardName(first) });
  return {
    frame,
    root: docs[componentDocOf(file.name)]?.root ?? file.tree,
  };
};

/**
 * Where an item's boards begin the first time it is opened, before they are measured: from the
 * seen part's corner, at 100%. Once they are, `fitFirstView` fits them between the panels.
 */
const firstView = (): View => firstBoardView([], viewportSize());

/** How a move writes the URL: an entry of its own, in the entry's place, or not at all (back). */
type History = "push" | "replace" | "none";

/**
 * Opens a board view on `place`, the page canvas put aside the first time; from one item to
 * another, the camera each was left at is kept. The prototype gives way to it, and an app
 * component edited in place is left.
 */
export const openBoard = (place: BoardPlace, history: History = "push") => {
  if (useEditor.getState().workspace !== "design") {
    useEditor.getState().setWorkspace("design");
  }
  const board = useBoard.getState();
  const was = board.open;
  if (was && boardKey(was) === boardKey(place)) {
    useEditor.setState({ leftTab: PANEL_OF[place.view] });
    return;
  }
  // Left before the page is put aside: the instance it was entered from is what is selected.
  // From item to item, a tree edited in place on a board is left with its board.
  leaveIsolation();
  const now = useEditor.getState();
  const left: Left = board.left ?? {
    leftTab: now.leftTab,
    mode: now.mode,
    picked: {
      also: now.also,
      selectedPage: now.selectedPage,
      selection: now.selection,
    },
    view: now.view,
  };
  const cameras = was
    ? { ...board.cameras, [boardKey(was)]: now.view }
    : board.cameras;
  const saved = cameras[boardKey(place)];
  const view = saved ?? firstView();
  useBoard.setState({
    boards: NO_BOARDS,
    cameras,
    fitting: saved ? null : { key: boardKey(place), view },
    frames: {},
    last: { ...board.last, [place.view]: place.item },
    left,
    open: place,
  });
  useEditor.setState({
    ...unpicked,
    leftTab: PANEL_OF[place.view],
    mode: boardMode(now.mode),
  });
  setView(view);
  if (history !== "none") {
    writeBoard(place, history === "push" && was === null);
  }
};

/** The left panel the page is found with: Design system's list is a board view's. */
const tabOnPage = (tab: LeftTab, view: BoardView): LeftTab => {
  if (tab !== "designSystem") {
    return tab;
  }
  return view === "library" ? "library" : "chat";
};

/** The board view closed, its item's camera kept; what the page was left with is the answer. */
const close = (): { left: Left | null; view: BoardView } | null => {
  const { cameras, left, open } = useBoard.getState();
  if (!open) {
    return null;
  }
  leaveIsolation();
  useBoard.setState({
    boards: NO_BOARDS,
    cameras: { ...cameras, [boardKey(open)]: useEditor.getState().view },
    frames: {},
    left: null,
    open: null,
  });
  return { left, view: open.view };
};

/** Back to the page canvas as the board view found it: its camera, its selection, its tool. */
export const leaveBoard = (history: History = "push") => {
  const closed = close();
  if (!closed) {
    return;
  }
  const { left, view } = closed;
  if (left) {
    useEditor.setState({
      ...left.picked,
      leftTab: tabOnPage(left.leftTab, view),
      mode: left.mode,
    });
    setView(left.view);
  }
  if (history !== "none") {
    writeBoard(null, history === "push");
  }
};

/**
 * What is selected on the page canvas: what the page was left with while a board view is open
 * (a look takes its content from it), the selection itself otherwise; the node the inspector shows
 * first.
 */
export const pageSelectionLeft = (): readonly Selection[] => {
  const { also, selection } =
    useBoard.getState().left?.picked ?? useEditor.getState();
  return selection ? [selection, ...also] : [];
};

/** Picks a node of a board of the item open, or lets the pick go. */
export const pickOnBoard = (pick: BoardPick | null) => {
  const { open, picks } = useBoard.getState();
  if (!open) {
    return;
  }
  const key = boardKey(open);
  if (pick) {
    useBoard.setState({ picks: { ...picks, [key]: pick } });
  } else if (key in picks) {
    const { [key]: _gone, ...rest } = picks;
    useBoard.setState({ picks: rest });
  }
};

/** What is picked on the item open; null when nothing is, or no board view is open. */
export const pickOf = (s: BoardStore): BoardPick | null =>
  s.open ? (s.picks[boardKey(s.open)] ?? null) : null;

const sameBox = (x: Box | undefined, y: Box) =>
  x !== undefined &&
  x.x === y.x &&
  x.y === y.y &&
  x.width === y.width &&
  x.height === y.height;

/**
 * Lays the boards out from what they are and their sizes (`board-layout.ts`), the same object kept
 * while no box moves; the first time an item is opened, once every board says its size, they are
 * fitted between the panels.
 */
const layOut = () => {
  const { boards, frames, sizes } = useBoard.getState();
  const laid =
    boards.direction === "wrap"
      ? wrappedBoards(boards.ids, sizes, boardRoom(viewportSize()))
      : boardLayout(boards.ids, sizes, boards.direction);
  // A board that did not move keeps its box, and is not drawn again for another's size.
  let moved = Object.keys(frames).length !== Object.keys(laid).length;
  const next: Record<string, Box> = {};
  for (const [id, box] of Object.entries(laid)) {
    const was = frames[id];
    if (was && sameBox(was, box)) {
      next[id] = was;
    } else {
      next[id] = box;
      moved = true;
    }
  }
  if (moved) {
    useBoard.setState({ frames: next });
  }
  // A board says nothing of its size before it has drawn: 0 by 0 is not its size yet.
  if (
    boards.ids.length > 0 &&
    boards.ids.every((id) => {
      const size = sizes[id];
      return size !== undefined && size.width > 0 && size.height > 0;
    })
  ) {
    fitFirstView();
  }
};

/** The boards the item open draws, by frame id, in order, and how they are laid out. */
export const showBoards = (
  ids: readonly string[],
  direction: BoardDirection
) => {
  const { boards } = useBoard.getState();
  if (
    boards.direction !== direction ||
    boards.ids.length !== ids.length ||
    boards.ids.some((id, i) => ids[i] !== id)
  ) {
    useBoard.setState({ boards: { direction, ids } });
  }
  layOut();
};

/** A board's size as its frame drew it: the boards are laid out again when it changed. */
export const setBoardSize = (frame: string, size: Size) => {
  const { sizes } = useBoard.getState();
  const known = sizes[frame];
  if (known?.width === size.width && known.height === size.height) {
    return;
  }
  useBoard.setState({ sizes: { ...sizes, [frame]: size } });
  layOut();
};

/**
 * The boards of the item open measured, the first time it is opened: every one fitted between
 * the panels, unless the camera was moved meanwhile.
 */
const fitFirstView = () => {
  const { fitting, frames, open } = useBoard.getState();
  if (!(fitting && open && fitting.key === boardKey(open))) {
    return;
  }
  useBoard.setState({ fitting: null });
  const now = useEditor.getState().view;
  const { view } = fitting;
  if (now.x === view.x && now.y === view.y && now.zoom === view.zoom) {
    setView(firstBoardView(Object.values(frames), viewportSize()));
  }
};

/** A guideline's text drawn on its board as it is typed; null once it is saved or let go. */
export const setGuideDraft = (draft: BoardStore["guideDraft"]) =>
  useBoard.setState({ guideDraft: draft });

/** The theme the boards are drawn in; null for the design's first. */
export const setBoardTheme = (theme: string | null) =>
  useBoard.setState({ theme });

/** The board view a URL names, its item the view's first when it names none. */
export const placeOfUrl = (url: BoardUrl | null): BoardPlace | null => {
  const view = VIEWS.find((v) => v === url?.view);
  return view ? { item: url?.item ?? FIRST_ITEM[view], view } : null;
};

/** Opens the board view the URL names, if it names one: a reload or a link lands on it. */
export const openBoardInUrl = () => {
  const place = placeOfUrl(readUrl().board);
  if (place) {
    openBoard(place, "replace");
  }
};

/**
 * Follows the browser's back and forward buttons to a board view and from it, until the answer
 * is called: the URL says it already, so nothing is written.
 */
export const followBoardHistory = (): (() => void) =>
  onUrlChange((url) => {
    const place = placeOfUrl(url.board);
    if (place) {
      openBoard(place, "none");
    } else {
      leaveBoard("none");
    }
  });

/**
 * The prototype shows the page: a board view open gives way to it, and what the page was left
 * with is what the canvas is found with when the prototype is left.
 */
const giveWayToPrototype = () => {
  const closed = close();
  if (!closed) {
    return;
  }
  const { left, view } = closed;
  if (left) {
    useEditor.setState((s) => ({
      leftTab: tabOnPage(left.leftTab, view),
      memory: {
        modes: { ...s.memory.modes, design: left.mode },
        putAside: left.picked,
      },
    }));
    setView(left.view);
  }
  writeBoard(null, false);
};

/**
 * Starts the board view following the editor: the prototype opened closes it. The app starts it,
 * as a test that needs it does; the answer stops it.
 */
export const startBoardView = (): (() => void) =>
  useEditor.subscribe((now, before) => {
    if (now.workspace === "prototype" && before.workspace !== "prototype") {
      giveWayToPrototype();
    }
  });
