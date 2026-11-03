/**
 * Frames picked together on the page canvas, as a marquee drawn over its ground picks them
 * (`canvas/canvas-marquee.ts`), Figma's way: pages and nodes placed on the canvas, by their own
 * frame. One frame picked is the ordinary selection, the page or the node; several are picked here,
 * outlined on the canvas, moved together by any one's name, deleted together, and their pages are
 * the page picks a page's menu acts on (`page-picks.ts`). Any other selection, another canvas or a
 * press on the ground lets them go.
 */
import { create } from "zustand";
import { useEditor } from "./editor.ts";
import { frameRefOf, ownFrameOf } from "./frame-ref.ts";
import { usePagePicks } from "./page-picks.ts";
import { select, selectPage } from "./selection.ts";

interface CanvasPicks {
  /** Frame ids, in the order they were picked: a page's own frame, or a node's on the canvas. */
  ids: readonly string[];
}

export const useCanvasPicks = create<CanvasPicks>(() => ({ ids: [] }));

/** The frame a frame id is picked by: a page's view picks the page. */
export const pickedFrameOf = (frame: string): string => ownFrameOf(frame);

/** Whether frame `id` (a page's view too) is one of several picked together. */
export const isPicked = (ids: readonly string[], id: string) =>
  ids.length > 1 && ids.includes(pickedFrameOf(id));

/**
 * Shows `ids` picked as a marquee is drawn, the selection let go, without making one frame the
 * selection yet: that is `pickFrames`, as the marquee is let go.
 */
export const showPicks = (ids: readonly string[]) => {
  if (useEditor.getState().selection || useEditor.getState().selectedPage) {
    select(null);
  }
  setPicks(ids);
};

/**
 * Picks `ids`: one is selected as the canvas selects it (the page, or the node by its root), none
 * lets the selection go, several are picked together.
 */
export const pickFrames = (ids: readonly string[]) => {
  const [first] = ids;
  if (ids.length === 1 && first !== undefined) {
    setPicks([]);
    const ref = frameRefOf(first);
    if (ref.kind === "node") {
      select({ frame: first, nodeId: ref.node });
    } else {
      selectPage(first);
    }
    return;
  }
  showPicks(ids);
};

/** Lets the picks go; whether there were any, for Escape. */
export const clearCanvasPicks = (): boolean => {
  if (useCanvasPicks.getState().ids.length === 0) {
    return false;
  }
  setPicks([]);
  return true;
};

const setPicks = (ids: readonly string[]) => {
  useCanvasPicks.setState({ ids });
  usePagePicks
    .getState()
    .set(
      ids.length > 1 ? ids.filter((id) => frameRefOf(id).kind === "page") : []
    );
};

/**
 * Lets the picks go when anything else is selected or another canvas is opened, until the answer
 * is called.
 */
export const startCanvasPicks = () =>
  useEditor.subscribe((s, prev) => {
    const selected =
      (s.selection !== null && s.selection !== prev.selection) ||
      (s.selectedPage !== null && s.selectedPage !== prev.selectedPage);
    if (selected || s.canvas !== prev.canvas) {
      clearCanvasPicks();
    }
  });
