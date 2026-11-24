/**
 * What the chat list does to a chat (ADR 0141): settles it or brings it back, and renames it,
 * through the editor's requests on a project of the test's own.
 */
import { assert, describe } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { perTest } from "./testing/each-test.ts";
import { TestEnv } from "./testing/harness.ts";
import { ProjectRpc } from "./testing/project.ts";

const inProject = perTest(ProjectRpc());

/** A chat made for the test, and how the list reads it. */
const aChat = Effect.gen(function* () {
  const { client } = yield* TestEnv;
  const { id: threadId } = yield* client["threads.create"]({});
  // Later than the chat was made, so a change stamped now would show.
  yield* TestClock.adjust("1 minute");
  const read = Effect.map(client["threads.list"](), (threads) =>
    threads.find((t) => t.id === threadId)
  );
  return { client, read, threadId };
});

describe("the chat list's actions", () => {
  inProject.effect("settles a chat and brings it back", () =>
    Effect.gen(function* () {
      const { client, read, threadId } = yield* aChat;
      const before = (yield* read)?.updatedAt;
      yield* client["threads.settle"]({ settled: true, threadId });
      assert.isNumber((yield* read)?.settledAt);
      // Putting a chat aside is no news of it: its place and its unread state stay.
      assert.strictEqual((yield* read)?.updatedAt, before);
      yield* client["threads.settle"]({ settled: false, threadId });
      assert.isUndefined((yield* read)?.settledAt);
    })
  );

  inProject.effect("refuses to settle or rename a chat there is not", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      const settled = yield* Effect.flip(
        client["threads.settle"]({ settled: true, threadId: "t_gone" })
      );
      const renamed = yield* Effect.flip(
        client["threads.rename"]({ threadId: "t_gone", title: "A" })
      );
      assert.deepStrictEqual(
        [settled._tag, renamed._tag],
        ["NotFound", "NotFound"]
      );
    })
  );

  inProject.effect(
    "renames a chat with the designer's title, which the agent's suggested titles then leave",
    () =>
      Effect.gen(function* () {
        const { client, read, threadId } = yield* aChat;
        const before = (yield* read)?.updatedAt;
        yield* client["threads.rename"]({
          threadId,
          title: "  Pricing hero  ",
        });
        const renamed = yield* read;
        assert.strictEqual(renamed?.updatedAt, before);
        assert.strictEqual(renamed?.title, "Pricing hero");
        // `named` is what keeps a title from the ones the agent's session suggests.
        assert.isTrue(renamed?.named);
      })
  );

  inProject.effect("keeps a chat's title when the one given is empty", () =>
    Effect.gen(function* () {
      const { client, read, threadId } = yield* aChat;
      const before = (yield* read)?.title;
      const empty = yield* Effect.flip(
        client["threads.rename"]({ threadId, title: "   " })
      );
      assert.strictEqual(empty._tag, "BadRequest");
      assert.strictEqual((yield* read)?.title, before);
    })
  );
});
