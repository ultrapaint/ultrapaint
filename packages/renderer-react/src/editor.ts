/**
 * Entry of the module the editor's page loads (ADR 0034): the preview core's frames, drawing
 * with this renderer. Bundled with `react` left as an import, so it is the repository's copy
 * that renders, as in `render.ts`.
 */
import type { PreviewSetup } from "@ultrapaint/framework-api/browser";
import { createPreview as create } from "@ultrapaint/preview-core/frame";
import {
  installHooks as install,
  onReloadRequest as onReload,
} from "@ultrapaint/preview-core/styles";
import { renderToCanvas } from "./render.ts";

/** Called by the generated entry before the application's stylesheets load. */
export const installHooks = install;

/** Hears when only loading the editor's page again brings the preview up to date. */
export const onReloadRequest = onReload;

export const createPreview = (input: Omit<PreviewSetup, "mount">) =>
  create({ ...input, mount: renderToCanvas });
