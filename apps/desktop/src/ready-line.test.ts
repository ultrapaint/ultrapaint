import { assert, describe, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { firstReadyLine } from "./ready-line.ts";

const out = (...chunks: string[]) =>
  Stream.fromIterable(chunks.map((c) => new TextEncoder().encode(c)));

const READY = {
  pid: 42,
  port: 4800,
  token: "abc",
  url: "http://127.0.0.1:4800",
};

describe("firstReadyLine", () => {
  it.effect("reads the line, however the output was cut into chunks", () =>
    Effect.gen(function* () {
      const line = JSON.stringify(READY);
      const ready = yield* firstReadyLine(
        out(line.slice(0, 10), line.slice(10), "\n")
      );
      assert.deepStrictEqual(ready, READY);
    })
  );

  it.effect("passes over what is not a ready line before it", () =>
    Effect.gen(function* () {
      const ready = yield* firstReadyLine(
        out(
          "warning: something\n",
          '{"pid":"not a number"}\n',
          `${JSON.stringify({ ...READY, attached: true })}\n`
        )
      );
      assert.isTrue(ready.attached);
      assert.strictEqual(ready.url, READY.url);
    })
  );

  it.effect("fails when the output ends without one", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(firstReadyLine(out("nothing\n")));
      assert.strictEqual(error._tag, "ServerStartError");
      assert.include(error.message, "stopped before");
    })
  );
});
