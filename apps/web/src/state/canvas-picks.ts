/**
 * Frames picked together on the page canvas, as a marquee drawn over its ground picks them
 * (`canvas/canvas-marquee.ts`), Figma's way: pages and nodes placed on the canvas, by their own
 * frame. One frame picked is the ordinary selection, the page or the node; several are picked here,
 * outlined on the canvas, moved together by any one's name, deleted together, and their pages are
 * the page picks a page's menu acts on (`page-picks.ts`). Once the marquee is let go, the inspector
 * shows their roots' fields as it shows several nodes selected, a value they differ on mixed, and
 * an edit there changes each (ADR 0121); while it is drawn they are only outlined. Any other
 * selection, another canvas or a press on the ground lets them go.
 */
import { create } from "zustand";
import { rootOfFrame, type useDocuments } from "./documents.ts";
import { type Selection, useEditor } from "./editor.ts";
import { frameRefOf, ownFrameOf } from "./frame-ref.ts";
import { usePagePicks } from "./page-picks.ts";
import { select, selectedPageNow, selectPage } from "./selection.ts";

interface CanvasPicks {
  /** Whether a marquee is still drawing them: picked, but not yet anything to inspect. */
  drawing: boolean;
  /** Frame ids, in the order they were picked: a page's own frame, or a node's on the canvas. */
  ids: readonly string[];
}

export const useCanvasPicks = create<CanvasPicks>(() => ({
  drawing: false,
  ids: [],
}));

const NONE: readonly string[] = [];

/** The frames picked together once the marquee is let go: none while one is drawn, or one alone. */
export const settledPicks = (s: CanvasPicks): readonly string[] =>
  s.drawing || s.ids.length < 2 ? NONE : s.ids;

/**
 * What the inspector edits of frames picked together: each one's root, a page's or a node's on
 * the canvas, in the order they were picked.
 */
export const pickedRoots = (
  ids: readonly string[],
  docs: ReturnType<typeof useDocuments.getState>["docs"],
  canvas: string | null
): Selection[] =>
  ids.flatMap((frame) => {
    const root = rootOfFrame(docs, canvas, frame);
    return root ? [{ frame, nodeId: root.id }] : [];
  });

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
  if (useEditor.getState().selection) {
    select(null);
  }
  setPicks(ids, true);
};

/**
 * Picks `ids`: one is selected as the canvas selects it (the page, or the node by its root), none
 * lets the selection go, several are picked together.
 */
export const pickFrames = (ids: readonly string[]) => {
  const [first] = ids;
  if (ids.length === 1 && first !== undefined) {
    setPicks([], false);
    const ref = frameRefOf(first);
    if (ref.kind === "node") {
      select({ frame: first, nodeId: ref.node });
    } else {
      selectPage(first);
    }
    return;
  }
  if (useEditor.getState().selection) {
    select(null);
  }
  setPicks(ids, false);
};

/**
 * The frames picked now, which a marquee drawn with Shift and a frame Shift- or ⌘/Ctrl-clicked add
 * to: the picks, or the one frame selected as a whole (a page, or a node on the canvas by its
 * root); none while what is selected is inside a frame.
 */
export const framesPickedNow = (): readonly string[] => {
  const { ids } = useCanvasPicks.getState();
  if (ids.length > 0) {
    return ids;
  }
  const { selection } = useEditor.getState();
  const page = selectedPageNow();
  if (page) {
    return [pickedFrameOf(page)];
  }
  const ref = selection ? frameRefOf(selection.frame) : null;
  return selection && ref?.kind === "node" && ref.node === selection.nodeId
    ? [selection.frame]
    : [];
};

/**
 * A frame Shift- or ⌘/Ctrl-clicked (ADR 0121): taken out of the frames picked now when it is one
 * of them, added to them when not. One left is the selection, as a click on its name makes it.
 */
export const togglePick = (frame: string) => {
  const id = pickedFrameOf(frame);
  const now = framesPickedNow();
  pickFrames(now.includes(id) ? now.filter((f) => f !== id) : [...now, id]);
};

/** Whether a click adds a frame to the frames picked, or takes it out: Shift or ⌘/Ctrl held. */
export const picksWith = (e: {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}) => e.shiftKey || e.metaKey || e.ctrlKey;

/**
 * Whether a click with Shift or ⌘/Ctrl inside frame `frame` adds it to the frames picked, or takes
 * it out: while frames are picked as wholes, unless it is the one frame selected, whose layers
 * that click still reaches (a Shift-click adds one, ⌘/Ctrl-click takes the innermost).
 */
export const picksInside = (frame: string): boolean => {
  const now = framesPickedNow();
  return (
    now.length > 1 || (now.length === 1 && now[0] !== pickedFrameOf(frame))
  );
};

/** Lets the picks go; whether there were any, for Escape. */
export const clearCanvasPicks = (): boolean => {
  if (useCanvasPicks.getState().ids.length === 0) {
    return false;
  }
  setPicks([], false);
  return true;
};

const setPicks = (ids: readonly string[], drawing: boolean) => {
  useCanvasPicks.setState({ drawing, ids });
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
    const selected = s.selection !== null && s.selection !== prev.selection;
    if (selected || s.canvas !== prev.canvas) {
      clearCanvasPicks();
    }
  });
