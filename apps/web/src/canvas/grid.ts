/**
 * The grid drawn on the canvas when it is switched on: lines every cell, every 8 cells and every
 * 64, each set faded in by how far apart its lines are on screen. Lines that are too close for
 * the zoom are gone rather than a grey wash, and the sets cross-fade instead of jumping; where
 * sets meet, their lines add up, so the coarser lines read stronger.
 */
import type { CSSProperties } from "react";
import { GRID } from "./snap.ts";

/** The spacing of each set of lines, in canvas pixels. */
const LEVELS = [GRID, GRID * 8, GRID * 64];

/** On screen, lines closer than the first are not drawn; from the second on, fully. */
const FADE_FROM = 4;
const FADE_TO = 12;

/** Each set of lines, as its spacing in canvas pixels and how strongly it is drawn at `zoom`. */
export const gridLevels = (zoom: number) =>
  LEVELS.map((size) => ({
    opacity: Math.min(
      1,
      Math.max(0, (size * zoom - FADE_FROM) / (FADE_TO - FADE_FROM))
    ),
    size,
  }));

const lines = (direction: "right" | "bottom", opacity: number) =>
  `linear-gradient(to ${direction}, color-mix(in oklab, var(--canvas-grid) ${Math.round(
    opacity * 100
  )}%, transparent) 1px, transparent 1px)`;

/** The canvas's background drawing the grid at `view`; the sets too faint to see are left out. */
export const gridBackground = (view: {
  x: number;
  y: number;
  zoom: number;
}): CSSProperties => {
  const shown = gridLevels(view.zoom).filter((l) => l.opacity > 0);
  const each = (f: (l: (typeof shown)[number]) => string[]) =>
    shown.flatMap(f).join(", ");
  // Not rounded: a frame on the grid has to sit on its line at any zoom.
  const at = `${view.x}px ${view.y}px`;
  return {
    backgroundImage: each((l) => [
      lines("right", l.opacity),
      lines("bottom", l.opacity),
    ]),
    backgroundPosition: each(() => [at, at]),
    backgroundSize: each((l) => {
      const px = `${l.size * view.zoom}px`;
      return [`${px} ${px}`, `${px} ${px}`];
    }),
  };
};

/** The spacing of a board view's dots, in canvas pixels. */
const DOTS = 24;

/**
 * A board view's background at `view` (ADR 0045): a faint dot every few cells, fading out as the
 * zoom brings them too close to tell apart, so it is never taken for the page canvas.
 */
export const dotsBackground = (view: {
  x: number;
  y: number;
  zoom: number;
}): CSSProperties => {
  const px = DOTS * view.zoom;
  const opacity = Math.min(
    1,
    Math.max(0, (px - FADE_FROM * 2) / (FADE_TO * 2 - FADE_FROM * 2))
  );
  if (opacity === 0) {
    return { backgroundImage: "", backgroundPosition: "", backgroundSize: "" };
  }
  const dot = Math.max(1, Math.min(1.5, view.zoom * 1.25));
  return {
    backgroundImage: `radial-gradient(circle, color-mix(in oklab, var(--board-grid) ${Math.round(
      opacity * 100
    )}%, transparent) ${dot}px, transparent ${dot}px)`,
    backgroundPosition: `${view.x}px ${view.y}px`,
    backgroundSize: `${px}px ${px}px`,
  };
};
