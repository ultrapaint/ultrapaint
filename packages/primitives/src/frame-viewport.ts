/**
 * Floating UI keeps a popup inside the window as well as inside its collision boundary. A frame
 * is a page of its own, and the window is the editor's: a frame half off the screen would push
 * its popups around as the canvas pans. Here the viewport of anything floating in a frame is the
 * frame, and the space kept from its edges is in the frame's own pixels, so where a popup goes
 * depends on its page alone, whatever the camera does.
 *
 * Base UI positions with `@floating-ui/dom`'s shared `platform`; this wraps its clipping rect once,
 * for every popup of the editor's page. Outside a frame nothing changes.
 */
import { platform } from "@floating-ui/dom";

/** The space kept between a popup and its frame's edges, in the frame's pixels. */
export const FRAME_EDGE = 6;

const FRAME_HOST_ATTRIBUTE = "data-ed-frame-host";

/** The frame host an element is drawn in: the host of its shadow root, when that is a frame's. */
const frameHostOf = (element: unknown): HTMLElement | null => {
  if (!(element instanceof Element)) {
    return null;
  }
  const root = element.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : null;
  return host instanceof HTMLElement && host.hasAttribute(FRAME_HOST_ATTRIBUTE)
    ? host
    : null;
};

let installed = false;

export const installFrameViewport = () => {
  if (installed) {
    return;
  }
  installed = true;
  const { getClippingRect } = platform;
  platform.getClippingRect = async function (args) {
    const host = frameHostOf(args.element);
    if (!host) {
      return getClippingRect.call(this, args);
    }
    const box = host.getBoundingClientRect();
    const rect = await getClippingRect.call(this, {
      ...args,
      rootBoundary: {
        height: box.height,
        width: box.width,
        x: box.left,
        y: box.top,
      },
    });
    const zoom = host.offsetWidth > 0 ? box.width / host.offsetWidth : 1;
    const inset = FRAME_EDGE * (zoom || 1);
    return {
      height: Math.max(0, rect.height - 2 * inset),
      width: Math.max(0, rect.width - 2 * inset),
      x: rect.x + inset,
      y: rect.y + inset,
    };
  };
};
