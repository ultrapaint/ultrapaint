/**
 * What keeps a page that froze the editor from freezing it again (docs/PLAN-preview-sandbox.md,
 * step 4). The repository's components run on the editor's thread (ADR 0034): a loop in one
 * stops the editor for good, and the editor, loaded again, would draw the same canvas and stop
 * again. A worker hears the editor's heartbeat and is told which frame's page code runs, as the
 * preview says (drawing, or answering input). When the editor goes silent while one does, the
 * worker writes it down; the editor, loaded again, shows that frame as a placeholder until it is
 * asked to draw it anyway.
 */
import type { Preview } from "@ultrapaint/framework-api/browser";
import { create } from "zustand";
import {
  frozenFrames,
  removeFrozen,
  type WatchdogMessage,
} from "./watchdog-store.ts";

const BEAT_MS = 250;
/** How long after the preview last said so a frame may still be running its own code. */
const AFTERWARDS_MS = 1000;

let worker: Worker | null = null;
/** The project the frames are of: its repository's path. */
let project = "";

const tell = (msg: WatchdogMessage) => worker?.postMessage(msg);

/** The frames that froze the editor before and wait to be drawn anyway. */
export const useFrozen = create<{ frames: ReadonlySet<string> }>(() => ({
  frames: new Set(),
}));

const start = () => {
  if (worker || typeof Worker === "undefined") {
    return;
  }
  try {
    worker = new Worker(new URL("./watchdog-worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    // Without a worker nothing is written down: a frozen page freezes the editor again.
    return;
  }
  setInterval(() => tell({ type: "beat" }), BEAT_MS);
};

/**
 * Reads which frames of this project froze the editor, and starts listening for the next. The
 * preview is not drawn before it answers, so a frozen page is never drawn first.
 */
export const readFrozen = async (repoPath: string): Promise<void> => {
  start();
  project = repoPath;
  tell({ project, type: "project" });
  try {
    useFrozen.setState({ frames: new Set(await frozenFrames(project)) });
  } catch {
    // No IndexedDB (a private window): nothing was written down either.
  }
};

/** Tells the watchdog whose page code runs, as the preview says: the frame to blame. */
export const watchPreview = (preview: Preview) =>
  preview.onRunning((frame) =>
    tell({ forMs: AFTERWARDS_MS, frame, type: "suspect" })
  );

/** Draws `frame` again though it froze the editor before. */
export const drawAnyway = (frame: string) => {
  const frames = new Set(useFrozen.getState().frames);
  frames.delete(frame);
  useFrozen.setState({ frames });
  removeFrozen(project, frame).catch(() => undefined);
};

/** Not held back from the next load: a frame tried once more then, not drawn now. */
export const tryNextTime = (frame: string) => {
  removeFrozen(project, frame).catch(() => undefined);
};
