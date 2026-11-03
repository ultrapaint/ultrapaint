/**
 * Where a board view's boards are (ADR 0045): in a row, a column or rows as wide as the canvas
 * holds, from the board view's origin, each at its drawn size, a gap between them that leaves room
 * for the name over each. A board not measured yet takes a size of its own until it is. Pure, so
 * it is tested without a canvas.
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
 * Side by side while they fit in `room`, the next one under them when it would not: a card's
 * variants share a row and a wide header's stack, each at 100% rather than all of them shrunk to
 * fit. A board wider than `room` has a row of its own.
 */
export const wrappedBoards = (
  boards: readonly string[],
  sizes: Readonly<Record<string, { height: number; width: number }>>,
  room: number
): Record<string, Box> => {
  const out: Record<string, Box> = {};
  let x = 0;
  let y = 0;
  let tallest = 0;
  for (const id of boards) {
    const { height, width } = sizes[id] ?? UNMEASURED;
    if (x > 0 && x + width > room) {
      x = 0;
      y += tallest + BOARD_GAP;
      tallest = 0;
    }
    out[id] = { height, width, x, y };
    x += width + ROW_GAP;
    tallest = Math.max(tallest, height);
  }
  return out;
};

/**
 * Where an item's boards begin the first time it is opened, from the seen part's corner: a little
 * in from its left, and low enough for the names over them.
 */
export const BOARD_MARGIN = { x: 32, y: 72 } as const;

/** How wide a row of boards can be between the panels, at 100%. */
export const boardRoom = (seen: { readonly width: number }) =>
  seen.width - 2 * BOARD_MARGIN.x;

/**
 * The camera an item's boards are first seen with: every board as wide as the part of the canvas
 * between the panels holds, zoomed out as far as that takes and never in past 100%, and centred
 * there; boards taller than it begin at its top, so their start is seen. Before they are
 * measured, from the seen part's corner.
 */
export const firstBoardView = (
  boxes: readonly Box[],
  seen: { readonly height: number; readonly width: number; readonly x: number }
): { x: number; y: number; zoom: number } => {
  if (boxes.length === 0) {
    return { x: seen.x + BOARD_MARGIN.x, y: BOARD_MARGIN.y, zoom: 1 };
  }
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const room = boardRoom(seen);
  const wide = right - left;
  const zoom = wide > 0 && room > 0 ? Math.min(1, room / wide) : 1;
  const high = (bottom - top) * zoom;
  return {
    x: seen.x + (seen.width - wide * zoom) / 2 - left * zoom,
    y:
      high <= seen.height - 2 * BOARD_MARGIN.y
        ? (seen.height - high) / 2 - top * zoom
        : BOARD_MARGIN.y - top * zoom,
    zoom,
  };
};
