/**
 * Whether the canvas shows its grid, and with it snaps what is placed on it. A preference of the
 * person rather than of the project: kept in the browser, as the comments' visibility is.
 */
import { create } from "zustand";
import { snapPoint } from "../canvas/snap.ts";

const VISIBLE_KEY = "ultrapaint:canvas-grid";

interface CanvasGridStore {
  toggle: () => void;
  visible: boolean;
}

export const useCanvasGrid = create<CanvasGridStore>((set, get) => ({
  toggle: () => {
    const visible = !get().visible;
    localStorage.setItem(VISIBLE_KEY, String(visible));
    set({ visible });
  },
  visible: localStorage.getItem(VISIBLE_KEY) === "true",
}));

/** Whether what is placed now snaps to the grid: it is shown, and `free` (⌘/Ctrl) is not held. */
export const snapsToGrid = (free = false) =>
  useCanvasGrid.getState().visible && !free;

/** Where a point placed on the canvas lands: on the grid when it snaps, on the pixel otherwise. */
export const placeOnCanvas = (p: { x: number; y: number }, free = false) =>
  snapsToGrid(free) ? snapPoint(p) : { x: Math.round(p.x), y: Math.round(p.y) };
