/**
 * The pointer in a frame in select and comment mode: hover, click and double-click, a press that
 * becomes a drag or a marquee, a right-click's menu, and a comment placed where the page is
 * clicked.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import {
  childrenOf,
  isContainer,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { useComments } from "../state/comments.ts";
import { holdMenu, openMenuAt, showMenu } from "../state/context-menu.ts";
import { nodeIn, rootOfFrame, useDocuments } from "../state/documents.ts";
import { selectForMenu, useEditor } from "../state/editor.ts";
import { isSelected, selectedIn } from "../state/selection.ts";
import { stepInto } from "../state/tree.ts";
import {
  beginDrag,
  cancelDrag,
  type Dragged,
  endDrag,
  moveDrag,
  useDrag,
} from "./drag.ts";
import { frameOf } from "./editor-frame.ts";
import { drawingMarquee } from "./frame-gesture.ts";
import { hitUnlocked } from "./hit-test.ts";
import { holdsFree } from "./snap.ts";

/** How far the pointer travels before a press becomes a drag, in screen pixels. */
const DRAG_THRESHOLD = 4;

/** The node a drag carries, when it carries one that is already in a document. */
const draggedId = (target: Dragged): string | null => {
  if (target.kind === "node") {
    return target.node.id;
  }
  return target.kind === "loose" ? target.nodeId : null;
};

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

/**
 * Forgets what the pointer hovers over in a frame: the pointer left the frame, or the layer it
 * hovered over went away under it.
 */
export const leaveHover = (frameId: string) => {
  const s = useEditor.getState();
  if (s.hover?.frame === frameId) {
    s.setHover(null);
  }
};

/** The pointer's handlers for a frame's select and comment layers, and the marquee being drawn. */
export const useFramePointer = ({
  canvas,
  frame,
  frameId,
  kind,
  root,
}: {
  canvas: string | null;
  /** Where the frame is on the canvas, which a node dragged off it starts from. */
  frame: { x: number; y: number };
  frameId: string;
  kind: "page" | "node";
  root: DesignNode | null;
}) => {
  // Pointer interaction in select mode.
  const lastHit = useRef(0);
  /**
   * The select layer taken away under a resting pointer (Space held, another mode) sends no
   * pointerleave, and the hover would stay drawn: the layer calls this as it goes.
   */
  const onSelectLayerGone = () => leaveHover(frameId);
  const toFrame = (e: ReactPointerEvent | ReactMouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // The zoom the frame is drawn at: read when the pointer acts, so a zoom redraws no frame.
    const { zoom } = useEditor.getState().view;
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const currentRoot = () =>
    rootOfFrame(
      useDocuments.getState().docs,
      useEditor.getState().canvas,
      frameId
    );
  /** The node a pointer event at this position means, given what is selected. */
  const nodeAt = (e: ReactPointerEvent | ReactMouseEvent) => {
    const { x, y } = toFrame(e);
    const chain = hitUnlocked(frameId, x, y);
    const [selected = null] = selectedIn(frameId);
    return stepInto(chain, currentRoot(), selected, e.altKey);
  };
  const onMove = (e: ReactPointerEvent) => {
    const now = performance.now();
    if (now - lastHit.current < 40) {
      return;
    }
    lastHit.current = now;
    const id = nodeAt(e);
    const store = useEditor.getState();
    if (id) {
      store.setHover({ frame: frameId, nodeId: id });
    } else if (store.hover?.frame === frameId) {
      store.setHover(null);
    }
  };
  const select = (id: string) =>
    useEditor.getState().select({ frame: frameId, nodeId: id });
  const selectFrame = () => {
    const store = useEditor.getState();
    if (kind === "page") {
      store.selectPage(frameId);
    } else if (root && !root.locked) {
      store.select({ frame: frameId, nodeId: root.id });
    } else {
      store.select(null);
    }
  };
  const onClick = (e: ReactMouseEvent) => {
    // Keyboard activation (Enter/Space) has no pointer position to hit-test: it only picks
    // the frame, which is also what a click on nothing inside it means.
    if (e.detail === 0) {
      selectFrame();
      return;
    }
    const id = nodeAt(e);
    if (id && e.shiftKey) {
      useEditor.getState().toggleSelected({ frame: frameId, nodeId: id });
    } else if (id) {
      select(id);
    } else {
      selectFrame();
    }
  };
  const onDoubleClick = (e: ReactMouseEvent) => {
    const { x, y } = toFrame(e);
    // Text is edited where it is written, whatever the two clicks before this selected.
    const id = hitUnlocked(frameId, x, y).at(-1);
    const node = id
      ? nodeIn(useDocuments.getState().docs, canvas, frameId, id)
      : null;
    if (id && node?.type === "text") {
      select(id);
      frameOf(frameId).editText(id);
    }
  };

  /**
   * What a press or a right-click here is about: what is selected, when the point is inside
   * it, else what a click would select.
   */
  const pickAt = (x: number, y: number, alt: boolean) => {
    const chain = hitUnlocked(frameId, x, y);
    const [selected = null] = selectedIn(frameId);
    return selected !== null && chain.includes(selected)
      ? selected
      : stepInto(chain, currentRoot(), selected, alt);
  };

  /**
   * What a press here picks up if it turns into a drag: what `pickAt` says. On a node placed on
   * the canvas, its root is the node itself, and dragging it moves it around the canvas.
   */
  const dragTarget = (x: number, y: number, alt: boolean): Dragged | null => {
    const id = pickAt(x, y, alt);
    const store = useEditor.getState();
    const current = currentRoot();
    if (!(id && current)) {
      return null;
    }
    if (kind === "node" && id === current.id) {
      return {
        frame: frameId,
        kind: "loose",
        nodeId: id,
        origin: { x: frame.x, y: frame.y },
      };
    }
    if (id === current.id) {
      return null;
    }
    const rect = frameOf(frameId).measure([id])[id];
    const node = nodeIn(
      useDocuments.getState().docs,
      store.canvas,
      frameId,
      id
    );
    if (!(rect && node)) {
      return null;
    }
    return { frame: frameId, kind: "node", node, rect };
  };

  // A press that travels becomes a drag; one that does not stays a click.
  const press = useRef<{
    x: number;
    y: number;
    /** Where it began in the frame, for a marquee. */
    at: { x: number; y: number };
    last: { x: number; y: number; alt: boolean; free: boolean };
    target: Dragged | null;
  } | null>(null);
  /**
   * A drag from the page itself, or from a container that is not selected, draws a marquee in
   * it, as in Figma: a selected node, or a text, a picture or a component, is dragged instead.
   */
  const [marquee, setMarquee] = useState<Rect | null>(null);
  /** The marquee as the pointer last drew it, which the next frame shows. */
  const marqueeTo = useRef<{ request: number; rect: Rect } | null>(null);
  const marqueeFrom = useRef<{ x: number; y: number } | null>(null);
  const marqueeIn = useRef<DesignNode | null>(null);
  const dragging = useRef<boolean>(false);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    dragging.current = false;
    const { x, y } = toFrame(e);
    press.current = {
      at: { x, y },
      last: { alt: e.altKey, free: holdsFree(e), x: e.clientX, y: e.clientY },
      target: dragTarget(x, y, e.altKey),
      x: e.clientX,
      y: e.clientY,
    };
    // The drag goes on over other frames and the empty canvas; the moves must still come here.
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p) {
      onMove(e);
      return;
    }
    p.last = {
      alt: e.altKey,
      free: holdsFree(e),
      x: e.clientX,
      y: e.clientY,
    };
    const from = marqueeFrom.current;
    if (from) {
      const to = toFrame(e);
      const rect = {
        height: Math.abs(to.y - from.y),
        width: Math.abs(to.x - from.x),
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
      };
      // Drawn once a frame, however often the pointer reports.
      const request =
        marqueeTo.current?.request ??
        requestAnimationFrame(() => {
          const drawn = marqueeTo.current;
          marqueeTo.current = null;
          if (drawn) {
            setMarquee(drawn.rect);
          }
        });
      marqueeTo.current = { rect, request };
      return;
    }
    if (dragging.current) {
      moveDrag(e.clientX, e.clientY, e.altKey, holdsFree(e));
      return;
    }
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) {
      return;
    }
    dragging.current = true;
    const { target } = p;
    if (!target) {
      if (kind === "page") {
        beginMarquee(currentRoot(), p.at);
      }
      return;
    }
    if (
      target.kind === "node" &&
      isContainer(target.node) &&
      !isSelected(frameId, target.node.id)
    ) {
      beginMarquee(target.node, p.at);
      return;
    }
    // What is dragged is what is selected, as it would be after a click on it.
    const id = draggedId(target);
    if (id && useEditor.getState().selection?.nodeId !== id) {
      select(id);
    }
    beginDrag(target, p.x, p.y, p.last.alt, p.last.free);
    moveDrag(p.last.x, p.last.y, p.last.alt, p.last.free);
  };
  /**
   * A marquee is drawn in `within` from `from`, until the pointer is let go or Escape puts it
   * away (`cancelGesture`), which leaves the selection as it was.
   */
  const beginMarquee = (
    within: DesignNode | null,
    from: { x: number; y: number }
  ) => {
    marqueeIn.current = within;
    marqueeFrom.current = from;
    drawingMarquee(() => {
      press.current = null;
      endMarquee(false);
    });
  };
  /** The marquee stops being drawn; whether it selects what it touches is `selects`. */
  const endMarquee = (selects: boolean) => {
    drawingMarquee(null);
    marqueeFrom.current = null;
    const waiting = marqueeTo.current;
    marqueeTo.current = null;
    if (waiting) {
      cancelAnimationFrame(waiting.request);
    }
    const drawn = waiting?.rect ?? marquee;
    setMarquee(null);
    if (drawn && selects) {
      selectInMarquee(drawn);
    } else {
      marqueeIn.current = null;
    }
  };
  const onPointerUp = () => {
    press.current = null;
    if (marqueeFrom.current) {
      endMarquee(true);
      return;
    }
    if (useDrag.getState().dragged) {
      endDrag();
    }
  };
  /**
   * The browser took the pointer away: what is dragged goes back where it was, as a node on the
   * canvas does, and a marquee selects nothing.
   */
  const onPointerCancel = () => {
    press.current = null;
    if (marqueeFrom.current) {
      endMarquee(false);
      return;
    }
    if (useDrag.getState().dragged) {
      cancelDrag();
    }
  };

  /**
   * What a marquee selects: the children of the container it was drawn in that it touches. When
   * it touches only one and does not cover it whole, that one's children instead: the way a
   * designer means the nodes the rectangle is drawn across.
   */
  const selectInMarquee = (area: Rect) => {
    const within = marqueeIn.current ?? currentRoot();
    marqueeIn.current = null;
    if (!within) {
      return;
    }
    let level = childrenOf(within);
    for (;;) {
      const measured = frameOf(frameId).measure(level.map((n) => n.id));
      const hits = level.filter((n) => {
        const r = measured[n.id];
        return r !== undefined && !n.locked && intersects(r, area);
      });
      const [only] = hits;
      const box = only ? measured[only.id] : undefined;
      // One child touched and not covered whole: what the rectangle is about is inside it.
      if (
        hits.length === 1 &&
        only &&
        box &&
        !contains(area, box) &&
        childrenOf(only).length > 0
      ) {
        level = childrenOf(only);
        continue;
      }
      useEditor
        .getState()
        .selectMany(hits.map((n) => ({ frame: frameId, nodeId: n.id })));
      return;
    }
  };
  const onSelectClick = (e: ReactMouseEvent) => {
    // The click that ends a drag is not a click.
    if (dragging.current) {
      dragging.current = false;
      return;
    }
    onClick(e);
  };

  /** Places a comment where the page was clicked, on the innermost node there. */
  const onPlaceComment = (e: ReactMouseEvent) => {
    if (kind !== "page") {
      return;
    }
    const { x, y } = toFrame(e);
    const comments = useComments.getState();
    if (!comments.visible) {
      comments.toggleVisible();
    }
    const id = frameOf(frameId).hitTest(x, y).at(-1);
    const node = id
      ? nodeIn(useDocuments.getState().docs, canvas, frameId, id)
      : null;
    const pinned = node && node.type !== "page" ? node : null;
    comments.setDraft({
      element: pinned ? nodeLabel(pinned) : null,
      nodeId: pinned?.id ?? null,
      pageId: frameId,
      x,
      y,
    });
  };

  /**
   * A right-click selects what it is on, as a click would, and opens that node's menu; on
   * nothing but the page, the page's. What is selected stays selected when it is clicked in.
   */
  const onContextMenu = (e: ReactMouseEvent) => {
    const anchor = holdMenu(e);
    const at = toFrame(e);
    const id = pickAt(at.x, at.y, e.altKey);
    const current = currentRoot();
    const store = useEditor.getState();
    if (id && current && (kind === "node" || id !== current.id)) {
      selectForMenu({ frame: frameId, nodeId: id });
      showMenu({ at, frame: frameId, kind: "node", nodeId: id }, anchor);
    } else if (kind === "page") {
      store.selectPage(frameId);
      showMenu({ at, kind: "page", pageId: frameId }, anchor);
    } else if (current) {
      selectForMenu({ frame: frameId, nodeId: current.id });
      showMenu(
        { at, frame: frameId, kind: "node", nodeId: current.id },
        anchor
      );
    }
  };
  const onCommentContextMenu = (e: ReactMouseEvent) => {
    useEditor.getState().selectPage(frameId);
    openMenuAt(e, { at: toFrame(e), kind: "page", pageId: frameId });
  };

  const onPointerLeave = () => leaveHover(frameId);

  return {
    marquee,
    onCommentContextMenu,
    onContextMenu,
    onDoubleClick,
    onPlaceComment,
    onPointerCancel,
    onPointerDown,
    onPointerLeave,
    onPointerMove,
    onPointerUp,
    onSelectClick,
    onSelectLayerGone,
  };
};
