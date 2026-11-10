import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Stream } from "effect";
import { watchReadyLine } from "./ready-line.ts";

const out = (...chunks: string[]) =>
  Stream.fromIterable(chunks.map((c) => new TextEncoder().encode(c)));

const READY = {
  pid: 42,
  port: 4800,
  token: "abc",
  url: "http://127.0.0.1:4800",
};

describe("watchReadyLine", () => {
  it.effect("reads the line, however the output was cut into chunks", () =>
    Effect.gen(function* () {
      const line = JSON.stringify(READY);
      const ready = yield* watchReadyLine(
        out(line.slice(0, 10), line.slice(10), "\n")
      );
      assert.deepStrictEqual(ready, READY);
    }).pipe(Effect.scoped)
  );

  it.effect("passes over what is not a ready line before it", () =>
    Effect.gen(function* () {
      const ready = yield* watchReadyLine(
        out(
          "warning: something\n",
          '{"pid":"not a number"}\n',
          `${JSON.stringify({ ...READY, attached: true })}\n`
        )
      );
      assert.isTrue(ready.attached);
      assert.strictEqual(ready.url, READY.url);
    }).pipe(Effect.scoped)
  );

  it.effect("fails when the output ends without one", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(watchReadyLine(out("nothing\n")));
      assert.strictEqual(error._tag, "ServerStartError");
      assert.include(error.message, "stopped before");
    }).pipe(Effect.scoped)
  );

  it.effect("fails when the output cannot be read", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        watchReadyLine(Stream.concat(out("a log\n"), Stream.fail("closed")))
      );
      assert.strictEqual(error._tag, "ServerStartError");
      assert.include(error.message, "could not be read");
    }).pipe(Effect.scoped)
  );

  it.effect("keeps the first line, and reads what comes after it", () =>
    Effect.gen(function* () {
      let read = 0;
      // The output read to its end: what the test waits for, not time passing.
      const drained = yield* Deferred.make<void>();
      const chunks = [
        "log\n",
        `${JSON.stringify({ ...READY, attached: true })}\n`,
        "later\n",
        `${JSON.stringify({ ...READY, port: 4801 })}\n`,
        "more\n",
      ];
      const ready = yield* watchReadyLine(
        Stream.fromIterable(chunks).pipe(
          Stream.tap(() =>
            Effect.sync(() => {
              read += 1;
            })
          ),
          Stream.map((c) => new TextEncoder().encode(c)),
          Stream.onEnd(Deferred.succeed(drained, undefined))
        )
      );
      assert.isTrue(ready.attached);
      assert.strictEqual(ready.port, READY.port);
      yield* Deferred.await(drained);
      assert.strictEqual(read, chunks.length);
    }).pipe(Effect.scoped)
  );
});
