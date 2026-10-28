/**
 * The sandbox's kernel (ADR 0034, `docs/PLAN-preview-sandbox.md`): what puts the guards between
 * the preview's code and the editor's page in place, and the frames they guard. Every patch of the
 * window, the document, the head and the body is installed by `install`, once, in one order; a
 * frame is registered once, with `register`, and its handle says when it is its turn (`turn.ts`).
 *
 * The order, and why:
 *
 * 1. The page runtime the generated code calls: the styles and the reload Vite's client asks
 *    (`installHooks`: the generated entry has put them in place already, before the first
 *    stylesheet loaded, `framework-react-vite/preview-files.ts`; again is a no-op), and the guard
 *    the repository's modules call (`answerGuard`).
 * 2. What nothing caught (`reportUncaught`): listened to with the window's own
 *    `addEventListener`, before that is guarded, so the kernel's own listeners never pass a guard.
 * 3. The window's and the document's listeners, the window's `on*` handlers, its scroll and its
 *    history: what the page's code reaches the editor's page through.
 * 4. Animation frames and timers, then requests and storage.
 * 5. The head (`guardHead`, its insertions redirected), then the sheets' `insertRule` and
 *    `deleteRule` (`watchHeldStyles`), which tell the frames what is written into the styles the
 *    head held.
 * 6. The body: the popups appended to it (`routePortals`, its insertions redirected), then what
 *    is written to `<html>` and `<body>` (`guardDocumentElements`).
 * 7. The window's size and `matchMedia` (`guardMedia`).
 *
 * Each guard wraps a method or a property no guard before it wrapped, so it holds the browser's
 * own, and what the guards call themselves is the editor's by the stack: within the install no
 * step needs another before it but 2. The order is fixed so that it is read in one place and runs
 * the same every time. Nothing installs itself on first use any more; only css-in-js's holder (an
 * element, not a patch) is made with the first style held, so a page that writes none adds
 * nothing to the editor's document.
 *
 * What does matter is when `install` runs: `createPreview` calls it once the generated entry's
 * imports have run, the repository's modules and Vite's client among them, so their first
 * top-level code runs before the guards, as it always did (Vite's client is served under the
 * base too, and its own listeners and socket are not the page's); a module the dev server
 * replaces runs under them.
 */

import { watchHeldStyles } from "./css-in-js.ts";
import { guardDocumentElements } from "./document-elements.ts";
import { frameMedia, guardMedia } from "./media.ts";
import { routePortals } from "./portals.ts";
import { createProvenance, type ProvenanceOptions } from "./provenance.ts";
import { guardRequests } from "./requests.ts";
import {
  answerGuard,
  guardAnimationFrames,
  guardFrame,
  guardHandlers,
  guardHead,
  guardHistory,
  guardListeners,
  guardScroll,
  guardTimers,
  reportUncaught,
} from "./sandbox.ts";
import { guardStorage } from "./storage.ts";
import { installHooks, setCssInJs } from "./styles.ts";
import { addFrame, ask, type Frame, removeFrame, turnFrame } from "./turn.ts";

let installed = false;

/**
 * Puts every guard in place, once: later calls do nothing, whatever they are given. `base` is
 * where the preview's modules are served; a test gives the provenance a recorded stack.
 */
export const install = (options: ProvenanceOptions) => {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  const provenance = createProvenance(options);
  installHooks();
  answerGuard();
  reportUncaught(provenance);
  guardListeners(window, provenance);
  guardListeners(document, provenance);
  guardHandlers(provenance);
  guardScroll(provenance);
  guardHistory(provenance);
  guardAnimationFrames(provenance);
  guardTimers(provenance);
  guardRequests(provenance);
  guardStorage(provenance.storage);
  guardHead(provenance);
  watchHeldStyles(setCssInJs);
  routePortals(provenance);
  guardDocumentElements((patched) => {
    const frame = turnFrame();
    return frame && provenance.domWrite(patched) ? frame : null;
  });
  guardMedia(provenance);
};

/** A frame registered: what says it is its turn, and what forgets it. */
export interface FrameHandle {
  /**
   * It is the frame's turn: it is drawing, the editor drew it or it took input. What its code
   * asks of the window (its size, a popup, a listener, a timer) is about it, and the watchdog
   * is told it runs.
   */
  readonly ask: () => void;
  readonly frame: Frame;
  readonly unmount: () => void;
}

/** Guards `frame` from now on: its listeners, its scroll, its animation frames, its size. */
export const register = (frame: Frame): FrameHandle => {
  addFrame(frame);
  const guarded = guardFrame(frame);
  const media = frameMedia(frame);
  return {
    ask: () => ask(frame),
    frame,
    unmount: () => {
      media.unmount();
      guarded.unmount();
      removeFrame(frame);
    },
  };
};
