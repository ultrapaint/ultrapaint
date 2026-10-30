import type { DesignNode } from "@ultrapaint/contracts/document";
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
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { canvasNodes, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { nodeFrameOf, viewFrameOf } from "../state/frame-ref.ts";
import { nodeFrameLayout } from "../state/page-layout.ts";
import { useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";
import { useFollowAgent } from "./agent-presence.tsx";
import { useFramesInView } from "./camera.ts";
import { CanvasGround } from "./canvas-ground.tsx";
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
  beginDrag,
  cancelDrag,
  canvasPoint,
  endDrag,
  LIBRARY_MIME,
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
import { addImages, imageFiles } from "./items.ts";
import { holdsFree } from "./snap.ts";

/**
 * The page canvas: the pages' frames and their views, and the nodes beside the pages, on the
 * ground the camera moves (`CanvasGround`). Only the frames near the screen have a preview
 * mounted. What a tool draws, a drag from the Library or the desktop, and a pasted image land
 * here; its ground has a menu of its own.
 */
export const Canvas = () => {
  useFollowAgent();
  const ref = useRef<HTMLDivElement>(null);
  const frames = useEditor((s) => s.frames);
  const canvas = useEditor((s) => s.canvas);
  const mode = useEditor((s) => s.mode);
  const spacePan = useEditor((s) => s.spacePan);
  const allPages = useProject((s) => s.pages);
  const pages = allPages.filter((p) => p.canvas === canvas);
  const nodes = useDocuments((s) => canvasNodes(s.docs, canvas));
  const [size, setSize] = useState({ height: 0, width: 0 });
  // Virtualisation: only the frames near the screen have a preview mounted.
  const inView = useFramesInView(size);

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
      const component = types.includes(LIBRARY_MIME);
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
      const raw = e.dataTransfer?.getData(LIBRARY_MIME);
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

  // A canvas that goes away mid-gesture leaves nothing listening to the window.
  useEffect(
    () => () => {
      cancelGesture();
    },
    []
  );

  /** The Group and Text tools draw what they make; a press anywhere else is the ground's. */
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button === 0 && isCreateTool(mode)) {
      e.preventDefault();
      if (!ensureEditable()) {
        return;
      }
      beginCreate(e.clientX, e.clientY, holdsFree(e));
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: ReactPointerEvent, panning: boolean) => {
    lastPointer.current = canvasPoint(e.clientX, e.clientY);
    if (!panning && isCreateTool(mode) && !spacePan && !isFollowing()) {
      moveCreate(e.clientX, e.clientY, holdsFree(e));
      hoverCreate(e.clientX, e.clientY);
    }
  };

  const onPointerUp = () => {
    if (isCreateTool(mode) && useCreate.getState().from) {
      endCreate(mode);
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

  // Where a tool would put something is shown only while the pointer is over the canvas.
  const onPointerLeave = () => {
    if (!useCreate.getState().from) {
      cancelCreate();
    }
  };

  return (
    <CanvasGround
      background="page"
      cursor={
        (mode === "group" && "cursor-crosshair [&_*]:cursor-crosshair!") ||
        (mode === "text" && "cursor-text [&_*]:cursor-text!")
      }
      groundRef={ref}
      onContextMenu={onContextMenu}
      onPointerCancel={cancelCreate}
      onPointerDown={onPointerDown}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onSize={setSize}
      overlay={pages.length === 0 && nodes.length === 0 && <EmptyState />}
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
    </CanvasGround>
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
        onDragStart={onDragStart}
        visible={visible}
      />
    );
  }
);
NodeFrame.displayName = "NodeFrame";
