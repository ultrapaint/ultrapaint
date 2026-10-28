import type { DesignNode } from "@ultrapaint/contracts/document";
import type { FrameLayout } from "@ultrapaint/contracts/pages";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  type ComponentProps,
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { fromFrame, isTyping } from "../lib/keys.ts";
import { nextView, setViewSoon } from "../state/camera.ts";
import { snapsToGrid, useCanvasGrid } from "../state/canvas-grid.ts";
import { useComments } from "../state/comments.ts";
import { api } from "../state/connection.ts";
import { openMenuAt } from "../state/context-menu.ts";
import {
  applyOps,
  canvasNodes,
  isNodeFrame,
  NODE_FRAME_PREFIX,
  nodeFrameOf,
  useDocuments,
  viewFrameOf,
} from "../state/documents.ts";
import {
  allFrames,
  type Box,
  hold,
  holdUntil,
  nodeFrameLayout,
  useEditor,
} from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";
import { useFollowAgent } from "./agent-presence.tsx";
import { useCamera, useFramesInView } from "./camera.ts";
import {
  beginCreate,
  cancelCreate,
  endCreate,
  hoverCreate,
  isCreateTool,
  moveCreate,
  useCreate,
} from "./create-tool.ts";
import {
  ASSET_MIME,
  beginDrag,
  cancelDrag,
  canvasPoint,
  endDrag,
  landingPoint,
  moveDrag,
  useDrag,
} from "./drag.ts";
import { CreateOverlay, DragOverlay } from "./drag-overlay.tsx";
import { EmptyState } from "./empty-state.tsx";
import { type Corner, drawResized, Frame } from "./frame.tsx";
import { isFrameLocked } from "./hit-test.ts";
import { addImages, imageFiles } from "./items.ts";
import { holdsFree, snapBox, snapPoint, snapToEdges } from "./snap.ts";

const clampZoom = (z: number) => Math.min(4, Math.max(0.05, z));

interface PointerAt {
  altKey: boolean;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Drags a node on the canvas by its name, following the pointer on the window. A drag still
 * followed (its pointerup never came) is put back before this one begins: put back after, it
 * would take the new drag with it. `following` holds what puts the drag back.
 */
export const followLooseDrag = (
  following: { current: (() => void) | null },
  node: { frame: string; nodeId: string; origin: { x: number; y: number } },
  e: PointerAt
) => {
  following.current?.();
  beginDrag(
    { ...node, kind: "loose" },
    e.clientX,
    e.clientY,
    e.altKey,
    holdsFree(e)
  );
  const move = (ev: PointerEvent) =>
    moveDrag(ev.clientX, ev.clientY, ev.altKey, holdsFree(ev));
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    following.current = null;
  };
  const up = () => {
    stop();
    endDrag();
  };
  // The browser took the pointer away: the node goes back where it was.
  const cancel = () => {
    stop();
    cancelDrag();
  };
  following.current = cancel;
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
};

export const Canvas = () => {
  useFollowAgent();
  const ref = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const frames = useEditor((s) => s.frames);
  const canvas = useEditor((s) => s.canvas);
  const mode = useEditor((s) => s.mode);
  const spacePan = useEditor((s) => s.spacePan);
  const allPages = useProject((s) => s.pages);
  const pages = allPages.filter((p) => p.canvas === canvas);
  const nodes = useDocuments((s) => canvasNodes(s.docs, canvas));
  const grid = useCanvasGrid((s) => s.visible);
  const [size, setSize] = useState({ height: 0, width: 0 });
  const [panning, setPanning] = useState(false);
  // Virtualisation: only the frames near the screen have a preview mounted.
  const inView = useFramesInView(size);
  useCamera(ref, layer, grid);
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; vx: number; vy: number }
    | {
        kind: "move" | "resize";
        corner: Corner;
        pageId: string;
        startX: number;
        startY: number;
        frame: FrameLayout;
      }
    | {
        /** Resizing a node on the canvas gives it a fixed size. */
        kind: "resize-node";
        corner: Corner;
        nodeId: string;
        startX: number;
        startY: number;
        box: Box;
        /** The box it is resized to, once the pointer has moved. */
        to: Box | null;
      }
    | null
  >(null);

  // Where the canvas is in the window, read when it is laid out anyway: a wheel event reading it
  // would make the browser lay out again what the last zoom changed, once per event.
  const origin = useRef({ left: 0, top: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const rect = el.getBoundingClientRect();
      origin.current = { left: rect.left, top: rect.top };
      setSize({ height: el.clientHeight, width: el.clientWidth });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Wheel: pan, or zoom with ctrl/meta (pinch gestures arrive with ctrlKey).
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      // A comment thread scrolls itself, unless it is a pinch, which still zooms; so does a page
      // that takes input.
      if (
        !(e.ctrlKey || e.metaKey) &&
        ((e.target as Element | null)?.closest("[data-canvas-scroll]") ||
          fromFrame(e))
      ) {
        return;
      }
      e.preventDefault();
      const { x, y, zoom } = nextView();
      if (e.ctrlKey || e.metaKey) {
        const cx = e.clientX - origin.current.left;
        const cy = e.clientY - origin.current.top;
        const next = clampZoom(
          zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))
        );
        const k = next / zoom;
        setViewSoon({
          x: cx - (cx - x) * k,
          y: cy - (cy - y) * k,
          zoom: next,
        });
      } else {
        setViewSoon({ x: x - e.deltaX, y: y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // The layout as saved: what an undo put back, what an agent or a branch switch changed.
  useEffect(
    () =>
      api().on("canvas", ({ layout, canvas: changed }) =>
        useEditor.getState().applyLayout(changed, layout)
      ),
    []
  );

  // Where the pointer last was over the canvas: a pasted image lands there.
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  // A pasted image goes on the canvas, unless something that takes text has the focus.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const images = imageFiles(e.clipboardData?.files ?? null);
      if (
        images.length === 0 ||
        isTyping(e) ||
        useProject.getState().settingsOpen ||
        useEditor.getState().workspace === "prototype"
      ) {
        return;
      }
      e.preventDefault();
      const el = ref.current;
      const at =
        lastPointer.current ??
        (el
          ? canvasPoint(
              el.getBoundingClientRect().left + el.clientWidth / 2,
              el.getBoundingClientRect().top + el.clientHeight / 2
            )
          : { x: 0, y: 0 });
      addImages(images, at);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // A component from the Assets panel, or image files from the desktop.
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const onDragOver = (e: DragEvent) => {
      const types = e.dataTransfer?.types ?? [];
      const component = types.includes(ASSET_MIME);
      if (!(e.dataTransfer && (component || types.includes("Files")))) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (component) {
        if (!useDrag.getState().dragged) {
          beginDrag({ kind: "new", name: "" }, e.clientX, e.clientY, false);
        }
        moveDrag(e.clientX, e.clientY, false, holdsFree(e));
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (
        !el.contains(e.relatedTarget as Node | null) &&
        useDrag.getState().dragged?.kind === "new"
      ) {
        cancelDrag();
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const images = imageFiles(e.dataTransfer?.files ?? null);
      if (images.length > 0) {
        cancelDrag();
        addImages(images, canvasPoint(e.clientX, e.clientY));
        return;
      }
      const raw = e.dataTransfer?.getData(ASSET_MIME);
      if (raw) {
        endDrag(JSON.parse(raw) as DesignNode);
      } else {
        cancelDrag();
      }
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, []);

  // Leaving the Group or Text tool leaves nothing of it on the canvas.
  useEffect(() => {
    if (!isCreateTool(mode)) {
      cancelCreate();
    }
  }, [mode]);

  // Escape puts back whatever is being dragged.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useDrag.getState().dragged) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelDrag();
      }
      // A group being drawn is dropped; the tool stays picked.
      if (e.key === "Escape" && useCreate.getState().from) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelCreate();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    const store = useEditor.getState;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) {
        e.preventDefault();
        if (!store().spacePan) {
          store().setSpacePan(true);
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && store().spacePan) {
        store().setSpacePan(false);
      }
    };
    // A key released while the window is in the background never reaches keyup.
    const blur = () => store().setSpacePan(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    const pan = e.button === 1 || spacePan || mode === "pan";
    if (!pan && e.button === 0 && isCreateTool(mode)) {
      e.preventDefault();
      if (!ensureEditable()) {
        return;
      }
      beginCreate(e.clientX, e.clientY, holdsFree(e));
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (!pan) {
      if (e.target === e.currentTarget) {
        useEditor.getState().selectPage(null);
        useComments.getState().setDraft(null);
        useComments.getState().setOpen(null);
      }
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPanning(true);
    const from = nextView();
    drag.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      vx: from.x,
      vy: from.y,
    };
  };

  /** Puts back a node on the canvas being dragged by its name, and stops following the pointer. */
  const looseDrag = useRef<(() => void) | null>(null);
  // A canvas that goes away mid-drag leaves nothing listening to the window.
  useEffect(() => () => looseDrag.current?.(), []);

  // Stable identity (only touches refs and the store) so memoized Frames skip re-rendering while panning.
  const startFrameDrag = (
    e: ReactPointerEvent,
    pageId: string,
    kind: "move" | "resize",
    corner: Corner = "se"
  ) => {
    const s = useEditor.getState();
    // Let the event reach the canvas, which pans.
    if (e.button === 1 || s.spacePan || s.mode === "pan") {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (isNodeFrame(pageId)) {
      const nodeId = pageId.slice(NODE_FRAME_PREFIX.length);
      const box = allFrames()[pageId];
      if (!box) {
        return;
      }
      s.select({ frame: pageId, nodeId });
      // A locked node is picked up by its name, and stays where it is and the size it is.
      if (isFrameLocked(pageId)) {
        return;
      }
      if (kind === "move") {
        followLooseDrag(
          looseDrag,
          { frame: pageId, nodeId, origin: { x: box.x, y: box.y } },
          e
        );
        return;
      }
      ref.current?.setPointerCapture(e.pointerId);
      drag.current = {
        box,
        corner,
        kind: "resize-node",
        nodeId,
        startX: e.clientX,
        startY: e.clientY,
        to: null,
      };
      return;
    }
    const frame = s.frames[pageId];
    if (!frame) {
      return;
    }
    ref.current?.setPointerCapture(e.pointerId);
    drag.current = {
      corner,
      frame,
      kind,
      pageId,
      startX: e.clientX,
      startY: e.clientY,
    };
    s.selectPage(pageId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    lastPointer.current = canvasPoint(e.clientX, e.clientY);
    const d = drag.current;
    if (!d) {
      if (isCreateTool(mode) && !spacePan) {
        moveCreate(e.clientX, e.clientY, holdsFree(e));
        hoverCreate(e.clientX, e.clientY);
      }
      return;
    }
    const s = useEditor.getState();
    const { zoom } = s.view;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    // With the grid on, what is moved or resized snaps to it unless ⌘/Ctrl is held.
    const onGrid = snapsToGrid(holdsFree(e));
    if (d.kind === "pan") {
      setViewSoon({
        x: d.vx + (e.clientX - d.startX),
        y: d.vy + (e.clientY - d.startY),
      });
    } else if (d.kind === "resize-node") {
      const resized = resizeFrom(d.box, d.corner, dx, dy, 8, e.shiftKey);
      const next = roundBox(
        onGrid ? snapBox(resized, d.box, d.corner, 8, e.shiftKey) : resized
      );
      s.setSize(nodeFrameOf(d.nodeId), {
        height: next.height,
        width: next.width,
      });
      d.to = next;
      hold(nodeFrameOf(d.nodeId), next);
      // The preview draws it at that size too, or it would be cropped by its frame.
      drawResized(nodeFrameOf(d.nodeId), {
        height: next.height,
        width: next.width,
      });
    } else if (d.kind === "move") {
      const moved = { ...d.frame, x: d.frame.x + dx, y: d.frame.y + dy };
      s.setFrame(d.pageId, placeFrame(moved, d.pageId, onGrid, e), false);
    } else {
      const resized = resizeFrom(d.frame, d.corner, dx, dy, 120, e.shiftKey);
      s.setFrame(
        d.pageId,
        {
          ...d.frame,
          ...(onGrid
            ? snapBox(resized, d.frame, d.corner, 120, e.shiftKey)
            : resized),
          preset: "custom",
        },
        false
      );
    }
  };

  const onPointerUp = () => {
    if (isCreateTool(mode) && useCreate.getState().from) {
      endCreate(mode);
      return;
    }
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (d?.kind === "resize-node") {
      const frame = nodeFrameOf(d.nodeId);
      const { canvas: current } = useEditor.getState();
      const resized = d.to;
      if (!resized || current === null) {
        hold(frame, null);
        return;
      }
      const { height, width, x, y } = resized;
      // The box stays where it was let go until the document has it, then the document draws it.
      holdUntil(frame, resized, () =>
        applyOps(
          canvasDocOf(current),
          [{ id: d.nodeId, op: "update", set: { height, width, x, y } }],
          "Resize"
        )
      ).then(() => drawResized(frame));
      return;
    }
    if (d && d.kind !== "pan") {
      const s = useEditor.getState();
      const f = s.frames[d.pageId];
      if (f) {
        s.setFrame(d.pageId, {
          ...f,
          height: Math.round(f.height),
          width: Math.round(f.width),
          x: Math.round(f.x),
          y: Math.round(f.y),
        });
      }
    }
  };

  /**
   * The empty canvas has a menu of its own. Anywhere else the browser's is kept away too — the
   * frames and pins open theirs before this — but not from a field, where it pastes and spells.
   */
  const onContextMenu = (e: ReactMouseEvent) => {
    if (isTyping(e.nativeEvent)) {
      return;
    }
    if (e.target === e.currentTarget && !spacePan && mode !== "pan") {
      openMenuAt(e, { at: canvasPoint(e.clientX, e.clientY), kind: "canvas" });
    } else {
      e.preventDefault();
    }
  };

  const onPointerCancel = () => {
    cancelCreate();
    onPointerUp();
  };
  // Where a tool would put something is shown only while the pointer is over the canvas.
  const onPointerLeave = () => {
    if (!useCreate.getState().from) {
      cancelCreate();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the canvas is the pointer's; its menu is on the context menu key too.
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-canvas",
        // Frame chrome sets its own cursors; while panning the hand wins everywhere.
        (spacePan || mode === "pan") && "cursor-grab [&_*]:cursor-grab!",
        !spacePan &&
          mode === "group" &&
          "cursor-crosshair [&_*]:cursor-crosshair!",
        !spacePan && mode === "text" && "cursor-text [&_*]:cursor-text!",
        panning && "cursor-grabbing! [&_*]:cursor-grabbing!"
      )}
      data-canvas
      onContextMenu={onContextMenu}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      ref={ref}
    >
      {/* Moved by the camera, not by rendering: see `useCamera`. */}
      <div
        className="absolute top-0 left-0"
        ref={layer}
        style={{ transformOrigin: "0 0" }}
      >
        {pages.flatMap((page) => {
          const frame = frames[page.id];
          if (!frame) {
            return [];
          }
          // The page's frame, then each of its views: the page drawn again (ADR 0036).
          const ids = [
            page.id,
            ...(frame.views ?? []).map((v) => viewFrameOf(page.id, v.id)),
          ];
          return ids.flatMap((id) => {
            const box = frames[id];
            return box
              ? [
                  <Frame
                    frame={box}
                    frameId={id}
                    key={id}
                    kind="page"
                    onDragStart={startFrameDrag}
                    page={page}
                    visible={inView.has(id)}
                  />,
                ]
              : [];
          });
        })}
        {nodes.map((node) => {
          const frameId = nodeFrameOf(node.id);
          return (
            <NodeFrame
              frameId={frameId}
              key={frameId}
              node={node}
              onDragStart={startFrameDrag}
              visible={inView.has(frameId)}
            />
          );
        })}
        <DragOverlay />
        <CreateOverlay />
      </div>
      {pages.length === 0 && nodes.length === 0 && <EmptyState />}
    </div>
  );
};

/** Where a dragged node on the canvas is drawn: where the pointer holds it; null when not dragged. */
const movingTo = (
  s: ReturnType<typeof useDrag.getState>,
  frameId: string,
  grid: boolean
) =>
  s.dragged?.kind === "loose" && s.dragged.frame === frameId
    ? landingPoint(s.pointer, s.grab, s.free, grid)
    : null;

/**
 * A node placed on the canvas, in its own frame. Its box is made here, from what concerns this
 * node alone, so it stays the same object while the canvas pans and the frame is not redrawn.
 */
const NodeFrame = memo(
  ({
    frameId,
    node,
    onDragStart,
    visible,
  }: {
    frameId: string;
    node: DesignNode;
    onDragStart: ComponentProps<typeof Frame>["onDragStart"];
    visible: boolean;
  }) => {
    const size = useEditor((s) => s.sizes[frameId]);
    const held = useEditor((s) => s.held[frameId]);
    const grid = useCanvasGrid((s) => s.visible);
    const movingX = useDrag((s) => movingTo(s, frameId, grid)?.x ?? null);
    const movingY = useDrag((s) => movingTo(s, frameId, grid)?.y ?? null);
    const box = {
      ...nodeFrameLayout(node, size),
      ...held,
      ...(movingX !== null && movingY !== null && { x: movingX, y: movingY }),
    };
    return (
      <Frame
        frame={box}
        frameId={frameId}
        kind="node"
        onDragStart={onDragStart}
        visible={visible}
      />
    );
  }
);
NodeFrame.displayName = "NodeFrame";

/**
 * The box left once `corner` is dragged by (dx, dy): the opposite corner stays where it was, and
 * neither side goes under `min`. Keeping the ratio (Shift), the side the pointer moved further
 * decides.
 */
export const resizeFrom = (
  box: Box,
  corner: Corner,
  dx: number,
  dy: number,
  min: number,
  keepRatio: boolean
): Box => {
  const west = corner.endsWith("w");
  const north = corner.startsWith("n");
  let width = Math.max(min, box.width + (west ? -dx : dx));
  let height = Math.max(min, box.height + (north ? -dy : dy));
  if (keepRatio) {
    const sx = width / box.width;
    const sy = height / box.height;
    const k = Math.max(
      Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy,
      min / Math.min(box.width, box.height)
    );
    width = box.width * k;
    height = box.height * k;
  }
  return {
    height,
    width,
    x: west ? box.x + box.width - width : box.x,
    y: north ? box.y + box.height - height : box.y,
  };
};

const roundBox = (b: Box): Box => ({
  height: Math.round(b.height),
  width: Math.round(b.width),
  x: Math.round(b.x),
  y: Math.round(b.y),
});

/**
 * Where a page frame being moved goes: on the grid when it snaps, otherwise against the edges of
 * the frames around it, unless Shift or ⌘/Ctrl is held.
 */
export const placeFrame = (
  f: FrameLayout,
  pageId: string,
  onGrid: boolean,
  e: Pick<ReactPointerEvent, "ctrlKey" | "metaKey" | "shiftKey">
): FrameLayout => {
  if (onGrid) {
    return { ...f, ...snapPoint(f) };
  }
  if (e.shiftKey || holdsFree(e)) {
    return f;
  }
  const s = useEditor.getState();
  const others = Object.entries(s.frames)
    .filter(([id]) => id !== pageId)
    .map(([, o]) => o);
  return snapToEdges(f, others, 8 / s.view.zoom);
};
