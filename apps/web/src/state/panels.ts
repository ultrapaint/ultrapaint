import { create } from "zustand";
import { type LeftTab, useEditor } from "./editor.ts";

/**
 * Whether the side panels are put away, for a clear look at the canvas. A preference of this
 * browser, like the panels' widths, so it is kept here rather than in the settings file. Each
 * side is put away on its own: the canvas with the right panel away is the agent's view, with
 * only the chat beside it. The rail stays whatever is hidden: it is the way back.
 */
const LEFT_KEY = "ultrapaint:panel-hidden:left";
const RIGHT_KEY = "ultrapaint:panel-hidden:right";

export interface Hidden {
  left: boolean;
  right: boolean;
}

/**
 * What ⌘\ leaves hidden: while any panel can be seen, every panel goes; once none can, every one
 * comes back. A right panel the workspace does not show counts as out of sight already.
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
  toggleAll: () =>
    get().setHidden(
      toggledAll(get(), useEditor.getState().workspace === "design")
    ),
  toggleLeft: () => get().setHidden({ left: !get().left }),
  toggleRight: () => get().setHidden({ right: !get().right }),
}));

/** Opens a left panel, bringing the panel back when it was put away. */
export const openLeftPanel = (tab: LeftTab) => {
  useEditor.getState().setLeftTab(tab);
  if (usePanels.getState().left) {
    usePanels.getState().setHidden({ left: false });
  }
};
