/**
 * Where something placed on the canvas lands: on the grid when it is shown, against the edges of
 * the frames around it when it is not. Pure, so the rules are tested without a canvas.
 */
import { GRID, onGrid } from "@ultrapaint/contracts/canvas-layout";
import type { FrameLayout } from "@ultrapaint/contracts/pages";

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

/** The point on the grid nearest to `p`. */
export const snapPoint = (p: Point, grid = GRID): Point => ({
  x: onGrid(p.x, grid),
  y: onGrid(p.y, grid),
});

/**
 * One moving edge put on the grid, `fixed` being the edge that stays: a side never goes under
 * `min`, so a side too short for it is taken out to the next line beyond.
 */
const snapEdge = (moving: number, fixed: number, min: number, grid: number) => {
  const dir = moving < fixed ? -1 : 1;
  let edge = onGrid(moving, grid);
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

type Axis = "x" | "y";

/**
 * The line a frame snapped to (ADR 0138): the edge of the frames around it that it lined up with,
 * at `at` on `axis`, the axis it snapped along, the line running along the other.
 */
export interface SnapGuide {
  at: number;
  axis: Axis;
  /** Where the line starts on the other axis: it runs across the frame and every frame on it. */
  from: number;
  /**
   * The space between the frame and the nearest frame on the line, along it, its length rounded
   * to the pixel; null when they touch or overlap along it.
   */
  gap: { from: number; length: number; to: number } | null;
  /** The frame whose edge won the snap. */
  matched: FrameLayout;
  /** Where the line ends on the other axis. */
  to: number;
}

const sizeOn = (axis: Axis) => (axis === "x" ? "width" : "height");

const across = (axis: Axis): Axis => (axis === "x" ? "y" : "x");

const startOf = (b: Box, axis: Axis) => b[axis];

const endOf = (b: Box, axis: Axis) => b[axis] + b[sizeOn(axis)];

/** The space from one box to the other along an axis: none or less when they meet or overlap. */
const spaceBetween = (a: Box, b: Box, axis: Axis) =>
  Math.max(
    startOf(b, axis) - endOf(a, axis),
    startOf(a, axis) - endOf(b, axis)
  );

/** Where `f` lands on an axis, and the edge it lines up with there, when one is within reach. */
interface Match {
  lands: number;
  line: number;
  matched: FrameLayout;
}

/** A frame placed against the edges of others, and the lines it snapped to. */
export interface Snapped {
  frame: FrameLayout;
  guides: SnapGuide[];
}

/**
 * The edge `f` snaps to along an axis: of the edges within `threshold` of one of its own, the
 * nearest, a tie going to the frame nearest along the other axis.
 */
const nearestEdge = (
  f: FrameLayout,
  others: readonly FrameLayout[],
  threshold: number,
  axis: Axis
): Match | null => {
  const size = f[sizeOn(axis)];
  let best: (Match & { away: number; beside: number }) | null = null;
  for (const o of others) {
    const s = startOf(o, axis);
    const e = endOf(o, axis);
    const beside = Math.max(0, spaceBetween(f, o, across(axis)));
    // Where `f` would go, and the line it would then share with `o`: its start on `o`'s start or
    // end, or its end on them.
    const candidates = [
      [s, s],
      [e, e],
      [s - size, s],
      [e - size, e],
    ] as const;
    for (const [lands, line] of candidates) {
      const away = Math.abs(lands - f[axis]);
      const nearer =
        best === null ||
        away < best.away ||
        (away === best.away && beside < best.beside);
      if (away < threshold && nearer) {
        best = { away, beside, lands, line, matched: o };
      }
    }
  }
  return best && { lands: best.lands, line: best.line, matched: best.matched };
};

/** The line for `placed` snapped to `match` along an axis, across every frame on it. */
const guideOf = (
  placed: FrameLayout,
  others: readonly FrameLayout[],
  axis: Axis,
  match: Match
): SnapGuide => {
  const cross = across(axis);
  const on = others.filter(
    (o) => startOf(o, axis) === match.line || endOf(o, axis) === match.line
  );
  const spanned = [placed, ...on];
  const nearest = on.reduce((a, b) =>
    spaceBetween(placed, b, cross) < spaceBetween(placed, a, cross) ? b : a
  );
  const length = Math.round(spaceBetween(placed, nearest, cross));
  const before = endOf(nearest, cross) <= startOf(placed, cross);
  return {
    at: match.line,
    axis,
    from: Math.min(...spanned.map((b) => startOf(b, cross))),
    gap:
      length > 0
        ? {
            from: before ? endOf(nearest, cross) : endOf(placed, cross),
            length,
            to: before ? startOf(placed, cross) : startOf(nearest, cross),
          }
        : null,
    matched: match.matched,
    to: Math.max(...spanned.map((b) => endOf(b, cross))),
  };
};

/**
 * `f` moved against the frames around it: an edge within `threshold` of one of theirs lines up
 * with the nearest, and each axis it snaps on gives the line it snapped to.
 */
export const snapToEdges = (
  f: FrameLayout,
  others: readonly FrameLayout[],
  threshold: number
): Snapped => {
  const x = nearestEdge(f, others, threshold, "x");
  const y = nearestEdge(f, others, threshold, "y");
  const frame = { ...f, x: x?.lands ?? f.x, y: y?.lands ?? f.y };
  return {
    frame,
    guides: [
      ...(x ? [guideOf(frame, others, "x", x)] : []),
      ...(y ? [guideOf(frame, others, "y", y)] : []),
    ],
  };
};

/** ⌘ on a Mac, Ctrl elsewhere, held through a drag: it lands where it is let go, off the grid. */
export const holdsFree = (e: { ctrlKey: boolean; metaKey: boolean }) =>
  e.metaKey || e.ctrlKey;
