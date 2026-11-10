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

const THREAD = {
  agentId: "fake",
  createdAt: 0,
  id: "thread_a_00001",
  status: "idle",
  title: "A",
  updatedAt: 0,
} as const;

/** The thread's file under `home`, as it is written now. */
const storedIn = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const json = yield* fs.readFileString(
      path.join(home, "threads", `${THREAD.id}.json`)
    );
    return JSON.parse(json) as {
      readonly items: readonly {
        readonly id: string;
        readonly text?: string;
      }[];
      readonly thread: { readonly title: string };
    };
  });

/** Waits until `read` gives `wanted`: the write runs on real I/O after the clock moves. */
const eventually = <A, E, R>(read: Effect.Effect<A, E, R>, wanted: A) =>
  Effect.gen(function* () {
    for (let i = 0; i < 2000; i += 1) {
      const found = yield* read;
      if (JSON.stringify(found) === JSON.stringify(wanted)) {
        return;
      }
      yield* Effect.yieldNow;
    }
    assert.fail(`the thread file never said ${JSON.stringify(wanted)}`);
  });

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
    "answers a transcript as it is when read, whatever is said after",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        yield* Effect.gen(function* () {
          const store = yield* ThreadStore;
          yield* store.add(THREAD);
          const push = (id: string) =>
            store.push(THREAD.id, { at: 0, id, kind: "agent", text: id });
          yield* push("item_1");
          const read = yield* store.items(THREAD.id);
          yield* push("item_2");
          yield* store.appendText(THREAD.id, "item_1", " and more");
          assert.deepStrictEqual(read, [
            { at: 0, id: "item_1", kind: "agent", text: "item_1" },
          ]);
        }).pipe(Effect.provide(storeIn(home)));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "writes a streamed reply after a pause, and whatever is left when it closes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        const text = Effect.map(
          storedIn(home),
          (stored) => stored.items[0]?.text
        );
        yield* Effect.gen(function* () {
          const store = yield* ThreadStore;
          yield* store.add(THREAD);
          yield* store.push(THREAD.id, {
            at: 0,
            id: "item_1",
            kind: "agent",
            text: "a",
          });
          const append = (chunk: string) =>
            store.patchItem(THREAD.id, "item_1", (item) =>
              item.kind === "agent"
                ? { ...item, text: item.text + chunk }
                : item
            );
          yield* append("b");
          yield* append("c");
          assert.isUndefined(yield* text);
          yield* TestClock.adjust("250 millis");
          yield* eventually(text, "abc");
          yield* append("d");
        }).pipe(Effect.provide(storeIn(home)));
        assert.strictEqual(yield* text, "abcd");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "writes a turn's new items and the thread's changes together after a pause, and whatever is left when it closes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        const said = Effect.map(storedIn(home), (stored) => [
          stored.thread.title,
          ...stored.items.map((item) => item.id),
        ]);
        yield* Effect.gen(function* () {
          const store = yield* ThreadStore;
          yield* store.add(THREAD);
          const push = (id: string) =>
            store.push(THREAD.id, { at: 0, id, kind: "agent", text: id });
          yield* push("item_1");
          yield* store.update(THREAD.id, { title: "B" });
          yield* push("item_2");
          // The thread as it was added: nothing since has been written yet.
          assert.deepStrictEqual(yield* said, ["A"]);
          yield* TestClock.adjust("250 millis");
          yield* eventually(said, ["B", "item_1", "item_2"]);
          yield* push("item_3");
          yield* store.update(THREAD.id, { title: "C" });
        }).pipe(Effect.provide(storeIn(home)));
        assert.deepStrictEqual(yield* said, [
          "C",
          "item_1",
          "item_2",
          "item_3",
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "reads a thread written while its agent ran, or with a status no longer written, as idle",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(path.join(home, "threads"));
        const written = (id: string, status: string) =>
          fs.writeFileString(
            path.join(home, "threads", `${id}.json`),
            JSON.stringify({
              items: [],
              thread: {
                agentId: "fake",
                createdAt: 0,
                id,
                status,
                title: id,
                updatedAt: 0,
              },
            })
          );
        yield* written("thread_a_00001", "running");
        yield* written("thread_b_00001", "starting");
        yield* written("thread_c_00001", "closed");
        const threads = yield* Effect.gen(function* () {
          const store = yield* ThreadStore;
          return yield* store.list;
        }).pipe(Effect.provide(storeIn(home)));
        assert.deepStrictEqual(threads.map((t) => [t.id, t.status]).sort(), [
          ["thread_a_00001", "idle"],
          ["thread_b_00001", "idle"],
          ["thread_c_00001", "idle"],
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
