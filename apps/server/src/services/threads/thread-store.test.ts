import { homedir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { TestClock } from "effect/testing";
import { AppLog } from "../../app-log.ts";
import { ServerConfig } from "../../config.ts";
import { EventBus } from "../../events.ts";
import { Storage } from "../storage.ts";
import { ThreadStore } from "./thread-store.ts";

/** The thread store alone, its state in `home`. */
const storeIn = (home: string) =>
  ThreadStore.layer.pipe(
    Layer.provide(Storage.layer),
    Layer.provide(AppLog.layer),
    Layer.provide(EventBus.layer),
    Layer.provide(
      ServerConfig.layerTest({
        cwd: home,
        machine: { home: homedir() },
        storage: { home, mode: "managed" },
        userDir: home,
      })
    )
  );

describe("ThreadStore", () => {
  it.effect("removes a thread's file and nothing beside it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const settings = path.join(home, "settings.json");
      yield* fs.writeFileString(settings, "{}\n");
      yield* Effect.gen(function* () {
        const store = yield* ThreadStore;
        yield* store.remove("../settings");
        assert.isTrue(yield* fs.exists(settings));
        yield* store.add({
          agentId: "fake",
          createdAt: 0,
          id: "thread_a_00001",
          status: "idle",
          title: "A",
          updatedAt: 0,
        });
        const file = path.join(home, "threads", "thread_a_00001.json");
        assert.isTrue(yield* fs.exists(file));
        yield* store.remove("thread_a_00001");
        assert.isFalse(yield* fs.exists(file));
      }).pipe(Effect.provide(storeIn(home)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "writes a streamed reply after a pause, and whatever is left when it closes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const file = path.join(home, "threads", "thread_a_00001.json");
        const written = Effect.map(
          fs.readFileString(file),
          (json) => JSON.parse(json).items[0]?.text
        );
        /** The file once it says `text`: the write runs on real I/O after the clock moves. */
        const writtenAs = (text: string) =>
          Effect.gen(function* () {
            for (let i = 0; i < 2000; i += 1) {
              if ((yield* written) === text) {
                return;
              }
              yield* Effect.yieldNow;
            }
            assert.fail(`the thread file never said ${text}`);
          });
        yield* Effect.gen(function* () {
          const store = yield* ThreadStore;
          yield* store.add({
            agentId: "fake",
            createdAt: 0,
            id: "thread_a_00001",
            status: "idle",
            title: "A",
            updatedAt: 0,
          });
          yield* store.push("thread_a_00001", {
            at: 0,
            id: "item_1",
            kind: "agent",
            text: "a",
          });
          assert.strictEqual(yield* written, "a");
          const append = (text: string) =>
            store.patchItem("thread_a_00001", "item_1", (item) =>
              item.kind === "agent" ? { ...item, text: item.text + text } : item
            );
          yield* append("b");
          yield* append("c");
          assert.strictEqual(yield* written, "a");
          yield* TestClock.adjust("250 millis");
          yield* writtenAs("abc");
          yield* append("d");
        }).pipe(Effect.provide(storeIn(home)));
        assert.strictEqual(yield* written, "abcd");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
