/**
 * The camera: where the canvas is looked at from (`view` in the editor's store, which this
 * module alone writes) and how it moves there. A pan or a zoom waits for the next frame and takes
 * every change of that frame in one; a fit is there at once, a zoom to the selection glides, at
 * once or once its frame is laid out. Each gives way to the next: a move said outright drops what
 * was waiting and lands what was flying. A move is fitted into what of the canvas is seen, which
 * the canvas on screen measures (`measureViewportWith`). `canvas/camera.ts` draws the view onto
 * the canvas.
 */
import { useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import { allFrames } from "./page-layout.ts";

export interface View {
  x: number;
  y: number;
  zoom: number;
}

/**
 * The part of the canvas nothing covers, in the canvas's own coordinates: `x` is where it begins,
 * past the left panel floating over the canvas's left edge.
 */
export interface Viewport {
  height: number;
  width: number;
  x: number;
}

/** How what of the canvas is seen is measured, while the canvas is on screen. */
let measure: (() => Viewport) | null = null;
const shownListeners = new Set<() => void>();

/**
 * The canvas on screen says how what of it is seen is measured (its element, less the panels
 * floating over its edges), until the answer is called: it left the screen, for the prototype.
 * A test measures with a stub.
 */
export const measureViewportWith = (measured: () => Viewport) => {
  measure = measured;
  for (const listener of shownListeners) {
    listener();
  }
  return () => {
    if (measure === measured) {
      measure = null;
    }
  };
};

/**
 * The part of the canvas that can be seen: what is fitted or zoomed into belongs there. Without a
 * canvas on screen, the window less the panels' usual width.
 */
export const viewportSize = (): Viewport =>
  measure?.() ?? {
    height: window.innerHeight,
    width: window.innerWidth - 544,
    x: 0,
  };

/**
 * How many canvas pixels make one on screen. What is drawn in the zoomed layer at a constant size
 * on screen (names, handles, outlines) is scaled by it. Only what draws such things reads it, so a
 * zoom redraws them and not the frames around them.
 */
export const useInv = () => useEditor((s) => 1 / s.view.zoom);

const show = (view: View) => useEditor.setState({ view });

/** Where the canvas is being panned or zoomed to, until the next frame draws it. */
let pendingView: View | null = null;
let viewFrame: number | null = null;

const cancelPendingView = () => {
  if (viewFrame !== null) {
    cancelAnimationFrame(viewFrame);
    viewFrame = null;
  }
  pendingView = null;
};

/** A move of the camera on its way, and where it goes. */
let flight: { frame: number; to: View } | null = null;

/** Where the camera is moving to, while it moves: what is there loads first. */
export const viewTarget = (): View | null => flight?.to ?? null;

/** Gives up a move waiting for its frame to be laid out (`zoomToSelectionOnceLaidOut`). */
let stopWaiting: () => void = () => undefined;

/**
 * Stops a move of the camera where it is, or one waiting to begin: the user took the canvas, or
 * another move began.
 */
const land = () => {
  stopWaiting();
  if (flight) {
    cancelAnimationFrame(flight.frame);
    flight = null;
  }
};

const FLIGHT_MS = 320;

const easeInOut = (k: number) =>
  k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;

/**
 * Moves the camera to `to` over a third of a second, the point in the middle of `viewport`
 * gliding while the zoom changes evenly in scale, so the way from one place to the other is
 * seen. At once when the system asks for reduced motion.
 */
const flyTo = (to: View, viewport: Viewport) => {
  cancelPendingView();
  land();
  const from = useEditor.getState().view;
  const still =
    typeof requestAnimationFrame === "undefined" ||
    typeof matchMedia === "undefined" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still || (from.x === to.x && from.y === to.y && from.zoom === to.zoom)) {
    show(to);
    return;
  }
  // The screen point that stays the middle of what is seen, in the canvas at each end.
  const mx = viewport.x + viewport.width / 2;
  const my = viewport.height / 2;
  const a = { x: (mx - from.x) / from.zoom, y: (my - from.y) / from.zoom };
  const b = { x: (mx - to.x) / to.zoom, y: (my - to.y) / to.zoom };
  const za = Math.log(from.zoom);
  const zb = Math.log(to.zoom);
  let start: number | null = null;
  const step = (now: number) => {
    start ??= now;
    const k = Math.min(1, (now - start) / FLIGHT_MS);
    if (k >= 1 || !flight) {
      flight = null;
      show(to);
      return;
    }
    const e = easeInOut(k);
    const zoom = Math.exp(za + (zb - za) * e);
    const cx = a.x + (b.x - a.x) * e;
    const cy = a.y + (b.y - a.y) * e;
    show({ x: mx - cx * zoom, y: my - cy * zoom, zoom });
    flight.frame = requestAnimationFrame(step);
  };
  flight = { frame: requestAnimationFrame(step), to };
};

/** The view as the next frame will draw it: what a wheel or a drag goes on from. */
export const nextView = (): View => pendingView ?? useEditor.getState().view;

/**
 * Pans or zooms the canvas on the next frame. A wheel or a pointer reports many times a frame,
 * and the canvas is drawn once a frame: it takes them all in one change.
 */
export const setViewSoon = (view: Partial<View>) => {
  land();
  pendingView = { ...nextView(), ...view };
  viewFrame ??= requestAnimationFrame(() => {
    viewFrame = null;
    const next = pendingView;
    pendingView = null;
    if (next) {
      show(next);
    }
  });
};

/** Sets the view at once. Said outright, it goes over whatever was waiting for the next frame. */
export const setView = (view: Partial<View>) => {
  const base = nextView();
  cancelPendingView();
  land();
  show({ ...base, ...view });
};

const fitTo = (
  viewport: Viewport,
  boxes: { x: number; y: number; width: number; height: number }[],
  /** Glides there, rather than being there at once. */
  glide = false
) => {
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.width));
  const y2 = Math.max(...boxes.map((b) => b.y + b.height));
  const pad = 60;
  const zoom = Math.min(
    4,
    Math.max(
      0.05,
      Math.min(
        (viewport.width - pad * 2) / (x2 - x1),
        (viewport.height - pad * 2) / (y2 - y1)
      )
    )
  );
  const view = {
    x: viewport.x + (viewport.width - (x2 - x1) * zoom) / 2 - x1 * zoom,
    y: (viewport.height - (y2 - y1) * zoom) / 2 - y1 * zoom,
    zoom,
  };
  if (glide) {
    flyTo(view, viewport);
    return;
  }
  // A fit takes the whole view: a pan or zoom still waiting for the next frame (a trackpad's
  // inertia) would otherwise land on top of it.
  cancelPendingView();
  land();
  show(view);
};

/** Fits everything on the canvas, pages and nodes, into what of it is seen. */
export const zoomToFit = () => {
  const frames = Object.values(allFrames());
  if (frames.length === 0) {
    return;
  }
  fitTo(viewportSize(), frames);
};

/** Glides to the page selected, or the node selected: its rect when measured, its frame else. */
export const zoomToSelection = () => {
  const viewport = viewportSize();
  const { selection, selectedPage, rects } = useEditor.getState();
  const frames = allFrames();
  const pageFrame = selectedPage ? frames[selectedPage] : undefined;
  if (pageFrame) {
    fitTo(viewport, [pageFrame], true);
    return;
  }
  if (!selection) {
    return;
  }
  const frame = frames[selection.frame];
  const rect = rects[selection.frame]?.[selection.nodeId];
  if (!frame) {
    return;
  }
  const target = rect
    ? {
        height: rect.height,
        width: rect.width,
        x: frame.x + rect.x,
        y: frame.y + rect.y,
      }
    : frame;
  fitTo(viewport, [target], true);
};

/**
 * Glides to the selection once `frame` is laid out: the canvas on screen (the prototype left, the
 * panels beside it placed) and the frame's box known, a node beside the pages once its document
 * is read. The frame need not be drawn: one off screen is drawn once the camera is there. Gives
 * way to any move of the camera meanwhile, this one asked again included, and gives up when the
 * canvas changes or the prototype opens.
 */
export const zoomToSelectionOnceLaidOut = (frame: string) => {
  land();
  const { canvas } = useEditor.getState();
  const offs: (() => void)[] = [];
  const stop = () => {
    for (const off of offs.splice(0)) {
      off();
    }
    if (stopWaiting === stop) {
      stopWaiting = () => undefined;
    }
  };
  /** Whether it is done waiting, there or given up. */
  const check = (): boolean => {
    const editor = useEditor.getState();
    if (editor.canvas !== canvas || editor.workspace !== "design") {
      stop();
      return true;
    }
    if (!(measure && allFrames()[frame])) {
      return false;
    }
    stop();
    zoomToSelection();
    return true;
  };
  if (check()) {
    return;
  }
  shownListeners.add(check);
  offs.push(
    () => shownListeners.delete(check),
    useEditor.subscribe(check),
    useDocuments.subscribe(check)
  );
  stopWaiting = stop;
};
