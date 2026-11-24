/**
 * The distances between two boxes in a frame, as lines to draw (ADR 0131): what ⌥ shows from the
 * selection to the node the pointer is over. Pure: boxes in, lines out, in the frame's pixels.
 */
import type { Rect } from "@ultrapaint/contracts/preview";

export interface Point {
  x: number;
  y: number;
}

/** One distance: a line along an axis, from the first box's edge to the second's. */
export interface MeasureLine {
  axis: "x" | "y";
  from: Point;
  /**
   * Where the line passes beside the second box rather than against it: the dashed way from the
   * line's end to that box's edge. Null when the line ends on the box.
   */
  guide: { from: Point; to: Point } | null;
  /** How long it is, rounded to the pixel. */
  length: number;
  to: Point;
}

type Axis = MeasureLine["axis"];

/** Where a box starts and ends along an axis. */
const span = (r: Rect, axis: Axis): [number, number] =>
  axis === "x" ? [r.x, r.x + r.width] : [r.y, r.y + r.height];

const otherAxis = (axis: Axis): Axis => (axis === "x" ? "y" : "x");

/** Whether two boxes are apart along an axis: one ends where the other starts, or before. */
const apart = (a: Rect, b: Rect, axis: Axis) => {
  const [a0, a1] = span(a, axis);
  const [b0, b1] = span(b, axis);
  return a1 <= b0 || b1 <= a0;
};

/** A point at `along` on the axis and `across` on the other. */
const pointOn = (axis: Axis, along: number, across: number): Point =>
  axis === "x" ? { x: along, y: across } : { x: across, y: along };

/**
 * The lines from `from` to `to` along an axis, between the edges given as pairs, drawn across
 * the middle of what the boxes share on the other axis, or of `from` when they share nothing
 * there; then a guide leads from the line's end to `to`.
 */
const linesAlong = (
  from: Rect,
  to: Rect,
  axis: Axis,
  edges: readonly (readonly [number, number])[]
): MeasureLine[] => {
  const cross = otherAxis(axis);
  const [c0, c1] = span(from, cross);
  const [d0, d1] = span(to, cross);
  const low = Math.max(c0, d0);
  const high = Math.min(c1, d1);
  const shared = low <= high;
  const across = shared ? (low + high) / 2 : (c0 + c1) / 2;
  // Where the line meets `to` on the other axis: against it, or at its nearer edge.
  const onTo = Math.min(Math.max(across, d0), d1);
  return edges.flatMap(([start, end]) => {
    const length = Math.round(Math.abs(end - start));
    if (length === 0) {
      return [];
    }
    const lineEnd = pointOn(axis, end, across);
    return [
      {
        axis,
        from: pointOn(axis, start, across),
        guide: shared ? null : { from: lineEnd, to: pointOn(axis, end, onTo) },
        length,
        to: lineEnd,
      },
    ];
  });
};

/**
 * What lies between `from` and `to` (the selection and the node pointed at). Boxes apart give the
 * space between their facing edges on each axis they are apart on; boxes that overlap on both,
 * one inside the other included, the distances between their matching edges, the four insets
 * for one inside the other. A distance under half a pixel is not drawn.
 */
export const measureLines = (from: Rect, to: Rect): MeasureLine[] => {
  const axes: readonly Axis[] = ["x", "y"];
  const separate = axes.some((axis) => apart(from, to, axis));
  return axes.flatMap((axis) => {
    const [a0, a1] = span(from, axis);
    const [b0, b1] = span(to, axis);
    if (separate) {
      if (!apart(from, to, axis)) {
        return [];
      }
      // The facing edges: `from`'s on the side of `to`, and `to`'s on the side of `from`.
      return linesAlong(from, to, axis, [a1 <= b0 ? [a1, b0] : [a0, b1]]);
    }
    return linesAlong(from, to, axis, [
      [a0, b0],
      [a1, b1],
    ]);
  });
};
