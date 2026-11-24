/**
 * The lines a page's frame being moved by its name snapped to (ADR 0138): state of the gesture,
 * put here as it moves (`followFrame`) and taken away when it no longer snaps, is let go or put
 * back. `snap-overlay` draws them.
 */
import { create } from "zustand";
import type { SnapGuide } from "./snap.ts";

export const useSnapGuides = create<{ guides: readonly SnapGuide[] }>(() => ({
  guides: [],
}));

/** The frame now snaps to these; none, when it does not snap. */
export const showSnapGuides = (guides: readonly SnapGuide[]) => {
  if (guides.length === 0 && useSnapGuides.getState().guides.length === 0) {
    return;
  }
  useSnapGuides.setState({ guides });
};

/** The gesture is over: no line is left. */
export const clearSnapGuides = () => showSnapGuides([]);
