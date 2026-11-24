/**
 * The chat whose title is being edited in place on its row of the list (ADR 0141), from the
 * row's right-click menu: one at a time, none while nothing is being renamed.
 */
import { create } from "zustand";

interface ChatRenameStore {
  /**
   * Stops editing, the title as it was or as it was sent. Ended by Enter or Escape, the keyboard
   * goes back to the chat's row (`refocus`); ended by a click elsewhere, it stays where it went.
   */
  done: (refocus?: boolean) => void;
  /** The row the keyboard goes back to, once it is drawn again; null once it has. */
  refocus: string | null;
  start: (threadId: string) => void;
  threadId: string | null;
}

export const useChatRename = create<ChatRenameStore>((set) => ({
  done: (refocus = false) =>
    set((s) => ({ refocus: refocus ? s.threadId : null, threadId: null })),
  refocus: null,
  start: (threadId) => set({ refocus: null, threadId }),
  threadId: null,
}));
