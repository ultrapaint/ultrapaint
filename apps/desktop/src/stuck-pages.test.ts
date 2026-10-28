import { assert, describe, it } from "@effect/vitest";
import { MODULE_MARK } from "@ultrapaint/contracts/page-runtime";
import { Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";
import { BEAT_MS } from "./bridge.ts";
import { type WatchedContents, watchStuckPage } from "./stuck-pages.ts";

const PAGE = "http://127.0.0.1:4800/preview/src/page.tsx?t=1";
const STACK = `\n    at Spin (${PAGE}:12:3)\n    at http://127.0.0.1:4800/assets/index.js:1:1`;
const read = (url: string) =>
  url === PAGE
    ? Promise.resolve(`${MODULE_MARK}import.meta.url);spin();`)
    : Promise.reject(new Error("not found"));

/** A window's contents: whether its page answers a script, and what the watchdog did to it. */
const fakePage = (stack: string | undefined = STACK) => {
  const page: {
    /** Whether it runs a script it is asked to. */
    answers: boolean;
    asked: number;
    destroyed: boolean;
    ended: number;
    reloads: number;
  } = { answers: false, asked: 0, destroyed: false, ended: 0, reloads: 0 };
  const contents: WatchedContents = {
    answer: () => {
      page.asked += 1;
      // A stuck page never runs the script; a free one runs it at once.
      return page.answers ? Promise.resolve(0) : new Promise(() => undefined);
    },
    callStack: () => Promise.resolve(stack),
    destroyed: () => page.destroyed,
    end: () => {
      page.ended += 1;
    },
    reload: () => {
      page.reloads += 1;
    },
  };
  return { contents, page };
};

/** Lets what the page's promises resolved reach the watchdog. */
const settle = Effect.promise(
  () => new Promise<void>((resolve) => setImmediate(resolve))
);

/** Moves the clock on by `ms`, a tenth of a second at a time, settling the page's answers. */
const advance = Effect.fnUntraced(function* (ms: number) {
  for (let passed = 0; passed < ms; passed += 100) {
    yield* TestClock.adjust("100 millis");
    yield* settle;
  }
});

describe("watchStuckPage", () => {
  it.effect("leaves a page that beats alone", () =>
    Effect.gen(function* () {
      const { contents, page } = fakePage();
      const watch = yield* watchStuckPage(contents, read);
      for (let beat = 0; beat < 40; beat += 1) {
        yield* watch.beat;
        yield* advance(BEAT_MS);
      }
      assert.deepStrictEqual([page.asked, page.ended], [0, 0]);
      assert.isNull(yield* watch.stoppedAt);
    }).pipe(Effect.scoped)
  );

  it.effect(
    "ends a page silent past the limit that runs no script, its stack read and its line kept",
    () =>
      Effect.gen(function* () {
        const { contents, page } = fakePage();
        const watch = yield* watchStuckPage(contents, read);
        yield* watch.beat;
        yield* advance(4900);
        // Silent for 4 s, asked to run a script, and given a second to.
        assert.deepStrictEqual([page.asked, page.ended], [1, 0]);
        yield* advance(200);
        assert.strictEqual(page.ended, 1);
        assert.deepStrictEqual(yield* watch.stoppedAt, {
          at: "src/page.tsx:12",
          stack: STACK,
          time: 5000,
        });
        // Asked once, by the page loaded again.
        assert.isNull(yield* watch.stoppedAt);
        // Loaded again once its process is gone, and only for the page it ended.
        yield* watch.gone;
        yield* watch.gone;
        assert.strictEqual(page.reloads, 1);
        // Not watched again until the page loaded again beats.
        yield* advance(10_000);
        assert.deepStrictEqual([page.asked, page.ended], [1, 1]);
      }).pipe(Effect.scoped)
  );

  it.effect("keeps no line when Chrome could not read the stack", () =>
    Effect.gen(function* () {
      const { contents, page } = fakePage(
        "Website owner has not opted in for JS call stacks in crash reports."
      );
      const watch = yield* watchStuckPage(contents, read);
      yield* watch.beat;
      yield* advance(5100);
      assert.strictEqual(page.ended, 1);
      assert.isNull(yield* watch.stoppedAt);
    }).pipe(Effect.scoped)
  );

  it.effect(
    "leaves a silent page that runs a script: its timers were only slowed",
    () =>
      Effect.gen(function* () {
        const { contents, page } = fakePage();
        page.answers = true;
        const watch = yield* watchStuckPage(contents, read);
        yield* watch.beat;
        yield* advance(10_000);
        // Asked at 4 s, and again 4 s after it answered.
        assert.deepStrictEqual([page.asked, page.ended], [2, 0]);
      }).pipe(Effect.scoped)
  );

  it.effect("leaves a page that beats again before the limit", () =>
    Effect.gen(function* () {
      const { contents, page } = fakePage();
      const watch = yield* watchStuckPage(contents, read);
      yield* watch.beat;
      yield* advance(3500);
      yield* watch.beat;
      yield* advance(3500);
      assert.deepStrictEqual([page.asked, page.ended], [0, 0]);
    }).pipe(Effect.scoped)
  );

  it.effect("does not end a page whose window closed while it was asked", () =>
    Effect.gen(function* () {
      const { contents, page } = fakePage();
      const watch = yield* watchStuckPage(contents, read);
      yield* watch.beat;
      yield* advance(4500);
      assert.strictEqual(page.asked, 1);
      page.destroyed = true;
      yield* advance(2000);
      assert.strictEqual(page.ended, 0);
      assert.isNull(yield* watch.stoppedAt);
    }).pipe(Effect.scoped)
  );

  it.effect("stops watching once the window's scope closes mid-check", () =>
    Effect.gen(function* () {
      const { contents, page } = fakePage();
      const scope = yield* Scope.make();
      const watch = yield* watchStuckPage(contents, read).pipe(
        Scope.provide(scope)
      );
      yield* watch.beat;
      yield* advance(4500);
      yield* Scope.close(scope, Exit.void);
      yield* advance(10_000);
      assert.deepStrictEqual([page.asked, page.ended], [1, 0]);
    })
  );

  it.effect("ends a watched page when Chrome's hang monitor speaks first", () =>
    Effect.gen(function* () {
      const { contents, page } = fakePage();
      const watch = yield* watchStuckPage(contents, read);
      // Not watched before its first beat, nor while it loads.
      yield* watch.unresponsive;
      yield* watch.beat;
      yield* watch.loading;
      yield* watch.unresponsive;
      assert.strictEqual(page.ended, 0);
      yield* watch.beat;
      yield* watch.unresponsive;
      assert.strictEqual(page.ended, 1);
      assert.strictEqual((yield* watch.stoppedAt)?.at, "src/page.tsx:12");
    }).pipe(Effect.scoped)
  );
});
