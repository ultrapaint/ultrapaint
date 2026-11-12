import path from "node:path";
import { assert } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { eachTest } from "./testing/each-test.ts";
import {
  makeRepository,
  TestEnv,
  TestServer,
  waitForThread,
} from "./testing/harness.ts";
import { turnEnded } from "./testing/turns.ts";

eachTest(TestServer, {
  realClock: "the agent is a real process, its turn heard over the socket",
})("one server, several repositories", (test) => {
  test.effect(
    "keeps the history to the repository it was taken in",
    () =>
      Effect.gen(function* () {
        const { client, repo, settings } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        yield* client["settings.set"](settings);
        const version = yield* client["history.save"]({ name: "A" });
        const thread = yield* client["threads.create"]({ agentId: "fake" });
        yield* client["threads.prompt"]({
          attachments: [],
          text: "reply",
          threadId: thread.id,
        });
        yield* waitForThread(thread.id, turnEnded);
        const ids = (yield* client["history.get"]()).points.map((p) => p.id);
        assert.include(ids, version.id);

        const other = yield* makeRepository;
        const home = path.join(other, "designs/home.page.json");
        const page = yield* fs.readFileString(home);
        yield* client["settings.set"]({ ...settings, repoPath: other });
        assert.notInclude(
          (yield* client["history.get"]()).points.map((p) => p.id),
          version.id
        );
        const restore = yield* Effect.flip(
          client["history.restore"]({ id: version.id })
        );
        assert.strictEqual(restore._tag, "NotFound");
        assert.strictEqual(yield* fs.readFileString(home), page);

        // Back in its own repository, it is there again.
        yield* client["settings.set"]({ ...settings, repoPath: repo });
        assert.deepStrictEqual(
          (yield* client["history.get"]()).points.map((p) => p.id),
          ids
        );
      }),
    30_000
  );
});
