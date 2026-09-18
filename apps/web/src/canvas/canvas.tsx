import type { FrameLayout } from "@ultrapaint/contracts/pages";
import { cn } from "cn";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useComments } from "../state/comments.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { Frame, useHostUrl } from "./frame.tsx";

const clampZoom = (z: number) => Math.min(4, Math.max(0.05, z));

export const Canvas = () => {
  const ref = useRef<HTMLDivElement>(null);
  const view = useEditor((s) => s.view);
  const frames = useEditor((s) => s.frames);
  const space = useEditor((s) => s.space);
  const mode = useEditor((s) => s.mode);
  const spacePan = useEditor((s) => s.spacePan);
  const allPages = useProject((s) => s.pages);
  const pages = allPages.filter((p) => p.space === space);
  const hostUrl = useHostUrl();
  const [size, setSize] = useState({ height: 0, width: 0 });
  const [panning, setPanning] = useState(false);
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; vx: number; vy: number }
    | {
        kind: "move" | "resize";
        pageId: string;
        startX: number;
        startY: number;
        frame: FrameLayout;
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
    const d = drag.current;
    if (!d) {
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
    const d = drag.current;
    drag.current = null;
    setPanning(false);
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

  // Virtualisation: only mount iframes near the viewport.
  const margin = 400;
  const isVisible = (f: FrameLayout) => {
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
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-background",
        // Frame chrome sets its own cursors; while panning the hand wins everywhere.
        (spacePan || mode === "pan") && "cursor-grab [&_*]:cursor-grab!",
        panning && "cursor-grabbing! [&_*]:cursor-grabbing!"
      )}
      data-canvas
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
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
              hostUrl={hostUrl}
              key={page.id}
              onDragStart={startFrameDrag}
              page={page}
              visible={isVisible(frame)}
              zoom={view.zoom}
            />
          );
        })}
      </div>
      {pages.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground">
          {space === null
            ? "Open a space from the Pages panel"
            : "This space has no pages yet"}
        </div>
      )}
    </div>
  );
};

const isTyping = (e: KeyboardEvent) => {
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
