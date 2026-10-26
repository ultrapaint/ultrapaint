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
