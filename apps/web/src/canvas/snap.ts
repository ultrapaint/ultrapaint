/**
 * Where something placed on the canvas lands: on the grid when it is shown, against the edges of
 * the frames around it when it is not. Pure, so the rules are tested without a canvas.
 */
import type { FrameLayout } from "@ultrapaint/contracts/pages";

/** One cell of the grid, in canvas pixels. */
export const GRID = 8;

interface Point {
  x: number;
  y: number;
}

interface Box extends Point {
  height: number;
  width: number;
}

/** The corner a resize drags; the opposite one stays where it was. */
type Corner = "nw" | "ne" | "sw" | "se";

// `|| 0`: a point just left of zero would land on -0.
const toGrid = (v: number, grid: number) => Math.round(v / grid) * grid || 0;

/** The point on the grid nearest to `p`. */
export const snapPoint = (p: Point, grid = GRID): Point => ({
  x: toGrid(p.x, grid),
  y: toGrid(p.y, grid),
});

/**
 * One moving edge put on the grid, `fixed` being the edge that stays: a side never goes under
 * `min`, so a side too short for it is taken out to the next line beyond.
 */
const snapEdge = (moving: number, fixed: number, min: number, grid: number) => {
  const dir = moving < fixed ? -1 : 1;
  let edge = toGrid(moving, grid);
  while ((edge - fixed) * dir < min) {
    edge += dir * grid;
  }
  return edge;
};

/**
 * `box` as a resize from `corner` left it, its moving edges put on the grid; `from` is the box
 * before the resize. Keeping the ratio, the edge nearer a line of the grid snaps and the other
 * side follows the ratio.
 */
export const snapBox = (
  box: Box,
  from: Box,
  corner: Corner,
  min: number,
  keepRatio: boolean,
  grid = GRID
): Box => {
  const west = corner.endsWith("w");
  const north = corner.startsWith("n");
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const x = west ? snapEdge(box.x, right, min, grid) : box.x;
  const y = north ? snapEdge(box.y, bottom, min, grid) : box.y;
  const width = west ? right - x : snapEdge(right, box.x, min, grid) - box.x;
  const height = north
    ? bottom - y
    : snapEdge(bottom, box.y, min, grid) - box.y;
  if (!keepRatio) {
    return { height, width, x, y };
  }
  const ratio = from.width / from.height;
  // Whichever side moved less to reach the grid decides, unless the other would then go under
  // `min`; the other side is worked out from it.
  const nearer = Math.abs(width - box.width) <= Math.abs(height - box.height);
  const byWidth = nearer ? width / ratio >= min : height * ratio < min;
  const w = byWidth ? width : height * ratio;
  const h = byWidth ? width / ratio : height;
  return {
    height: h,
    width: w,
    x: west ? right - w : box.x,
    y: north ? bottom - h : box.y,
  };
};

/**
 * `f` moved against the frames around it: an edge within `threshold` of one of theirs lines up
 * with it.
 */
export const snapToEdges = (
  f: FrameLayout,
  others: FrameLayout[],
  threshold: number
): FrameLayout => {
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

/** ⌘ on a Mac, Ctrl elsewhere, held through a drag: it lands where it is let go, off the grid. */
export const holdsFree = (e: { ctrlKey: boolean; metaKey: boolean }) =>
  e.metaKey || e.ctrlKey;
