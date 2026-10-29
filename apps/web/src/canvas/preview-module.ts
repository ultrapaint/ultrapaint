/**
 * The preview the editor draws its frames with (ADR 0040): the editor's system components, on Base
 * UI, drawn by the editor's own React in every frame. Nothing is loaded from the repository: a
 * project with no code at all draws the same.
 */

import { createPreview } from "@ultrapaint/preview-core/frame";
import type { Preview } from "@ultrapaint/preview-core/preview";
import { renderToCanvas } from "@ultrapaint/renderer-react/render";
import { installFrameViewport } from "@ultrapaint/system-components/frame-viewport";
import { SYSTEM_COMPONENTS_CSS } from "@ultrapaint/system-components/look";
import { previewLoaded } from "./from-frame.ts";

/** Where the server answers which file an image of a canvas is. */
const ASSET_ROUTE = "/api/asset";

let preview: Preview | null = null;

/** The one preview of the editor's page, made the first time it is asked for: what draws outside React (pictures, the look) asks for it here. */
export const thePreview = (): Preview => {
  if (!preview) {
    installFrameViewport();
    preview = createPreview(renderToCanvas, {
      assets: ASSET_ROUTE,
      css: SYSTEM_COMPONENTS_CSS,
      theme: "light",
    });
    previewLoaded(preview);
  }
  return preview;
};

/** The preview the frames draw with. */
export const usePreview = (): Preview => thePreview();
