/**
 * A snapshot opened to look at (ADR 0019). While one is open the editor shows the canvases,
 * pages and documents it kept instead of the files as they are, nothing is saved, and the
 * server's news about the files waits until the editor goes back to now.
 */
import type { SnapshotView } from "@ultrapaint/contracts/snapshots";
import { create } from "zustand";

interface SnapshotViewStore {
  /** Where the editor was when the snapshot was opened, to go back to. */
  live: {
    canvas: string | null;
    route: string;
    variant: string | null;
  } | null;
  view: SnapshotView | null;
}

export const useSnapshotView = create<SnapshotViewStore>(() => ({
  live: null,
  view: null,
}));

/** The snapshot on screen, or null when the editor shows the files as they are. */
export const viewedSnapshot = () => useSnapshotView.getState().view;
