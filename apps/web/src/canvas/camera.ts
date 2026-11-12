/**
 * The canvas's camera, kept out of React. A pan or a zoom changes the view in the store once a
 * frame; the layer of frames and the grid are moved here, written straight onto the elements, and
 * nothing is rendered again for it. What depends on the view reads only what it needs: the zoom
 * (`useInv`), or which frames are near the screen (`useFramesInView`), which changes far less
 * often than the view.
 */
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isTyping } from "../lib/keys.ts";
import {
  clampZoom,
  measureViewportWith,
  nextView,
  setViewSoon,
  type Viewport,
  viewTarget,
  zoomNotches,
} from "../state/camera.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { allFrames } from "../state/surface.ts";
import { useDrag } from "./drag.ts";
import { isWarm, LOADING_MAX, onPoolChange } from "./editor-frame.ts";
import { framesNear, framesToShow, NEAR_MARGIN } from "./mounting.ts";

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

/** A length of the canvas as it is on screen, in what `UNZOOM` scales back to screen size. */
export const onScreen = (n: number) => `calc(${n}px / var(--inv))`;

/**
 * Keeps `--inv` exact on one element at every frame of a gesture, where the layer's follows the
 * zoom only once it has drifted: for the few things that must not grow or shrink as the view
 * zooms, as Figma's do not (the selection's size and agent's button, ADR 0086). Only that
 * element's own subtree is styled again each frame.
 */
export const useExactInv = (ref: RefObject<HTMLElement | null>) => {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const write = (zoom: number) =>
      el.style.setProperty("--inv", String(1 / zoom));
    write(useEditor.getState().view.zoom);
    return useEditor.subscribe((s, prev) => {
      if (s.view.zoom !== prev.view.zoom) {
        write(s.view.zoom);
      }
    });
  }, [ref]);
};

/** How long after the view last moved it counts as resting. */
const SETTLE_MS = 200;

/** How far past the zoom it was drawn at a moving layer is zoomed in before it is drawn again. */
const SHARPEN_AT = 1.5;

/** How far the zoom drifts while the view moves before `--inv` follows it (15%, in log scale). */
const INV_DRIFT = Math.log(1.15);

const GRID_STYLES = [
  "backgroundImage",
  "backgroundPosition",
  "backgroundSize",
] as const;

/**
 * Keeps the layer of frames at the view, and the grid with it when it is shown, until the answer
 * is called. While the view moves the layer is promoted (`will-change`), so a pan or a zoom moves
 * what is already drawn rather than drawing it again each frame; zoomed in half as far again as it
 * was drawn at, it is drawn again, so it does not blur, and once the view rests the promotion goes
 * and the browser draws the layer sharp at its zoom. What keeps its size on screen (`--inv`)
 * follows the zoom a few times a gesture, and exactly at rest.
 */
const follow = (
  canvasEl: HTMLElement,
  layerEl: HTMLElement,
  background: Background | null
): (() => void) => {
  let settle: ReturnType<typeof setTimeout> | undefined;
  let drawnZoom: number | null = null;
  let moving = false;
  const draw = (view: View) => {
    const { x, y, zoom } = view;
    layerEl.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    // Every element of the layer is styled again when `--inv` changes: while the view moves it
    // follows the zoom only once it has drifted, a few times a gesture rather than every frame.
    if (
      zoom !== drawnZoom &&
      (!moving ||
        drawnZoom === null ||
        Math.abs(Math.log(zoom / drawnZoom)) > INV_DRIFT)
    ) {
      drawnZoom = zoom;
      layerEl.style.setProperty("--inv", String(1 / zoom));
    }
    if (background) {
      const drawn = background(view);
      for (const key of GRID_STYLES) {
        canvasEl.style[key] = String(drawn[key] ?? "");
      }
    }
  };
  draw(useEditor.getState().view);
  // The zoom the promoted layer was drawn at: zoomed in far past it, the layer is drawn again.
  let rasterZoom: number | null = null;
  const off = useEditor.subscribe((s, prev) => {
    if (s.view === prev.view) {
      return;
    }
    moving = true;
    draw(s.view);
    if (rasterZoom === null || s.view.zoom > rasterZoom * SHARPEN_AT) {
      layerEl.style.willChange = "";
      rasterZoom = s.view.zoom;
      requestAnimationFrame(() => {
        if (moving) {
          layerEl.style.willChange = "transform";
        }
      });
    }
    clearTimeout(settle);
    settle = setTimeout(() => {
      moving = false;
      rasterZoom = null;
      draw(useEditor.getState().view);
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

/** How far a panel floating over one edge of the canvas reaches into it; a hidden one, not at all. */
const coverOf = (rect: DOMRect, side: "left" | "right") => {
  const panel = document
    .querySelector(`[data-canvas-cover="${side}"]`)
    ?.getBoundingClientRect();
  if (!panel || panel.width === 0) {
    return 0;
  }
  return Math.max(
    0,
    side === "left" ? panel.right - rect.left : rect.right - panel.left
  );
};

/**
 * The part of the canvas that can be seen, in the canvas's own coordinates: the side panels float
 * over the canvas's edges, and what is fitted or zoomed into belongs in what is left between them.
 */
const seenOf = (el: HTMLElement): Viewport => {
  const rect = el.getBoundingClientRect();
  const left = coverOf(rect, "left");
  const right = coverOf(rect, "right");
  return { height: rect.height, width: rect.width - left - right, x: left };
};

/** What a canvas draws under its frames at a view: the page canvas's grid, a board's dots. */
export type Background = (view: View) => CSSProperties;

/**
 * Moves the canvas's layer of frames and what is drawn under them (the grid, when it is shown)
 * with the view (see `follow`), and measures what of the canvas is seen for the camera while it
 * is on screen: from the moment it is laid out, as the panels beside it are, before the browser
 * paints.
 */
export const useCamera = (
  canvas: RefObject<HTMLDivElement | null>,
  layer: RefObject<HTMLDivElement | null>,
  background: Background | null
) => {
  useLayoutEffect(() => {
    const el = canvas.current;
    return el ? measureViewportWith(() => seenOf(el)) : undefined;
  }, [canvas]);
  useLayoutEffect(() => {
    if (!(canvas.current && layer.current)) {
      return;
    }
    return follow(canvas.current, layer.current, background);
  }, [canvas, layer, background]);
};

/**
 * Notches of a mouse wheel in `e`, or null for a trackpad's stream: a wheel reports lines or pages,
 * or a large jump at once, where a trackpad reports pixels a little at a time.
 */
const notchesOf = (e: WheelEvent): number | null => {
  if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
    return -Math.sign(e.deltaY);
  }
  return Math.abs(e.deltaY) >= NOTCH_DELTA ? -Math.sign(e.deltaY) : null;
};

/** A wheel event moving this far at once is a notch of a mouse wheel. */
const NOTCH_DELTA = 40;

/**
 * A wheel over a canvas, the page canvas's or a board view's: a pan, or with ctrl or meta (a
 * pinch arrives with ctrl) a zoom about the pointer. `origin` is where the canvas is in the window.
 */
export const wheelView = (
  e: WheelEvent,
  origin: { left: number; top: number }
) => {
  const { x, y, zoom } = nextView();
  if (e.ctrlKey || e.metaKey) {
    const cx = e.clientX - origin.left;
    const cy = e.clientY - origin.top;
    // A mouse wheel zooms a step a notch, gliding; a pinch or a trackpad follows the fingers.
    const notches = notchesOf(e);
    if (notches !== null) {
      zoomNotches(notches, { x: cx, y: cy });
      return;
    }
    const next = clampZoom(
      zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))
    );
    const k = next / zoom;
    setViewSoon({
      x: cx - (cx - x) * k,
      y: cy - (cy - y) * k,
      zoom: next,
    });
  } else {
    setViewSoon({ x: x - e.deltaX, y: y - e.deltaY });
  }
};

/** Space held pans whatever the tool, while a canvas is on screen. */
export const useSpacePan = () => {
  useEffect(() => {
    const store = useEditor.getState;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) {
        e.preventDefault();
        if (!store().spacePan) {
          store().setSpacePan(true);
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && store().spacePan) {
        store().setSpacePan(false);
      }
    };
    // A key released while the window is in the background never reaches keyup.
    const blur = () => store().setSpacePan(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/** How long a zoom rests before the frames it brought near are drawn. */
const ZOOM_REST_MS = 120;

type EditorState = ReturnType<typeof useEditor.getState>;

/**
 * The frames to show next, from those shown and the screen's size, as the view, the frames and
 * a drag have them now.
 */
const framesShownNext = (
  shown: ReadonlySet<string>,
  seen: { readonly height: number; readonly width: number }
): Set<string> => {
  const boxes = allFrames();
  const now = useEditor.getState().view;
  // While the camera glides to a place, what is there loads, not what it passes over: the
  // frames shown stay while they are near, and only those where it goes are added.
  const target = viewTarget();
  const view = target ?? now;
  const near = framesNear(boxes, view, seen, NEAR_MARGIN);
  if (target) {
    for (const id of framesNear(boxes, now, seen, NEAR_MARGIN)) {
      if (shown.has(id)) {
        near.add(id);
      }
    }
  }
  const next = framesToShow({
    boxes,
    loadingMax: LOADING_MAX,
    near,
    screen: seen,
    shown,
    view,
    warm: isWarm,
  });
  const { dragged } = useDrag.getState();
  if (dragged?.kind === "loose") {
    next.add(dragged.frame);
  }
  return next;
};

/** A zoom by the user, not a glide to a place (which loads where it goes). */
const zoomedBy = (s: EditorState, prev: EditorState) =>
  s.view.zoom !== prev.view.zoom && !viewTarget();

/** What changes which frames are near the screen, or where they are. */
const movesFrames = (s: EditorState, prev: EditorState) =>
  s.view !== prev.view ||
  s.frames !== prev.frames ||
  s.sizes !== prev.sizes ||
  s.held !== prev.held ||
  s.canvas !== prev.canvas;

/**
 * Whether a zoom goes on: `zoomed` says one did, and `rested` is called once none has for
 * `ZOOM_REST_MS`. `stop` lets go of the wait.
 */
const zoomRest = (rested: () => void) => {
  let zooming = false;
  let rest: ReturnType<typeof setTimeout> | undefined;
  return {
    stop: () => clearTimeout(rest),
    zoomed: () => {
      zooming = true;
      clearTimeout(rest);
      rest = setTimeout(() => {
        zooming = false;
        rested();
      }, ZOOM_REST_MS);
    },
    zooming: () => zooming,
  };
};

/**
 * The frames to show: those near the screen, worked out once a frame from the view, the frames
 * and the nodes on the canvas, and handed to React only when the set changes. A frame whose
 * preview is loaded (kept by the pool) shows at once; the others load a few at a time, nearest the
 * middle first (`framesToShow`). A node dragged by its name is shown: it is where the pointer is.
 * While a zoom goes on the frames shown stay as they are, a page drawn being a frame's whole work:
 * the ones it brought near are drawn once it has rested `ZOOM_REST_MS`. A glide (a fit, a zoom to
 * the selection) loads where it goes at once.
 */
export const useFramesInView = (screen: {
  height: number;
  width: number;
}): ReadonlySet<string> => {
  const [inView, setInView] = useState<ReadonlySet<string>>(() => new Set());
  const shown = useRef<ReadonlySet<string>>(inView);
  const { height, width } = screen;
  useEffect(() => {
    let pending: number | null = null;
    // A zoom going on: nothing is drawn anew until it rests.
    const zoom = zoomRest(() => soon());
    const update = () => {
      pending = null;
      if (zoom.zooming()) {
        return;
      }
      const next = framesShownNext(shown.current, { height, width });
      if (!sameSet(shown.current, next)) {
        shown.current = next;
        setInView(next);
      }
    };
    // Several stores may change in one go (a canvas opened, then its view): one look at them all.
    const soon = () => {
      pending ??= requestAnimationFrame(update);
    };
    update();
    const offs = [
      useEditor.subscribe((s, prev) => {
        if (zoomedBy(s, prev)) {
          zoom.zoomed();
        }
        if (movesFrames(s, prev)) {
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
      // A preview that drew lets the next one load.
      onPoolChange(soon),
    ];
    return () => {
      for (const off of offs) {
        off();
      }
      if (pending !== null) {
        cancelAnimationFrame(pending);
      }
      zoom.stop();
    };
  }, [height, width]);
  return inView;
};
