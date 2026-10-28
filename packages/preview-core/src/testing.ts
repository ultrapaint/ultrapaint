/**
 * The preview core under test, in happy-dom: the real `createPreview` with a scripted renderer.
 * When a frame draws, the renderer runs what the test says its page does (`page`) and says it
 * drew. A test of preview-core and one of the editor's frames draw with the same core this way.
 *
 * For tests only: imported as `@ultrapaint/preview-core/testing`, never by the editor.
 */
import type {
  Preview,
  RenderSetup,
  RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import { createPreview } from "./frame.ts";

/** What a page does as its frame draws. */
export type PageCode = (setup: RenderSetup) => void;

export interface ScriptedPreview {
  /** What the page does whenever a frame draws, from now on; nothing at first. */
  readonly page: (code: PageCode) => void;
  readonly preview: Preview;
}

let made: ScriptedPreview | null = null;

/** The preview of this test file, made the first time it is asked for. */
export const scriptedPreview = (): ScriptedPreview => {
  if (made) {
    return made;
  }
  let code: PageCode = () => undefined;
  // Draws as a renderer does: the page's code runs, then the render has reached the screen.
  const render: RenderToCanvas = (setup) => ({
    render: (request) => {
      code(setup);
      setup.onRendered(request.renderId);
    },
    unmount: () => undefined,
  });
  const preview = createPreview(render, {
    assets: "/api/asset",
    theme: "light",
  });
  made = {
    page: (next) => {
      code = next;
    },
    preview,
  };
  return made;
};
