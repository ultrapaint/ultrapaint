/**
 * The watchdog's own thread (docs/PLAN-preview-sandbox.md, step 4). The editor's page shares its
 * thread with the repository's components (ADR 0034): a loop in one of them stops the editor,
 * and nothing on that thread can stop it. This thread cannot either, but it sees the editor go
 * silent while a frame was drawing or answering a click, and writes that frame down, so that the
 * editor, loaded again, does not draw it again on its own. When the editor comes back by itself
 * it was only slow, and the frame is struck off again.
 */
import {
  addFrozen,
  removeFrozen,
  type WatchdogMessage,
} from "./watchdog-store.ts";

/** How long the editor may be silent before a suspect frame is taken to have frozen it. */
const FROZEN_MS = 3000;
const CHECK_MS = 500;

let project = "";
let lastBeat = performance.now();
/** The frame the editor said may be busy, and until when it said so. */
let suspect: { readonly frame: string; readonly until: number } | null = null;
let written: string | null = null;

self.onmessage = (event: MessageEvent<WatchdogMessage>) => {
  const msg = event.data;
  if (msg.type === "beat") {
    lastBeat = performance.now();
    if (written !== null) {
      removeFrozen(project, written).catch(() => undefined);
      written = null;
    }
    return;
  }
  if (msg.type === "project") {
    ({ project } = msg);
    return;
  }
  suspect = {
    frame: msg.frame,
    until: performance.now() + msg.forMs,
  };
};

setInterval(() => {
  if (
    written === null &&
    suspect !== null &&
    performance.now() - lastBeat > FROZEN_MS &&
    suspect.until >= lastBeat
  ) {
    written = suspect.frame;
    addFrozen(project, written).catch(() => undefined);
  }
}, CHECK_MS);
