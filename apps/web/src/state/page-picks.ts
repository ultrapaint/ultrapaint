/**
 * Pages picked together in the Pages panel with ⌘ or Shift, so a menu acts on all of them at
 * once: copied or moved into another canvas as one step. A pick is of the open canvas only.
 */
import { create } from "zustand";

interface PagePicks {
  clear: () => void;
  /** Page ids, in the order they were picked. */
  ids: readonly string[];
  set: (ids: readonly string[]) => void;
  /** Adds the page, or takes it out when it is picked already. */
  toggle: (id: string) => void;
}

export const usePagePicks = create<PagePicks>((set) => ({
  clear: () => set({ ids: [] }),
  ids: [],
  set: (ids) => set({ ids }),
  toggle: (id) =>
    set((s) => ({
      ids: s.ids.includes(id) ? s.ids.filter((i) => i !== id) : [...s.ids, id],
    })),
}));

/** The pages a page's menu acts on: every pick when it is one of them, itself otherwise. */
export const pagesActedOn = (pageId: string): readonly string[] => {
  const { ids } = usePagePicks.getState();
  return ids.includes(pageId) ? ids : [pageId];
};
