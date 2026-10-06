import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { safeCanvasId, safeFileId } from "./ids.ts";

describe("the ids joined into paths", () => {
  it.effect("are refused when they would name something elsewhere", () =>
    Effect.gen(function* () {
      for (const id of ["..", "../settings", "a/b", ""]) {
        const error = yield* Effect.flip(safeFileId("thread", id));
        assert.strictEqual(error._tag, "NotFound");
      }
      for (const id of ["..", "../..", "a/../../b", "/etc"]) {
        const error = yield* Effect.flip(safeCanvasId(id));
        assert.strictEqual(error._tag, "NotFound");
      }
      assert.strictEqual(
        yield* safeFileId("thread", "thread_lx3k9a_4f2k1"),
        "thread_lx3k9a_4f2k1"
      );
      assert.strictEqual(yield* safeCanvasId("flows/sign-in"), "flows/sign-in");
      assert.strictEqual(yield* safeCanvasId(""), "");
    })
  );
});
