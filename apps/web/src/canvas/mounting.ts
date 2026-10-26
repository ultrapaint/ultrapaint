/**
 * Which frames of the canvas have their preview mounted. Pure, so it is tested without a canvas.
 */

interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface View {
  x: number;
  y: number;
  zoom: number;
}

/** How far off screen, in screen pixels, a frame still counts as near it. */
export const NEAR_MARGIN = 400;

/** The frames whose box is within `margin` of the screen at `view`. */
export const framesNear = (
  boxes: Readonly<Record<string, Box>>,
  view: View,
  screen: { height: number; width: number },
  margin: number
): Set<string> => {
  const near = new Set<string>();
  for (const [id, f] of Object.entries(boxes)) {
    const left = f.x * view.zoom + view.x;
    const top = f.y * view.zoom + view.y;
    if (
      left + f.width * view.zoom > -margin &&
      top + f.height * view.zoom > -margin &&
      left < screen.width + margin &&
      top < screen.height + margin
    ) {
      near.add(id);
    }
  }
  return near;
};

/**
 * The frames to show among those near the screen: those already shown, those whose preview is
 * loaded and draws at once, and the others a few at a time, nearest the middle of the screen
 * first, so that no more than `loadingMax` previews load together.
 */
export const framesToShow = ({
  boxes,
  loadingMax,
  near,
  screen,
  shown,
  view,
  warm,
}: {
  boxes: Readonly<Record<string, Box>>;
  loadingMax: number;
  near: ReadonlySet<string>;
  screen: { height: number; width: number };
  /** What was shown before: a frame stays shown while it is near. */
  shown: ReadonlySet<string>;
  view: View;
  /** Whether a frame's preview is loaded and has drawn. */
  warm: (id: string) => boolean;
}): Set<string> => {
  const next = new Set<string>();
  for (const id of near) {
    if (shown.has(id) || warm(id)) {
      next.add(id);
    }
  }
  let loading = [...next].filter((id) => !warm(id)).length;
  const cx = screen.width / 2;
  const cy = screen.height / 2;
  const distance = (id: string) => {
    const f = boxes[id] as Box;
    const x = (f.x + f.width / 2) * view.zoom + view.x;
    const y = (f.y + f.height / 2) * view.zoom + view.y;
    return Math.hypot(x - cx, y - cy);
  };
  const waiting = [...near]
    .filter((id) => !next.has(id) && boxes[id] !== undefined)
    .sort((a, b) => distance(a) - distance(b));
  for (const id of waiting) {
    if (loading >= loadingMax) {
      break;
    }
    next.add(id);
    loading += 1;
  }
  return next;
};
