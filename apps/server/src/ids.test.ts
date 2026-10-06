import { homedir, tmpdir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { AppLog } from "./app-log.ts";
import { ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { safeCanvasId, safeFileId } from "./ids.ts";
import { Storage } from "./services/storage.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";

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

/** The thread store alone, its state in `home`. */
const storeIn = (home: string) =>
  ThreadStore.layer.pipe(
    Layer.provide(Storage.layer),
    Layer.provide(AppLog.layer),
    Layer.provide(EventBus.layer),
    Layer.provide(
      Layer.succeed(ServerConfig, {
        briefing: true,
        cwd: home,
        discovery: false,
        host: "127.0.0.1",
        machine: {
          addresses: [],
          home: homedir(),
          path: process.env.PATH ?? "",
          tmpdir: tmpdir(),
          uid: process.getuid?.(),
        },
        mcp: false,
        port: 0,
        storage: { home, mode: "managed" },
        userDir: home,
        version: "test",
        webDist: undefined,
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
});
