import type { DesignNode } from "@ultrapaint/contracts/document";
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
import { isTyping } from "../lib/keys.ts";
import { nextView, setViewSoon } from "../state/camera.ts";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useComments } from "../state/comments.ts";
import { openMenuAt } from "../state/context-menu.ts";
import {
  canvasNodes,
  nodeFrameOf,
  useDocuments,
  viewFrameOf,
} from "../state/documents.ts";
import { nodeFrameLayout, useEditor } from "../state/editor.ts";
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
import { Frame } from "./frame.tsx";
import {
  beginFrameGesture,
  cancelGesture,
  isFollowing,
} from "./frame-gesture.ts";
import { fromFrame } from "./from-frame.ts";
import { addImages, imageFiles } from "./items.ts";
import { holdsFree } from "./snap.ts";

const clampZoom = (z: number) => Math.min(4, Math.max(0.05, z));

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
  /** The canvas being panned by the pointer: where it was pressed and where the view was then. */
  const panFrom = useRef<{
    startX: number;
    startY: number;
    vx: number;
    vy: number;
  } | null>(null);

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

  // A component from the Library, or image files from the desktop.
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

  // Escape puts back whatever the pointer is doing: a frame moved or sized, a drag, a marquee, a
  // group being drawn (the tool stays picked). It goes no further then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && cancelGesture()) {
        e.preventDefault();
        e.stopImmediatePropagation();
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
    panFrom.current = {
      startX: e.clientX,
      startY: e.clientY,
      vx: from.x,
      vy: from.y,
    };
  };

  // A canvas that goes away mid-gesture leaves nothing listening to the window.
  useEffect(
    () => () => {
      cancelGesture();
    },
    []
  );

  const onPointerMove = (e: ReactPointerEvent) => {
    lastPointer.current = canvasPoint(e.clientX, e.clientY);
    const p = panFrom.current;
    if (p) {
      setViewSoon({
        x: p.vx + (e.clientX - p.startX),
        y: p.vy + (e.clientY - p.startY),
      });
    } else if (isCreateTool(mode) && !spacePan && !isFollowing()) {
      moveCreate(e.clientX, e.clientY, holdsFree(e));
      hoverCreate(e.clientX, e.clientY);
    }
  };

  const onPointerUp = () => {
    if (isCreateTool(mode) && useCreate.getState().from) {
      endCreate(mode);
      return;
    }
    panFrom.current = null;
    setPanning(false);
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

  // A group or a text being drawn is dropped; a pan stops where it is.
  const onPointerCancel = () => {
    cancelCreate();
    panFrom.current = null;
    setPanning(false);
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
                    onDragStart={beginFrameGesture}
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
              onDragStart={beginFrameGesture}
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
