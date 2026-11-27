/**
 * Where frames go on a canvas: a page's frame, the views drawn beside it (ADR 0036), a page the
 * layout does not place yet, and a page's family, which moves and goes with it. The server's
 * pages, the MCP tools and the editor place frames by it, so a frame lands where the editor
 * draws it and never on another page or its views.
 */
import { basePathOf } from "@ultrapaint/shared/route";
import {
  type FrameLayout,
  type FrameView,
  presetSize,
  type ViewportPreset,
} from "./pages.ts";

/** Room between two frames on a canvas, and between a page's frame and its views. */
export const FRAME_GAP = 80;

/**
 * One cell of the canvas's grid, in canvas pixels: what the editor snaps to and draws, and what a
 * frame an agent places is rounded to.
 */
export const GRID = 8;

/** The line of the grid nearest to `value`. */
export const onGrid = (value: number, grid = GRID) =>
  // `|| 0`: a value just left of zero would land on -0.
  Math.round(value / grid) * grid || 0;

/** A box on the canvas, in the canvas's own coordinates. */
export interface Box {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

type Frames = Readonly<Record<string, FrameLayout>>;

/** What a page no layout places is drawn at: the desktop's size. */
const UNPLACED = { ...presetSize.desktop, preset: "desktop" } as const;

/** A page's frame and its views, each a box on the canvas: a view is placed from its frame. */
export const boxesOf = (frame: FrameLayout): Box[] => [
  { height: frame.height, width: frame.width, x: frame.x, y: frame.y },
  ...(frame.views ?? []).map((v) => ({
    height: v.height,
    width: v.width,
    x: frame.x + v.x,
    y: frame.y + v.y,
  })),
];

/** Where a frame ends on the right, with the views drawn beside it. */
export const frameRight = (frame: FrameLayout) =>
  Math.max(...boxesOf(frame).map((b) => b.x + b.width));

/** Where a frame ends at the bottom, with the views drawn under it. */
export const frameBottom = (frame: FrameLayout) =>
  Math.max(...boxesOf(frame).map((b) => b.y + b.height));

/** The box a frame takes on the canvas with its views. */
export const boundsOf = (frame: FrameLayout): Box => {
  const boxes = boxesOf(frame);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    height: frameBottom(frame) - y,
    width: frameRight(frame) - x,
    x,
    y,
  };
};

/** Whether two boxes are closer than the gap: one placed there would crowd the other. */
const crowds = (a: Box, b: Box) =>
  a.x < b.x + b.width + FRAME_GAP &&
  b.x < a.x + a.width + FRAME_GAP &&
  a.y < b.y + b.height + FRAME_GAP &&
  b.y < a.y + a.height + FRAME_GAP;

/** Whether two boxes share some of the canvas; boxes that only touch do not. */
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/**
 * The frames each moved frame lies over, where every frame is: a frame or one of its views over
 * another frame or one of that frame's views. Frames closer than `FRAME_GAP` without touching are
 * not over each other, as a person may place them by hand. A moved frame with nothing under it
 * has no key.
 */
export const overlapsOf = (
  frames: Frames,
  moved: readonly string[]
): Record<string, string[]> => {
  const over: Record<string, string[]> = {};
  for (const key of moved) {
    const frame = frames[key];
    if (!frame) {
      continue;
    }
    const mine = boxesOf(frame);
    const under = Object.entries(frames)
      .filter(
        ([other, f]) =>
          other !== key &&
          boxesOf(f).some((box) => mine.some((m) => intersects(m, box)))
      )
      .map(([other]) => other);
    if (under.length > 0) {
      over[key] = under;
    }
  }
  return over;
};

/**
 * A new frame on a canvas: at the top, to the right of every frame and its views, so it lands on
 * none. The first is at the origin.
 */
export const placeFrame = (
  frames: Frames,
  frame: Omit<FrameLayout, "x" | "y">
): FrameLayout => {
  const placed = Object.values(frames);
  const x =
    placed.length === 0 ? 0 : Math.max(...placed.map(frameRight)) + FRAME_GAP;
  return { ...frame, x, y: 0 };
};

/**
 * A frame at the spot it asks for, by a page it is drawn from (a copy beside its page, a state
 * across from it), when neither it nor its views crowd a frame or view there;
 * else where `placeFrame` puts a new frame, past everything.
 */
export const placeFrameAt = (
  frames: Frames,
  frame: FrameLayout
): FrameLayout => {
  const others = Object.values(frames).flatMap(boxesOf);
  const crowded = boxesOf(frame).some((box) =>
    others.some((other) => crowds(box, other))
  );
  return crowded ? placeFrame(frames, frame) : frame;
};

/**
 * Every page's frame as the editor draws it, by the page's path: the one the layout saves, and
 * for a page it does not, the desktop's size in a row to the right of the saved ones, in the
 * pages' order.
 */
export const canvasFrames = (
  paths: readonly string[],
  saved: Frames
): Record<string, FrameLayout> => {
  const frames: Record<string, FrameLayout> = {};
  for (const path of paths) {
    const frame = saved[path];
    if (frame) {
      frames[path] = frame;
    }
  }
  for (const path of paths) {
    frames[path] ??= placeFrame(frames, UNPLACED);
  }
  return frames;
};

/**
 * The frame the editor draws a page of `paths` in: its saved one, or where `canvasFrames` puts
 * it, after the others when the list does not have it yet.
 */
export const drawnFrame = (
  paths: readonly string[],
  saved: Frames,
  path: string
): FrameLayout =>
  canvasFrames(paths.includes(path) ? paths : [...paths, path], saved)[path] ??
  placeFrame(saved, UNPLACED);

/** What a frame is sized to: a preset, pixels, and the widths of its views. */
export interface FrameSize {
  readonly height?: number | undefined;
  readonly preset?: Exclude<ViewportPreset, "custom"> | undefined;
  /** The widths its views are drawn at, side by side; its views stay as they are when absent. */
  readonly views?: readonly number[] | undefined;
  readonly width?: number | undefined;
}

/**
 * The frame sized as asked, where it is: the preset's size or its own, the pixels given over
 * either. It keeps its preset unless pixels are given, which make it custom; its views are at
 * the widths given, or those it has.
 */
export const sizeFrame = (frame: FrameLayout, size: FrameSize): FrameLayout => {
  const base = size.preset ? presetSize[size.preset] : frame;
  const height = size.height ?? base.height;
  const width = size.width ?? base.width;
  const views = size.views
    ? viewsAt(size.views, frame.views ?? [], { height, width })
    : frame.views;
  const { views: _, ...rest } = frame;
  return {
    ...rest,
    height,
    preset:
      size.width === undefined && size.height === undefined
        ? (size.preset ?? frame.preset)
        : "custom",
    ...(views && views.length > 0 && { views }),
    width,
  };
};

/** A view's id: its width, told apart from the page's other views (`w390`, then `w390-2`). */
export const viewIdFor = (
  width: number,
  taken: readonly { readonly id: string }[]
): string => {
  const base = `w${Math.round(width)}`;
  let id = base;
  for (let n = 2; taken.some((v) => v.id === id); n += 1) {
    id = `${base}-${n}`;
  }
  return id;
};

/**
 * A page's views at these widths, side by side to the right of its frame: one it had at a width
 * keeps its id and its height, a new one is as tall as the frame.
 */
export const viewsAt = (
  widths: readonly number[],
  before: readonly FrameView[],
  frame: { readonly height: number; readonly width: number }
): FrameView[] => {
  const views: FrameView[] = [];
  let x = frame.width;
  for (const width of widths) {
    const rounded = Math.round(width);
    const had = before.find(
      (v) => v.width === rounded && !views.some((w) => w.id === v.id)
    );
    x += FRAME_GAP;
    views.push({
      height: had?.height ?? frame.height,
      id: had?.id ?? viewIdFor(rounded, views),
      width: rounded,
      x,
      y: 0,
    });
    x += rounded;
  }
  return views;
};

/**
 * Where a new view of a page goes, counted from its frame: to the right of the frame and of its
 * views; below them when another page or its views are there, and further down until nothing is
 * in the way. `frames` are the canvas's pages' frames, the page's under `page`.
 */
export const placeView = (
  frames: Frames,
  page: string,
  size: { readonly height: number; readonly width: number }
): { x: number; y: number } => {
  const frame = frames[page];
  if (!frame) {
    return { x: 0, y: 0 };
  }
  const others = Object.entries(frames).flatMap(([key, f]) =>
    key === page ? [] : boxesOf(f)
  );
  const blocking = (spot: Box) => others.filter((b) => crowds(spot, b));
  let box: Box = { ...size, x: frameRight(frame) + FRAME_GAP, y: frame.y };
  if (blocking(box).length === 0) {
    return { x: box.x - frame.x, y: 0 };
  }
  box = { ...size, x: frame.x, y: frameBottom(frame) + FRAME_GAP };
  for (let found = blocking(box); found.length > 0; found = blocking(box)) {
    box = {
      ...box,
      y: Math.max(...found.map((b) => b.y + b.height)) + FRAME_GAP,
    };
  }
  return { x: box.x - frame.x, y: box.y - frame.y };
};

/**
 * Room made for a block on the canvas by shifting what is in the way, never drawing over it
 * (ADR 0147): every box that crowds the block moves right, past it, by one distance, so the
 * boxes that move keep their places among themselves; a box to the right of one that moves, and
 * that the moved one would crowd, moves with it. Returns how far each box that moves goes, by
 * its key; the others stay.
 */
export const roomFor = (
  block: Box,
  boxes: Readonly<Record<string, Box>>
): Record<string, number> => {
  const entries = Object.entries(boxes);
  const inWay = entries.filter(([, box]) => crowds(block, box));
  if (inWay.length === 0) {
    return {};
  }
  const by = Math.max(
    ...inWay.map(([, box]) => block.x + block.width + FRAME_GAP - box.x)
  );
  const moved = new Map(inWay);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [key, box] of entries) {
      const pushed =
        !moved.has(key) &&
        [...moved.values()].some(
          (m) => box.x >= m.x && crowds({ ...m, x: m.x + by }, box)
        );
      if (pushed) {
        moved.set(key, box);
        grew = true;
      }
    }
  }
  return Object.fromEntries([...moved.keys()].map((key) => [key, by]));
};

/**
 * A page's family: the pages of its canvas drawn from the same base page, the base with its
 * states (ADR 0030). They are named after the base, and move and go with it.
 */
export const familyOf = <
  P extends { readonly canvas: string; readonly path: string },
>(
  pages: readonly P[],
  page: { readonly canvas: string; readonly path: string }
): P[] => {
  const base = basePathOf(page.path);
  return pages.filter(
    (p) => p.canvas === page.canvas && basePathOf(p.path) === base
  );
};
