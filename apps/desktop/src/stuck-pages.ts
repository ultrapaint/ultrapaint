/**
 * The repository's components run on the editor's thread (ADR 0034). The preview's server stops
 * the loops of the repository's own code at 2.5 s; what it cannot see (a dependency's loop, an
 * endless chain of promises) would stop the editor for good. The preload script beats every
 * 250 ms. A page silent for 4 s that does not answer a script either (a hidden window's timers
 * are slowed, its scripts are not) has its process ended and is loaded again. The watchdog wrote
 * down the frame it was drawing at 3 s, which the editor then shows without drawing it
 * (docs/PLAN-preview-sandbox.md, step 11). The process, not only the script: a page let go on
 * after its script is ended beats again before it is loaded again, and the watchdog takes it for a
 * page that was only slow. No dialog: there is nothing to decide, and Chrome's own comes later.
 *
 * Before it is ended, Chrome reads where its script is (`stopped-at.ts`), which the page loaded
 * again asks for once (`stoppedAt` of the shell bridge): the editor names the line on the frame
 * it holds back and writes the stack to the console.
 *
 * Over the few things of the window's contents it uses (`WatchedContents`), so its timing runs on
 * the `TestClock` in tests; `main.ts` hands it Electron's.
 */
import { PREVIEW_BASE } from "@ultrapaint/contracts/preview";
import type { StoppedAt } from "@ultrapaint/contracts/shell-bridge";
import { Clock, Effect, Fiber, Option, Schedule, type Scope } from "effect";
import { stoppedAt } from "./stopped-at.ts";

/** How long the page's thread may be silent before the window asks whether it is stuck. */
export const SILENT_MS = 4000;
/** How long a page that is not stuck takes at most to answer a script. */
export const ANSWER_MS = 1000;
/** How long Chrome may take to read the stack of the script that holds a stuck page. */
export const STACK_MS = 500;
/** How often the page's silence is looked at. */
export const CHECK_MS = 500;
/** A stack Chrome read, not why it could not (`Website owner has not opted in…`). */
const STACK_RE = /^\s+at /m;

/** What of the window's contents the watchdog uses. */
export interface WatchedContents {
  /** Settles once the page runs a script: answered or refused, its thread is free. */
  readonly answer: () => Promise<unknown>;
  /** The stack of the script that holds the page, as Chrome reads it. */
  readonly callStack: () => Promise<string | undefined>;
  /** Whether the window is gone. */
  readonly destroyed: () => boolean;
  /** Ends the page's process. */
  readonly end: () => void;
  readonly reload: () => void;
}

/** What the window tells the watchdog, and what the page asks of it. */
export interface StuckPageWatch {
  /** The page's thread ran: its preload script's beat. Watched from the first. */
  readonly beat: Effect.Effect<void>;
  /** The page's process is gone: loaded again when the watchdog ended it, not before. */
  readonly gone: Effect.Effect<void>;
  /** The page starts loading: not watched until its first beat. */
  readonly loading: Effect.Effect<void>;
  /** Where the page was stuck when it was last ended; once, then null. */
  readonly stoppedAt: Effect.Effect<StoppedAt | null>;
  /** Chrome's own hang monitor, should it speak first: the page is ended at once. */
  readonly unresponsive: Effect.Effect<void>;
}

/**
 * Watches the page of one window until the scope closes (the window closed). `read` fetches a
 * module of the stack, for the repository's line.
 */
export const watchStuckPage = Effect.fn("watchStuckPage")(function* (
  contents: WatchedContents,
  read: (url: string) => Promise<string>
): Effect.fn.Return<StuckPageWatch, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  let lastBeat = yield* Clock.currentTimeMillis;
  // Watched from the new page's first beat, which its preload script sends before the page's
  // own scripts run: a page can be stuck before it has finished loading.
  let watching = false;
  /** The process was ended here: loaded again once it is gone, not before (it would be ignored). */
  let ended = false;
  /** Where the page was stuck when it was last ended, until the page loaded again asks. */
  let stopped: Fiber.Fiber<StoppedAt> | null = null;

  const readStack = Effect.tryPromise(() => contents.callStack()).pipe(
    Effect.timeoutOption(STACK_MS),
    Effect.map(Option.getOrUndefined),
    Effect.orElseSucceed(() => undefined)
  );

  const end = Effect.gen(function* () {
    if (!watching || contents.destroyed()) {
      return;
    }
    watching = false;
    ended = true;
    const time = yield* Clock.currentTimeMillis;
    const stack = yield* readStack;
    if (stack !== undefined && STACK_RE.test(stack)) {
      stopped = yield* Effect.promise(() =>
        stoppedAt(stack, read, PREVIEW_BASE).catch(() => undefined)
      ).pipe(
        Effect.map((at): StoppedAt => ({ at, stack, time })),
        Effect.forkIn(scope)
      );
    }
    if (!contents.destroyed()) {
      contents.end();
    }
  });

  const check = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (!watching || contents.destroyed() || now - lastBeat < SILENT_MS) {
      return;
    }
    const answered = yield* Effect.promise(() =>
      contents.answer().then(
        () => true,
        () => true
      )
    ).pipe(Effect.timeoutOption(ANSWER_MS), Effect.map(Option.isSome));
    if (answered) {
      lastBeat = yield* Clock.currentTimeMillis;
    } else {
      yield* end;
    }
  });

  yield* Effect.forkScoped(Effect.repeat(check, Schedule.spaced(CHECK_MS)));

  return {
    beat: Effect.map(Clock.currentTimeMillis, (now) => {
      lastBeat = now;
      watching = true;
    }),
    gone: Effect.sync(() => {
      if (ended) {
        ended = false;
        contents.reload();
      }
    }),
    loading: Effect.sync(() => {
      watching = false;
    }),
    stoppedAt: Effect.suspend(() => {
      const found = stopped;
      stopped = null;
      return found ? Fiber.join(found) : Effect.succeed(null);
    }),
    unresponsive: end,
  };
});
