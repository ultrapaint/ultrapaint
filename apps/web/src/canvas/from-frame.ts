/**
 * Whether an event comes from inside a frame the preview draws (ADR 0034): a page in the
 * prototype, a text being edited in place. It is the page's, as it was when a frame was an
 * iframe whose events never reached the editor. The rule is the preview core's (its frames'
 * hosts); this holds the preview the editor's page loaded, which `preview-module.ts` hands in,
 * without the stores it loads with. None does before the preview has loaded.
 */
import type { Preview } from "@ultrapaint/framework-api/browser";

let loaded: Preview | null = null;

/** The preview whose frames events are told apart by, from now on. */
export const previewLoaded = (preview: Preview) => {
  loaded = preview;
};

export const fromFrame = (e: Event) => loaded?.fromFrame(e) ?? false;
