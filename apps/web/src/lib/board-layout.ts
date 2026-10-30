/**
 * Where a board view's boards are (ADR 0045): in a row or a column from the board view's origin,
 * each at its drawn size, a gap between them that leaves room for the name over each. A board
 * not measured yet takes a size of its own until it is. Pure, so it is tested without a canvas.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";

/** Between two boards, in canvas pixels: the next one's name sits in it. */
export const BOARD_GAP = 64;

/** What a board is drawn at until its frame says its size. */
export const UNMEASURED = { height: 320, width: 480 } as const;

export const boardLayout = (
  boards: readonly string[],
  sizes: Readonly<Record<string, { height: number; width: number }>>,
  direction: "row" | "column",
  gap = BOARD_GAP
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
