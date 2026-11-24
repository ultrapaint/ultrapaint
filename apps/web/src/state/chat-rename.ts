/**
 * The chat whose title is being edited in place on its row of the list (ADR 0141), from the
 * row's right-click menu: one at a time, none while nothing is being renamed.
 */
import { create } from "zustand";

interface ChatRenameStore {
  /** Stops editing, the title as it was or as it was sent. */
  done: () => void;
  start: (threadId: string) => void;
  threadId: string | null;
}

export const useChatRename = create<ChatRenameStore>((set) => ({
  done: () => set({ threadId: null }),
  start: (threadId) => set({ threadId }),
  threadId: null,
}));
