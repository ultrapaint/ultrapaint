import type { Rect } from "@ultrapaint/contracts/preview";

/**
 * The box around several rects: what several selected are outlined, sized and measured from.
 * Null for none.
 */
export const unionOf = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) {
    return null;
  }
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { height: bottom - top, width: right - left, x: left, y: top };
};
