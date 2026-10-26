/**
 * Where the element toolbar hangs: over the element, or under it near the frame's top, and kept
 * inside the frame while it fits. It is drawn in the frame's toolbar layer, over the frame rather
 * than in it: the frame clips its preview, and a toolbar wider than the frame must not be.
 */

import type { Rect } from "@ultrapaint/contracts/preview";
import {
  type CSSProperties,
  createContext,
  useLayoutEffect,
  useState,
} from "react";

/** Height of the selection's tag, which the toolbar sits above. */
export const TAG_HEIGHT = 20;
/** The toolbar's own height and the room it keeps from what it hangs from, on screen. */
const TOOLBAR_HEIGHT = 34;
const GAP = 8;

/**
 * The layer over a frame, past its clipping and above its neighbours, that the toolbar of the
 * selection in it is drawn in.
 */
export const ToolbarLayer = createContext<HTMLElement | null>(null);

/**
 * The frame's name sits over its top: close to it, the toolbar hangs under the element instead
 * of over it.
 */
const roomAbove = (rectY: number, inv: number) =>
  rectY >= (TAG_HEIGHT + GAP + TOOLBAR_HEIGHT) * inv;

/**
 * Where the toolbar goes: centred over the element, or under it near the frame's top, and under
 * the frame's bottom for an element that reaches past it. Sideways it stays inside the frame, and
 * one wider than the frame is centred on it. The toolbar's width is only known once it is drawn;
 * until then it is centred on the element.
 */
export const usePlacement = (
  rect: Rect,
  inv: number,
  frame: { height: number; width: number }
) => {
  // A callback ref: the toolbar can be drawn later than the hook first runs.
  const [el, placeAt] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el) {
      return;
    }
    const measure = () => setWidth(el.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  const above = roomAbove(rect.y, inv);
  const vertical: CSSProperties = above
    ? { bottom: `calc(100% + ${(TAG_HEIGHT + GAP) * inv}px)` }
    : { top: Math.min(rect.height, frame.height - rect.y) + GAP * inv };
  if (width === null) {
    return [
      placeAt,
      {
        ...vertical,
        left: "50%",
        transform: `scale(${inv}) translateX(-50%)`,
        transformOrigin: above ? "bottom left" : "top left",
      } satisfies CSSProperties,
    ] as const;
  }
  const drawn = width * inv;
  const centred = rect.x + rect.width / 2 - drawn / 2;
  const left =
    drawn > frame.width
      ? (frame.width - drawn) / 2
      : Math.max(0, Math.min(centred, frame.width - drawn));
  return [
    placeAt,
    {
      ...vertical,
      left: left - rect.x,
      transform: `scale(${inv})`,
      transformOrigin: above ? "bottom left" : "top left",
    } satisfies CSSProperties,
  ] as const;
};
