import path from "node:path";
import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import {
  makeRepository,
  TestEnv,
  TestServer,
  waitForThread,
} from "./testing/harness.ts";
import { turnEnded } from "./testing/turns.ts";

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "one server, several repositories",
  (test) => {
    test.effect(
      "keeps snapshots and checkpoints to the repository they were taken in",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* client["settings.set"](settings);
          const snapshot = yield* client["snapshots.create"]({ name: "A" });
          const thread = yield* client["threads.create"]({ agentId: "fake" });
          yield* client["threads.prompt"]({
            attachments: [],
            text: "reply",
            threadId: thread.id,
          });
          yield* waitForThread(thread.id, turnEnded);
          const [checkpoint] = yield* client["checkpoints.list"]();
          assert.isDefined(checkpoint);

          const other = yield* makeRepository;
          const home = path.join(other, "designs/home.page.json");
          const page = yield* fs.readFileString(home);
          yield* client["settings.set"]({ ...settings, repoPath: other });
          assert.deepStrictEqual(yield* client["snapshots.list"](), []);
          assert.deepStrictEqual(yield* client["checkpoints.list"](), []);
          const restore = yield* Effect.flip(
            client["snapshots.restore"]({ id: snapshot.id })
          );
          assert.strictEqual(restore._tag, "NotFound");
          const revert = yield* Effect.flip(
            client["checkpoints.revert"]({ id: checkpoint?.id ?? "" })
          );
          assert.strictEqual(revert._tag, "NotFound");
          assert.strictEqual(yield* fs.readFileString(home), page);

          // Back in their own repository, they are there again.
          yield* client["settings.set"]({ ...settings, repoPath: repo });
          assert.deepStrictEqual(
            (yield* client["snapshots.list"]()).map((s) => s.id),
            [snapshot.id]
          );
          assert.deepStrictEqual(
            (yield* client["checkpoints.list"]()).map((c) => c.id),
            [checkpoint?.id]
          );
        }),
      30_000
    );
  }
);
