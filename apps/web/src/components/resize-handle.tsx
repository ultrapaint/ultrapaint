import { cn } from "cn";
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";

interface Bounds {
  defaultWidth: number;
  max: number;
  min: number;
}

const clamp = (w: number, { min, max }: Bounds) =>
  Math.min(max, Math.max(min, Math.round(w)));

/** Width of a side panel, clamped to its bounds and remembered across reloads. */
export const usePanelWidth = (key: string, bounds: Bounds) => {
  const storageKey = `ultrapaint:panel-width:${key}`;
  const [width, setWidthState] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved ? clamp(saved, bounds) : bounds.defaultWidth;
  });
  const setWidth = (w: number) => {
    const next = clamp(w, bounds);
    setWidthState(next);
    localStorage.setItem(storageKey, String(next));
  };
  return [width, setWidth] as const;
};

/**
 * Vertical drag handle on the inner edge of a side panel. `side` is the panel's side: dragging
 * towards the canvas widens it.
 */
export const ResizeHandle = ({
  side,
  width,
  onWidthChange,
  defaultWidth,
}: {
  side: "left" | "right";
  width: number;
  onWidthChange: (width: number) => void;
  defaultWidth: number;
}) => {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const direction = side === "left" ? 1 : -1;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { width, x: e.clientX };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (start.current) {
      onWidthChange(
        start.current.width + (e.clientX - start.current.x) * direction
      );
    }
  };
  const onPointerUp = () => {
    start.current = null;
    setDragging(false);
  };
  const onDoubleClick = () => onWidthChange(defaultWidth);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onWidthChange(width - step * direction);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onWidthChange(width + step * direction);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused and dragged.
    <div
      aria-label="Resize panel"
      aria-orientation="vertical"
      aria-valuenow={width}
      className={cn(
        "group absolute inset-y-0 z-20 w-2 cursor-col-resize outline-none",
        side === "left" ? "-right-1" : "-left-1"
      )}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="separator"
      tabIndex={0}
    >
      <div
        className={cn(
          "mx-auto h-full w-px transition-colors group-hover:bg-brand group-focus-visible:bg-brand",
          dragging && "bg-brand"
        )}
      />
    </div>
  );
};
