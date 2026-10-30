/**
 * Where a board view's boards are (ADR 0045): in a row or a column from the board view's origin,
 * each at its drawn size, a gap between them that leaves room for the name over each. A board
 * not measured yet takes a size of its own until it is. Pure, so it is tested without a canvas.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";

/** Between two boards one under the other, in canvas pixels: the next one's name sits in it. */
export const BOARD_GAP = 64;

/** Between two boards side by side, whose names are over each: Color's themes. */
export const ROW_GAP = 24;

/** What a board is drawn at until its frame says its size. */
export const UNMEASURED = { height: 320, width: 480 } as const;

export const boardLayout = (
  boards: readonly string[],
  sizes: Readonly<Record<string, { height: number; width: number }>>,
  direction: "row" | "column",
  gap = direction === "row" ? ROW_GAP : BOARD_GAP
): Record<string, Box> => {
  const out: Record<string, Box> = {};
  let at = 0;
  for (const id of boards) {
    const { height, width } = sizes[id] ?? UNMEASURED;
    out[id] =
      direction === "row"
        ? { height, width, x: at, y: 0 }
        : { height, width, x: 0, y: at };
    at += (direction === "row" ? width : height) + gap;
  }
  return out;
};

/**
 * Where an item's boards begin the first time it is opened, from the seen part's corner: a little
 * in from its left, and low enough for the names over them.
 */
export const BOARD_MARGIN = { x: 32, y: 72 } as const;

/**
 * The camera an item's boards are first seen with: from the seen part's corner, every board as
 * wide as the part of the canvas between the panels holds, zoomed out as far as that takes and
 * never in past 100%.
 */
export const firstBoardView = (
  boxes: readonly Box[],
  seen: { readonly width: number; readonly x: number }
): { x: number; y: number; zoom: number } => {
  const left = Math.min(0, ...boxes.map((b) => b.x));
  const top = Math.min(0, ...boxes.map((b) => b.y));
  const right = Math.max(0, ...boxes.map((b) => b.x + b.width));
  const room = seen.width - 2 * BOARD_MARGIN.x;
  const wide = right - left;
  const zoom = wide > 0 && room > 0 ? Math.min(1, room / wide) : 1;
  return {
    x: seen.x + BOARD_MARGIN.x - left * zoom,
    y: BOARD_MARGIN.y - top * zoom,
    zoom,
  };
};
