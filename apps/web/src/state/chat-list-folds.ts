/**
 * Which of the chat list's groups that fold are closed (ADR 0141): Settled until the person opens
 * it, Working open. Kept while the editor runs, so going into a chat and back leaves the list as
 * they left it.
 */
import { create } from "zustand";

interface FoldsStore {
  closed: Readonly<Record<string, boolean>>;
  toggle: (key: string) => void;
}

export const CLOSED_AT_FIRST: Readonly<Record<string, boolean>> = {
  settled: true,
};

export const useChatListFolds = create<FoldsStore>((set) => ({
  closed: CLOSED_AT_FIRST,
  toggle: (key) =>
    set((s) => ({ closed: { ...s.closed, [key]: !(s.closed[key] ?? false) } })),
}));
