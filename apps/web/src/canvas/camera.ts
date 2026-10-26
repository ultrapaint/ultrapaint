/**
 * The canvas's camera, kept out of React. A pan or a zoom changes the view in the store once a
 * frame; the layer of frames and the grid are moved here, written straight onto the elements, and
 * nothing is rendered again for it. What depends on the view reads only what it needs: the zoom
 * (`useInv`), or which frames are near the screen (`useFramesInView`), which changes far less
 * often than the view.
 */
import { type RefObject, useEffect, useLayoutEffect, useState } from "react";
import { useDocuments } from "../state/documents.ts";
import { allFrames, useEditor } from "../state/editor.ts";
import { useDrag } from "./drag.ts";
import { gridBackground } from "./grid.ts";
import { framesNear, NEAR_MARGIN } from "./mounting.ts";

interface View {
  x: number;
  y: number;
  zoom: number;
}

/**
 * A length that keeps its size on screen whatever the zoom: `n` screen pixels, drawn in the
 * zoomed layer. The camera keeps `--inv` on the layer, so what is drawn this way follows a zoom
 * without being rendered again.
 */
export const screenPx = (n: number) => `calc(${n}px * var(--inv))`;

/** Scales what is drawn in the zoomed layer back to its size on screen. */
export const UNZOOM = "scale(var(--inv))";

/** How long after the view last moved it counts as resting. */
const SETTLE_MS = 200;

const GRID_STYLES = [
  "backgroundImage",
  "backgroundPosition",
  "backgroundSize",
] as const;

/**
 * Keeps the layer of frames at the view, and the grid with it when it is shown, until the answer
 * is called. While the view moves the layer is promoted (`will-change`), so a pan moves what is
 * already drawn; once it rests the promotion goes, and the browser draws the layer sharp at its
 * zoom.
 */
const follow = (
  canvasEl: HTMLElement,
  layerEl: HTMLElement,
  grid: boolean
): (() => void) => {
  let settle: ReturnType<typeof setTimeout> | undefined;
  let drawnZoom: number | null = null;
  const draw = (view: View) => {
    const { x, y, zoom } = view;
    layerEl.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    if (zoom !== drawnZoom) {
      drawnZoom = zoom;
      layerEl.style.setProperty("--inv", String(1 / zoom));
    }
    if (grid) {
      const background = gridBackground(view);
      for (const key of GRID_STYLES) {
        canvasEl.style[key] = String(background[key] ?? "");
      }
    }
  };
  draw(useEditor.getState().view);
  const off = useEditor.subscribe((s, prev) => {
    if (s.view === prev.view) {
      return;
    }
    draw(s.view);
    layerEl.style.willChange = "transform";
    clearTimeout(settle);
    settle = setTimeout(() => {
      layerEl.style.willChange = "";
    }, SETTLE_MS);
  });
  return () => {
    off();
    clearTimeout(settle);
    layerEl.style.willChange = "";
    for (const key of GRID_STYLES) {
      canvasEl.style[key] = "";
    }
  };
};

/** Moves the canvas's layer of frames and its grid with the view: see `follow`. */
export const useCamera = (
  canvas: RefObject<HTMLDivElement | null>,
  layer: RefObject<HTMLDivElement | null>,
  grid: boolean
) => {
  useLayoutEffect(() => {
    if (!(canvas.current && layer.current)) {
      return;
    }
    return follow(canvas.current, layer.current, grid);
  }, [canvas, layer, grid]);
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * The frames near the screen, worked out once a frame from the view, the frames and the nodes on
 * the canvas, and handed to React only when the set changes. A node dragged by its name counts
 * as near: it is where the pointer is.
 */
export const useFramesInView = (screen: {
  height: number;
  width: number;
}): ReadonlySet<string> => {
  const [inView, setInView] = useState<ReadonlySet<string>>(() => new Set());
  const { height, width } = screen;
  useEffect(() => {
    let pending: number | null = null;
    const update = () => {
      pending = null;
      const next = framesNear(
        allFrames(),
        useEditor.getState().view,
        { height, width },
        NEAR_MARGIN
      );
      const { dragged } = useDrag.getState();
      if (dragged?.kind === "loose") {
        next.add(dragged.frame);
      }
      setInView((prev) => (sameSet(prev, next) ? prev : next));
    };
    // Several stores may change in one go (a canvas opened, then its view): one look at them all.
    const soon = () => {
      pending ??= requestAnimationFrame(update);
    };
    update();
    const offs = [
      useEditor.subscribe((s, prev) => {
        if (
          s.view !== prev.view ||
          s.frames !== prev.frames ||
          s.sizes !== prev.sizes ||
          s.held !== prev.held ||
          s.canvas !== prev.canvas
        ) {
          soon();
        }
      }),
      useDocuments.subscribe((s, prev) => {
        if (s.docs !== prev.docs) {
          soon();
        }
      }),
      useDrag.subscribe((s, prev) => {
        if (s.dragged !== prev.dragged) {
          soon();
        }
      }),
    ];
    return () => {
      for (const off of offs) {
        off();
      }
      if (pending !== null) {
        cancelAnimationFrame(pending);
      }
    };
  }, [height, width]);
  return inView;
};
