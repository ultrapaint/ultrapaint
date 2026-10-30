/**
 * The ground of the main area, the page canvas's and a board view's alike (ADR 0045): what the
 * one camera moves (the layer under it, `useCamera`), panned by the pointer (the middle button,
 * Space held, the pan tool) and by the wheel, zoomed about the pointer with ⌘/Ctrl or a pinch,
 * with the cursors a pan shows, on the surface's background. A press on nothing is the surface's
 * (`onGroundPress`); what else the pointer does on the ground is the caller's.
 */
import { cn } from "cn";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { nextView, setViewSoon } from "../state/camera.ts";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useEditor } from "../state/editor.ts";
import { type Surface, surfaceNow } from "../state/surface.ts";
import { useCamera, useSpacePan, wheelView } from "./camera.ts";
import { fromFrame } from "./from-frame.ts";
import { dotsBackground, gridBackground } from "./grid.ts";

/** Whether the pointer pans whatever it is over: Space held, or the pan tool. */
const pansAnywhere = (s: { mode: string; spacePan: boolean }) =>
  s.spacePan || s.mode === "pan";

/** The pattern the camera draws on the ground at each zoom: the page's grid when shown, the dots. */
const usePattern = (background: Surface["background"]) => {
  const grid = useCanvasGrid((s) => s.visible);
  if (background === "board") {
    return dotsBackground;
  }
  return grid ? gridBackground : null;
};

export const CanvasGround = ({
  background,
  children,
  cursor,
  groundRef,
  onContextMenu,
  onPointerCancel,
  onPointerDown,
  onPointerLeave,
  onPointerMove,
  onPointerUp,
  onSize,
  overlay,
}: {
  background: Surface["background"];
  /** What the camera moves: the frames, and what is drawn among them. */
  children: ReactNode;
  /** Cursors a tool shows over all of it while it does not pan. */
  cursor?: string | false;
  /** The ground's element, for what listens to it besides the pointer (drops, pastes). */
  groundRef?: RefObject<HTMLDivElement | null>;
  onContextMenu: (e: ReactMouseEvent) => void;
  onPointerCancel?: () => void;
  /** A press that does not pan; a press on nothing the caller leaves alone is the surface's. */
  onPointerDown?: (e: ReactPointerEvent) => void;
  onPointerLeave?: () => void;
  onPointerMove?: (e: ReactPointerEvent, panning: boolean) => void;
  /** A release that ends no pan. */
  onPointerUp?: () => void;
  /** The ground's size whenever it changes: what can be seen of the frames. */
  onSize?: (size: { height: number; width: number }) => void;
  /** What sits over the ground and does not move with the camera. */
  overlay?: ReactNode;
}) => {
  const own = useRef<HTMLDivElement>(null);
  const ref = groundRef ?? own;
  const layer = useRef<HTMLDivElement>(null);
  const pansAll = useEditor(pansAnywhere);
  const [panning, setPanning] = useState(false);
  useCamera(ref, layer, usePattern(background));
  useSpacePan();

  // Where the ground is in the window, read when it is laid out anyway: a wheel event reading it
  // would make the browser lay out again what the last zoom changed, once per event.
  const origin = useRef({ left: 0, top: 0 });
  const sized = useEffectEvent((size: { height: number; width: number }) =>
    onSize?.(size)
  );
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const rect = el.getBoundingClientRect();
      origin.current = { left: rect.left, top: rect.top };
      sized({ height: el.clientHeight, width: el.clientWidth });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    measure();
    // Wheel: pan, or zoom with ⌘/Ctrl (pinch gestures arrive with ctrlKey). A comment thread
    // scrolls itself, unless it is a pinch, which still zooms; so does a frame that takes input.
    const onWheel = (e: WheelEvent) => {
      if (
        !(e.ctrlKey || e.metaKey) &&
        ((e.target as Element | null)?.closest("[data-canvas-scroll]") ||
          fromFrame(e))
      ) {
        return;
      }
      e.preventDefault();
      wheelView(e, origin.current);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      el.removeEventListener("wheel", onWheel);
    };
  }, [ref]);

  /** The ground being panned by the pointer: where it was pressed and where the view was then. */
  const panFrom = useRef<{
    startX: number;
    startY: number;
    vx: number;
    vy: number;
  } | null>(null);
  const stopPan = () => {
    panFrom.current = null;
    setPanning(false);
  };

  const onDown = (e: ReactPointerEvent) => {
    if (!(e.button === 1 || pansAnywhere(useEditor.getState()))) {
      onPointerDown?.(e);
      if (!e.defaultPrevented && e.target === e.currentTarget) {
        surfaceNow().onGroundPress();
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
  const onMove = (e: ReactPointerEvent) => {
    const p = panFrom.current;
    if (p) {
      setViewSoon({
        x: p.vx + (e.clientX - p.startX),
        y: p.vy + (e.clientY - p.startY),
      });
    }
    onPointerMove?.(e, p !== null);
  };
  const onUp = () => {
    if (panFrom.current) {
      stopPan();
      return;
    }
    onPointerUp?.();
  };
  const onCancel = () => {
    stopPan();
    onPointerCancel?.();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the canvas is the pointer's; its menu is on the context menu key too.
    <div
      className={cn(
        "relative h-full w-full overflow-hidden",
        background === "board" ? "bg-board" : "bg-canvas",
        // Frame chrome sets its own cursors; while panning the hand wins everywhere.
        pansAll && "cursor-grab [&_*]:cursor-grab!",
        !pansAll && cursor,
        panning && "cursor-grabbing! [&_*]:cursor-grabbing!"
      )}
      data-board-canvas={background === "board" ? "" : undefined}
      data-canvas
      onContextMenu={onContextMenu}
      onPointerCancel={onCancel}
      onPointerDown={onDown}
      onPointerLeave={onPointerLeave}
      onPointerMove={onMove}
      onPointerUp={onUp}
      ref={ref}
    >
      {/* Moved by the camera, not by rendering: see `useCamera`. */}
      <div
        className="absolute top-0 left-0"
        ref={layer}
        style={{ transformOrigin: "0 0" }}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
};
