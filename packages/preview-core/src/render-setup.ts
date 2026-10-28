/**
 * What a frame hands its renderer (ADR 0034): the one setup there is, made here for
 * `mountFrame` and for the renderer's tests alike, so that a renderer is tested with what the
 * editor's page gives it.
 */
import type {
  ComponentRegistry,
  MountFrameOptions,
  PreviewSetup,
  RenderFrame,
  RenderSetup,
} from "@ultrapaint/framework-api/browser";
import { publicUrlOf } from "./public-url.ts";
import { setDesignCss } from "./styles.ts";

const ABSOLUTE_URL_RE = /^(?:[a-z][a-z\d+.-]*:|\/)/i;
const LEADING_DOT_SLASH_RE = /^\.\//;

/** What only the frame knows: whose turn it is, and what follows a render reaching the screen. */
export interface FrameDrawing {
  readonly components: ComponentRegistry;
  /** The frame's turn (`turn.ts`): its renderer says it draws. */
  readonly drawing: () => void;
  /** The frame itself: its body, its host, whether it runs. */
  readonly frame: RenderFrame;
  /** A render reached the screen: the frame's own work, then the editor told. */
  readonly rendered: (renderId: number) => void;
}

/** The setup frame `options` of the preview `input` mounts its renderer with. */
export const renderSetup = (
  input: Omit<PreviewSetup, "components">,
  options: Pick<MountFrameOptions, "canvas" | "events">,
  frame: FrameDrawing
): RenderSetup => {
  const { events } = options;
  const publicUrl = publicUrlOf(input.publicFiles);
  const assetUrl = (src: string) => {
    if (ABSOLUTE_URL_RE.test(src)) {
      return publicUrl(src);
    }
    const file = src.replace(LEADING_DOT_SLASH_RE, "");
    // Without a canvas, the shared file at the root of the designs directory.
    const query = new URLSearchParams({ canvas: options.canvas, src: file });
    return `${input.assets}?${query.toString()}`;
  };
  return {
    assetUrl,
    components: frame.components,
    drawing: frame.drawing,
    frame: frame.frame,
    navigate: (route) => events.navigateTo?.(route, false),
    onRendered: frame.rendered,
    // A frame is the page's window: what fills the window's height fills the frame's.
    pageHeight: "100cqh",
    providers: input.providers,
    publicUrl,
    reportError: (error) => events.error?.({ ...error, source: "page" }),
    reportInstances: (instances) => events.instances?.(instances),
    setDesignCss,
  };
};
