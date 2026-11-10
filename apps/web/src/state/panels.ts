import type { Thread } from "@ultrapaint/contracts/threads";
import { useEffect, useEffectEvent } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useAgents } from "./agents.ts";
import { FIRST_ITEM, openBoard, useBoard } from "./board.ts";
import { useCanvasPicks } from "./canvas-picks.ts";
import {
  type LeftTab,
  type RightTab,
  type Selection,
  useEditor,
} from "./editor.ts";
import { toPageCanvas } from "./location.ts";
import { LOOK_ITEM } from "./look-page.ts";
import { surfaceNow } from "./surface.ts";

/**
 * Whether the side panels are put away, for a clear look at the canvas. A preference of this
 * browser, like the panels' widths, so it is kept here rather than in the settings file. Each
 * side is put away on its own: the canvas with the right panel away is the agent's view, with
 * only the chat beside it. The rail stays whatever is hidden: it is the way back.
 *
 * Showing a panel is one verb a side, which brings it back: `showRightPanel` a tab of the
 * inspector's side, `showLeftPanel` a tab of the rail's with what it is asked to show there (a
 * thread and its draft, a file's changes, a node to rename), which waits here until the panel
 * takes it up.
 */
const LEFT_KEY = "ultrapaint:panel-hidden:left";
const RIGHT_KEY = "ultrapaint:panel-hidden:right";

export interface Hidden {
  left: boolean;
  right: boolean;
}

/**
 * What ⌘\ leaves hidden: while any panel can be seen, every panel goes; once none can, every one
 * comes back. A right panel with nothing to show counts as out of sight already.
 */
const toggledAll = (hidden: Hidden, hasRight: boolean): Hidden => {
  const anyShown = !hidden.left || (hasRight && !hidden.right);
  return { left: anyShown, right: anyShown };
};

interface PanelsStore extends Hidden {
  setHidden: (hidden: Partial<Hidden>) => void;
  /** ⌘\: hides both side panels, or shows them again. */
  toggleAll: () => void;
  /** The left panel alone. */
  toggleLeft: () => void;
  /** The right panel alone: the inspector and the code. */
  toggleRight: () => void;
}

export const usePanels = create<PanelsStore>((set, get) => ({
  left: localStorage.getItem(LEFT_KEY) === "true",
  right: localStorage.getItem(RIGHT_KEY) === "true",
  setHidden: (hidden) => {
    if (hidden.left !== undefined) {
      localStorage.setItem(LEFT_KEY, String(hidden.left));
    }
    if (hidden.right !== undefined) {
      localStorage.setItem(RIGHT_KEY, String(hidden.right));
    }
    set(hidden);
  },
  toggleAll: () => get().setHidden(toggledAll(get(), rightHasSubject())),
  toggleLeft: () => get().setHidden({ left: !get().left }),
  toggleRight: () => get().setHidden({ right: !get().right }),
}));

/**
 * Whether the right panel has something to show (ADR 0058): on the canvas, a layer or a page
 * selected or several frames picked; on a board view, its inspector, which always has, except
 * on the look page (`boardInspected`). With nothing, the panel is not drawn at all, whether the
 * user put it away or not.
 */
const subjectOf = (
  editor: Pick<
    ReturnType<typeof useEditor.getState>,
    "selection" | "workspace"
  >,
  picks: number,
  board: boolean
) =>
  editor.workspace === "design" &&
  (editor.selection !== null || picks > 1 || board);

/** The look page's samples have nothing to inspect: the dials are on the left. */
const boardInspected = (open: ReturnType<typeof useBoard.getState>["open"]) =>
  open !== null && !(open.view === "system" && open.item === LOOK_ITEM);

export const rightHasSubject = () =>
  subjectOf(
    useEditor.getState(),
    useCanvasPicks.getState().ids.length,
    boardInspected(useBoard.getState().open)
  );

export const useRightSubject = () => {
  const editor = useEditor(
    useShallow((s) => ({
      selection: s.selection,
      workspace: s.workspace,
    }))
  );
  const picks = useCanvasPicks((s) => s.ids.length);
  const board = useBoard((s) => boardInspected(s.open));
  return subjectOf(editor, picks, board);
};

/**
 * What the left panel is asked to show: a tab, or a tab with what it is to show there. A thread in
 * the chat (by its id, or the thread itself when it was just created and has no transcript to
 * read) with the text its composer is to hold; a file in Changes; a node whose Layers row turns
 * into a name field.
 */
type LeftShown =
  | LeftTab
  | { readonly chat: string | Thread; readonly draft?: string }
  | { readonly changes: string }
  | { readonly layers: { readonly rename: Selection } };

/**
 * What a left panel was asked to show, until it takes it up: only the panel on screen is mounted,
 * and a thread's composer can be on screen before its draft is known (the server announces the
 * thread before it answers the request that created it).
 */
interface Requests {
  /** The file whose changes the Changes panel shows. */
  readonly diff: string | null;
  /** Prompt text for a thread's composer, by thread. */
  readonly drafts: Readonly<Record<string, string>>;
  /** The node whose Layers row turns into a name field. */
  readonly rename: Selection | null;
}

const useRequests = create<Requests>(() => ({
  diff: null,
  drafts: {},
  rename: null,
}));

/** A request, by what it asks of which panel. */
type Requested = "diff" | "rename" | { readonly draft: string };

type RequestOf<R extends Requested> = R extends "rename" ? Selection : string;

/** Takes up a request, once: what was asked for, or null when nothing is. */
export const takeRequest = <R extends Requested>(
  requested: R
): RequestOf<R> | null => {
  const requests = useRequests.getState();
  if (typeof requested === "object") {
    const draft = requests.drafts[requested.draft];
    if (draft === undefined) {
      return null;
    }
    const { [requested.draft]: _taken, ...drafts } = requests.drafts;
    useRequests.setState({ drafts });
    return draft as RequestOf<R>;
  }
  const which = requested as "diff" | "rename";
  const value = requests[which];
  if (value !== null) {
    useRequests.setState({ [which]: null });
  }
  return value as RequestOf<R> | null;
};

/**
 * A panel takes up its requests: the one waiting as it mounts, then each one while it is on
 * screen, from the moment it is `ready`.
 */
export const useRequest = <R extends Requested>(
  requested: R,
  onRequest: (value: RequestOf<R>) => void,
  ready = true
) => {
  const take = useEffectEvent(onRequest);
  const key = typeof requested === "object" ? requested.draft : requested;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key says which request it is.
  useEffect(() => {
    if (!ready) {
      return;
    }
    const check = () => {
      const value = takeRequest(requested);
      if (value !== null) {
        take(value);
      }
    };
    check();
    return useRequests.subscribe(check);
  }, [key, ready]);
};

/** Whether a left panel is the one on screen: its tab, on the canvas, the panel not put away. */
export const leftPanelShows = (tab: LeftTab) => {
  const { leftTab, workspace } = useEditor.getState();
  return (
    leftTab === tab && workspace === "design" && !usePanels.getState().left
  );
};

const tabOf = (shown: LeftShown): LeftTab => {
  if (typeof shown === "string") {
    return shown;
  }
  if ("chat" in shown) {
    return "chat";
  }
  return "changes" in shown ? "changes" : "layers";
};

/** A thread in the chat, its draft waiting for its composer. */
const showThread = async (chat: string | Thread, draft: string | undefined) => {
  const id = typeof chat === "string" ? chat : chat.id;
  if (draft) {
    useRequests.setState((s) => ({ drafts: { ...s.drafts, [id]: draft } }));
  }
  const agents = useAgents.getState();
  if (typeof chat !== "string") {
    agents.show(chat);
  } else if (!(agents.view === "thread" && agents.current === id)) {
    await agents.open(id);
  }
};

/**
 * The left panel `tab` on the canvas, and the main area beside it (ADR 0045): Design system's
 * list opens its board view, on the item it showed last; the Library's is the navigation of its
 * board view while one is open, and the insert list on the page; a place the board view has no
 * room for on the rail (Layers) is the page's.
 */
const showTab = (tab: LeftTab) => {
  const { last, open } = useBoard.getState();
  if (tab === "designSystem" || (tab === "library" && open)) {
    const view = tab === "library" ? "library" : "system";
    const item =
      open?.view === view ? open.item : (last[view] ?? FIRST_ITEM[view]);
    openBoard({ item, view });
    return;
  }
  if (open && !surfaceNow().railTabs().includes(tab)) {
    toPageCanvas();
  }
  useEditor.setState({ leftTab: tab });
};

/**
 * Shows a left panel with what it is asked to show, bringing the panel back when it was put
 * away. The left panels are the canvas's: one asked for from the prototype brings the canvas
 * back. A thread asked for opens in the chat, unless it is the one open; done once its transcript
 * is read.
 */
export const showLeftPanel = async (shown: LeftShown) => {
  useEditor.getState().setWorkspace("design");
  showTab(tabOf(shown));
  if (usePanels.getState().left) {
    usePanels.getState().setHidden({ left: false });
  }
  if (typeof shown === "string") {
    return;
  }
  if ("changes" in shown) {
    useRequests.setState({ diff: shown.changes });
  } else if ("layers" in shown) {
    useRequests.setState({ rename: shown.layers.rename });
  } else {
    await showThread(shown.chat, shown.draft);
  }
};

/**
 * The editor's two modes (ADR 0053): the page canvas, with its pages and what is placed on them,
 * or the design system, its foundations and components on boards. The mode is Design System while
 * a board view is open.
 */
export type EditorMode = "canvas" | "designSystem";

export const useEditorMode = (): EditorMode =>
  useBoard((s) => (s.open ? "designSystem" : "canvas"));

/**
 * Switches to `mode`: Design System opens its foundations where they were left; Canvas takes the
 * page canvas back as it was left, its camera, its selection and its panel, from the prototype too.
 */
export const showMode = async (mode: EditorMode) => {
  if (mode === "designSystem") {
    await showLeftPanel("designSystem");
    return;
  }
  useEditor.getState().setWorkspace("design");
  toPageCanvas();
};

/**
 * Shows a tab of the right panel, on the canvas, bringing the panel back when it was put away; it
 * is drawn while there is something to show in it.
 */
export const showRightPanel = (tab: RightTab) => {
  const editor = useEditor.getState();
  editor.setWorkspace("design");
  editor.setRightTab(tab);
  usePanels.getState().setHidden({ right: false });
};
