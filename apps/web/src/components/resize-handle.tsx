import { cn } from "cn";
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
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

/**
 * Width of a side panel, clamped to its bounds and remembered across reloads. When the bounds
 * tighten (a panel allowed to be wide gives way to one that is not), the width shrinks to fit and
 * stays shrunk.
 */
export const usePanelWidth = (key: string, bounds: Bounds) => {
  const storageKey = `ultrapaint:panel-width:${key}`;
  const [stored, setStored] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved ? clamp(saved, bounds) : bounds.defaultWidth;
  });
  const [max, setMax] = useState(bounds.max);
  if (bounds.max !== max) {
    setMax(bounds.max);
    setStored((w) => Math.min(w, bounds.max));
  }
  const width = Math.min(stored, bounds.max);
  useEffect(() => {
    localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);
  const setWidth = (w: number) => setStored(clamp(w, bounds));
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
          "mx-auto h-full w-px transition-colors duration-150 group-hover:bg-foreground/25 group-focus-visible:bg-ring",
          dragging && "bg-foreground/40"
        )}
      />
    </div>
  );
};
