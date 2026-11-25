/**
 * What a frame hands its renderer (ADR 0034): the one setup there is, made here for
 * `mountFrame` and for the renderer's tests alike, so that a renderer is tested with what the
 * editor's page gives it.
 */
import type {
  MountFrameOptions,
  PreviewSetup,
  RenderFrame,
  RenderSetup,
} from "./preview.ts";

const ABSOLUTE_URL_RE = /^(?:[a-z][a-z\d+.-]*:|\/)/i;
const LEADING_DOT_SLASH_RE = /^\.\//;

/** What only the frame knows: itself, and what follows a render reaching the screen. */
interface FrameDrawing {
  /** The frame itself: its body, its host, whether it runs. */
  readonly frame: RenderFrame;
  /** A render reached the screen: the frame's own work, then the editor told. */
  readonly rendered: (renderId: number) => void;
}

/**
 * Where the server at `assets` gives a file of a canvas: a URL as it is; a path in the canvas
 * (`assets/hero.png`), the server's file for it, without a canvas the shared one at the root of
 * the designs directory. What an image node's `src` and a fill's `url()` are drawn from.
 */
export const assetUrlOf = (
  assets: string,
  canvas: string,
  src: string
): string => {
  if (ABSOLUTE_URL_RE.test(src)) {
    return src;
  }
  const file = src.replace(LEADING_DOT_SLASH_RE, "");
  const query = new URLSearchParams({ canvas, src: file });
  return `${assets}?${query.toString()}`;
};

/** The setup frame `options` of the preview `input` mounts its renderer with. */
export const renderSetup = (
  input: Pick<PreviewSetup, "assets">,
  options: Pick<MountFrameOptions, "canvas" | "events">,
  frame: FrameDrawing
): RenderSetup => {
  const { events } = options;
  const assetUrl = (src: string) =>
    assetUrlOf(input.assets, options.canvas, src);
  return {
    assetUrl,
    frame: frame.frame,
    navigate: (route) => events.navigateTo?.(route, false),
    onRendered: frame.rendered,
    reportError: (error) => events.error?.(error),
  };
};
