/**
 * The entry of the module the editor's page loads (ADR 0034): the preview core's frames, drawing
 * with the renderer it is given. The framework's build makes the bundle from this entry and its
 * renderer's `renderToCanvas` (`framework-react-vite/build.ts`), the way Storybook's builder pairs
 * its preview with a renderer: the renderer depends on the interface alone, not on the core.
 */
import type {
  Preview,
  PreviewSetup,
  RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import { createPreview } from "./frame.ts";
import { installHooks, onReloadRequest } from "./styles.ts";

/** What the bundle exports, as the generated entry imports it (`preview-files.ts`). */
export interface EditorPreview {
  /** Called once by the generated entry, after the application's modules first ran. */
  readonly createPreview: (input: PreviewSetup) => Preview;
  /** Called by the generated entry before the application's stylesheets load. */
  readonly installHooks: () => void;
  /** Hears when only loading the editor's page again brings the preview up to date. */
  readonly onReloadRequest: (listener: () => void) => () => void;
}

export const editorPreview = (render: RenderToCanvas): EditorPreview => ({
  createPreview: (input) => createPreview(render, input),
  installHooks,
  onReloadRequest,
});
