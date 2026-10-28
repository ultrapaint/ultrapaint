/**
 * The turn: whose page code runs in the editor's page (ADR 0034). One window serves every frame,
 * so what the page's code asks of it (the window's size, a listener, a popup, a timer, `history`)
 * is about the frame whose turn it is: the one drawing (the renderer says so as it draws and as
 * its effects run), the one the editor drew last, the one that took input, or the one whose
 * callback a guard is calling (a listener, a timer, an animation frame). Every guard reads the
 * turn here, so the popups, the window's size, the listeners, the timers and the watchdog's
 * notice name the same frame; `kernel.ts` registers the frames and installs the guards.
 *
 * Whether it is the page's code that asks at all is not the turn's: the caller's stack says
 * (`provenance.ts`).
 */

/** What a frame is told of an error its page's code threw. */
export interface FrameError {
  readonly file?: string | undefined;
  readonly line?: number | undefined;
  readonly message: string;
  readonly stack?: string | undefined;
}

/** A frame as the guards know it. */
export interface Frame {
  /** The element standing for its page's `<body>`, inside its shadow root: where popups go. */
  readonly body: HTMLElement;
  /** Its page's code threw and nothing caught it. */
  readonly error: (error: FrameError) => void;
  readonly host: HTMLElement;
  /** The frame takes input: the prototype, interact mode. */
  readonly interactive: () => boolean;
  /** What it was mounted as (a frame on the canvas, the prototype): what the watchdog is told. */
  readonly name: string;
  /** A page the frame's code pushed: the prototype follows it. */
  readonly navigate: (route: string, replace: boolean) => void;
  /** Its shadow root, holding `body`. */
  readonly shadow: ShadowRoot;
  /** A picture: drawn wherever it is, its animation frames never held. */
  readonly still: boolean;
}

/** The frames mounted, by host: an event's frame is the host on its path. */
const frames = new Map<HTMLElement, Frame>();
/** The frame asked about last: drawing, drawn by the editor, taking input, or called back. */
let asked: Frame | null = null;
/** The frame whose callback the guards are calling: its page's code runs, no stack to read. */
let carried: Frame | null = null;
/** The frame whose `scroll` or `resize` is being told: the window's position is its. */
let relayed: Frame | null = null;

/** How often a frame whose code keeps running is told again. */
const RUNNING_EVERY_MS = 200;
const runningListeners = new Set<(frame: string) => void>();
let running: { at: number; frame: string } | null = null;

/** `frame`'s page code runs: told when it changes, and again now and then while it does. */
const tellRunning = (frame: string) => {
  const now = performance.now();
  if (running?.frame === frame && now - running.at < RUNNING_EVERY_MS) {
    return;
  }
  running = { at: now, frame };
  for (const listener of runningListeners) {
    listener(frame);
  }
};

/**
 * Hears which frame's page code runs, by its name: what the editor's watchdog blames when the
 * page stops the editor's thread.
 */
export const onRunning = (listener: (frame: string) => void) => {
  runningListeners.add(listener);
  return () => {
    runningListeners.delete(listener);
  };
};

/** It is `frame`'s turn: it is drawing, drawn or took input. */
export const ask = (frame: Frame) => {
  asked = frame;
  tellRunning(frame.name);
};

/** Runs `f` as `frame`'s page code: what it asks of the window, throws or schedules is its. */
export const runAs = <T>(frame: Frame, f: () => T): T => {
  const before = carried;
  carried = frame;
  ask(frame);
  try {
    return f();
  } finally {
    carried = before;
  }
};

/** Runs `f` while `frame`'s `scroll` or `resize` is told: the window's position is the frame's. */
export const relaying = <T>(frame: Frame, f: () => T): T => {
  const before = relayed;
  relayed = frame;
  try {
    return f();
  } finally {
    relayed = before;
  }
};

/** The frame asked about last, or null: no frame drawn, or the one asked about went. */
export const askedFrame = (): Frame | null => asked;

/** The frame whose callback a guard is calling, or null. */
export const carriedFrame = (): Frame | null => carried;

/** The frame whose turn it is: the one called back, or else the one asked about last. */
export const turnFrame = (): Frame | null => carried ?? asked;

/** The frame whose `scroll` or `resize` is being told, or null. */
export const relayedFrame = (): Frame | null => relayed;

/** The frame `host` holds, when it is one. */
const frameOfHost = (host: unknown): Frame | undefined =>
  frames.get(host as HTMLElement);

/** The frame an event comes from: the host of a mounted frame on its path, or null. */
export const frameOfEvent = (event: Event): Frame | null => {
  for (const node of event.composedPath()) {
    const frame = frameOfHost(node);
    if (frame) {
      return frame;
    }
  }
  return null;
};

/** The only frame mounted, when there is exactly one. */
export const onlyFrame = (): Frame | undefined =>
  frames.size === 1 ? [...frames.values()][0] : undefined;

/** `frame` is mounted from now on. */
export const addFrame = (frame: Frame) => {
  frames.set(frame.host, frame);
};

/** `frame` went: it is nobody's turn when it was its. */
export const removeFrame = (frame: Frame) => {
  frames.delete(frame.host);
  if (asked === frame) {
    asked = null;
  }
};
