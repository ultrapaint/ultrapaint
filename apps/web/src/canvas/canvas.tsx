import type { DesignNode } from "@ultrapaint/contracts/document";
import type { FrameLayout } from "@ultrapaint/contracts/pages";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
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
} from "../state/documents.ts";
import { allFrames, nodeFrameLayout, useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { useFollowAgent } from "./agent-presence.tsx";
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
  moveDrag,
  PALETTE_MIME,
  useDrag,
} from "./drag.ts";
import { CreateOverlay, DragOverlay } from "./drag-overlay.tsx";
import { Frame, useHostUrl } from "./frame.tsx";
import { addImages, imageFiles } from "./items.ts";

const clampZoom = (z: number) => Math.min(4, Math.max(0.05, z));

export const Canvas = () => {
  useFollowAgent();
  const ref = useRef<HTMLDivElement>(null);
  const view = useEditor((s) => s.view);
  const frames = useEditor((s) => s.frames);
  const space = useEditor((s) => s.space);
  const mode = useEditor((s) => s.mode);
  const spacePan = useEditor((s) => s.spacePan);
  const allPages = useProject((s) => s.pages);
  const pages = allPages.filter((p) => p.space === space);
  const nodes = useDocuments((s) => canvasNodes(s.docs, space));
  const sizes = useEditor((s) => s.sizes);
  // A node on the canvas being dragged is drawn where the pointer holds it.
  const dragged = useDrag((s) => s.dragged);
  const pointer = useDrag((s) => s.pointer);
  const grab = useDrag((s) => s.grab);
  const hostUrl = useHostUrl();
  const [size, setSize] = useState({ height: 0, width: 0 });
  const [panning, setPanning] = useState(false);
  // The size a node on the canvas is being resized to, until the pointer lets go.
  const [resizing, setResizingState] = useState<{
    height: number;
    id: string;
    width: number;
  } | null>(null);
  const resizingRef = useRef<typeof resizing>(null);
  const setResizing = (next: typeof resizing) => {
    resizingRef.current = next;
    setResizingState(next);
  };
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; vx: number; vy: number }
    | {
        kind: "move" | "resize";
        pageId: string;
        startX: number;
        startY: number;
        frame: FrameLayout;
      }
    | {
        /** Resizing a node on the canvas gives it a fixed size. */
        kind: "resize-node";
        nodeId: string;
        startX: number;
        startY: number;
        size: { height: number; width: number };
      }
    | null
  >(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() =>
      setSize({ height: el.clientHeight, width: el.clientWidth })
    );
    ro.observe(el);
    setSize({ height: el.clientHeight, width: el.clientWidth });
    return () => ro.disconnect();
  }, []);

  // Wheel: pan, or zoom with ctrl/meta (pinch gestures arrive with ctrlKey).
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      // A comment thread scrolls itself, unless it is a pinch, which still zooms.
      if (
        !(e.ctrlKey || e.metaKey) &&
        (e.target as Element | null)?.closest("[data-canvas-scroll]")
      ) {
        return;
      }
      e.preventDefault();
      const s = useEditor.getState();
      const { x, y, zoom } = s.view;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const next = clampZoom(
          zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))
        );
        const k = next / zoom;
        s.setView({ x: cx - (cx - x) * k, y: cy - (cy - y) * k, zoom: next });
      } else {
        s.setView({ x: x - e.deltaX, y: y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // The layout as saved: what an undo put back, what an agent or a branch switch changed.
  useEffect(
    () =>
      api().on("canvas", ({ layout, space: changed }) =>
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

  // A component from the palette, or image files from the desktop.
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const onDragOver = (e: DragEvent) => {
      const types = e.dataTransfer?.types ?? [];
      const component = types.includes(PALETTE_MIME);
      if (!(e.dataTransfer && (component || types.includes("Files")))) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (component) {
        if (!useDrag.getState().dragged) {
          beginDrag({ kind: "new", name: "" }, e.clientX, e.clientY, false);
        }
        moveDrag(e.clientX, e.clientY, false);
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
      const raw = e.dataTransfer?.getData(PALETTE_MIME);
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
      beginCreate(e.clientX, e.clientY);
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
    drag.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      vx: view.x,
      vy: view.y,
    };
  };

  // Stable identity (only touches refs and the store) so memoized Frames skip re-rendering while panning.
  const startFrameDrag = (
    e: ReactPointerEvent,
    pageId: string,
    kind: "move" | "resize"
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
      if (kind === "move") {
        beginDrag(
          {
            frame: pageId,
            kind: "loose",
            nodeId,
            origin: { x: box.x, y: box.y },
          },
          e.clientX,
          e.clientY,
          e.altKey
        );
        const move = (ev: PointerEvent) =>
          moveDrag(ev.clientX, ev.clientY, ev.altKey);
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          endDrag();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return;
      }
      ref.current?.setPointerCapture(e.pointerId);
      drag.current = {
        kind: "resize-node",
        nodeId,
        size: { height: box.height, width: box.width },
        startX: e.clientX,
        startY: e.clientY,
      };
      return;
    }
    const frame = s.frames[pageId];
    if (!frame) {
      return;
    }
    ref.current?.setPointerCapture(e.pointerId);
    drag.current = {
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
        moveCreate(e.clientX, e.clientY);
        hoverCreate(e.clientX, e.clientY);
      }
      return;
    }
    const s = useEditor.getState();
    const { zoom } = s.view;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    if (d.kind === "pan") {
      s.setView({
        x: d.vx + (e.clientX - d.startX),
        y: d.vy + (e.clientY - d.startY),
      });
    } else if (d.kind === "resize-node") {
      s.setSize(nodeFrameOf(d.nodeId), {
        height: Math.max(8, d.size.height + dy),
        width: Math.max(8, d.size.width + dx),
      });
      setResizing({
        height: Math.max(8, Math.round(d.size.height + dy)),
        id: d.nodeId,
        width: Math.max(8, Math.round(d.size.width + dx)),
      });
    } else if (d.kind === "move") {
      const others = Object.entries(s.frames)
        .filter(([id]) => id !== d.pageId)
        .map(([, f]) => f);
      const snapped = snap(
        { ...d.frame, x: d.frame.x + dx, y: d.frame.y + dy },
        others,
        8 / zoom,
        e.shiftKey
      );
      s.setFrame(d.pageId, snapped, false);
    } else {
      s.setFrame(
        d.pageId,
        {
          ...d.frame,
          height: Math.max(120, d.frame.height + dy),
          preset: "custom",
          width: Math.max(120, d.frame.width + dx),
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
      const resized = resizingRef.current;
      setResizing(null);
      const { space: current } = useEditor.getState();
      if (resized && current !== null) {
        applyOps(
          canvasDocOf(current),
          [
            {
              id: d.nodeId,
              op: "update",
              set: { height: resized.height, width: resized.width },
            },
          ],
          "Resize"
        );
      }
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

  // Virtualisation: only mount iframes near the viewport.
  const margin = 400;
  const isVisible = (f: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    const left = f.x * view.zoom + view.x;
    const top = f.y * view.zoom + view.y;
    const right = left + f.width * view.zoom;
    const bottom = top + f.height * view.zoom;
    return (
      right > -margin &&
      bottom > -margin &&
      left < size.width + margin &&
      top < size.height + margin
    );
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the canvas is the pointer's; its menu is on the context menu key too.
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-background",
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
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--border) 1px, transparent 1px)",
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${Math.max(12, 24 * view.zoom)}px ${Math.max(12, 24 * view.zoom)}px`,
      }}
    >
      <div
        className="absolute top-0 left-0"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {pages.map((page) => {
          const frame = frames[page.id];
          if (!frame) {
            return null;
          }
          return (
            <Frame
              frame={frame}
              frameId={page.id}
              hostUrl={hostUrl}
              key={page.id}
              kind="page"
              onDragStart={startFrameDrag}
              page={page}
              visible={isVisible(frame)}
              zoom={view.zoom}
            />
          );
        })}
        {nodes.map((node) => {
          const frameId = nodeFrameOf(node.id);
          const layout = nodeFrameLayout(node, sizes[frameId]);
          const moving =
            dragged?.kind === "loose" && dragged.frame === frameId
              ? { x: pointer.x - grab.x, y: pointer.y - grab.y }
              : null;
          const box = {
            ...layout,
            ...(resizing?.id === node.id && {
              height: resizing.height,
              width: resizing.width,
            }),
            ...moving,
          };
          return (
            <Frame
              frame={box}
              frameId={frameId}
              hostUrl={hostUrl}
              key={frameId}
              kind="node"
              onDragStart={startFrameDrag}
              visible={isVisible(box)}
              zoom={view.zoom}
            />
          );
        })}
        <DragOverlay zoom={view.zoom} />
        <CreateOverlay zoom={view.zoom} />
      </div>
      {pages.length === 0 && nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground">
          {space === null
            ? "Open a space from the Pages panel"
            : "This space has no pages yet"}
        </div>
      )}
    </div>
  );
};

const isTyping = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  );
};

const snap = (
  f: FrameLayout,
  others: FrameLayout[],
  threshold: number,
  disabled: boolean
): FrameLayout => {
  if (disabled) {
    return f;
  }
  let { x, y } = f;
  const xs = others.flatMap((o) => [
    o.x,
    o.x + o.width,
    o.x - f.width,
    o.x + o.width - f.width,
  ]);
  const ys = others.flatMap((o) => [
    o.y,
    o.y + o.height,
    o.y - f.height,
    o.y + o.height - f.height,
  ]);
  for (const c of xs) {
    if (Math.abs(c - x) < threshold) {
      x = c;
    }
  }
  for (const c of ys) {
    if (Math.abs(c - y) < threshold) {
      y = c;
    }
  }
  return { ...f, x, y };
};
