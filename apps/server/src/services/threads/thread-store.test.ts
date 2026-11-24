import { homedir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { NotFound } from "@ultrapaint/contracts/errors";
import type { ThreadStreamItem } from "@ultrapaint/contracts/threads";
import {
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Stream,
} from "effect";
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

/** What `follow` sends up to `synchronized`, that included: what an editor resuming is told. */
const toldUpToNow = (stream: Stream.Stream<ThreadStreamItem, NotFound>) =>
  stream.pipe(
    Stream.takeUntil((told) => told.kind === "synchronized"),
    Stream.runCollect
  );

/**
 * Follows `stream` in the background, collecting what `collect` keeps of it: resolved once it is
 * synchronized, so what the test does next is a change it tells as it happens.
 */
const followedLive = (
  stream: Stream.Stream<ThreadStreamItem, NotFound>,
  collect: (
    s: Stream.Stream<ThreadStreamItem, NotFound>
  ) => Stream.Stream<ThreadStreamItem, NotFound> = (s) => s
) =>
  Effect.gen(function* () {
    const synchronized = yield* Deferred.make<void>();
    const fiber = yield* collect(
      stream.pipe(
        Stream.tap((told) =>
          told.kind === "synchronized"
            ? Deferred.succeed(synchronized, undefined)
            : Effect.void
        )
      )
    ).pipe(Stream.runCollect, Effect.forkScoped);
    yield* Deferred.await(synchronized);
    return fiber;
  });

/** An item said in `THREAD`, by its id. */
const pushed = (store: ThreadStore["Service"], id: string) =>
  store.push(THREAD.id, { at: 0, id, kind: "agent", text: id });

/** The run of the server's a store's numbers are of, as its stream says it. */
const runOf = (store: ThreadStore["Service"]) =>
  Effect.map(toldUpToNow(store.follow(THREAD.id)), (told) => {
    const last = told.at(-1);
    return last?.kind === "synchronized" ? last.run : "";
  });

/** What each told item is, in a word: `snapshot@3`, `item_2@4` (an event's item), `sync@4`. */
const shape = (told: readonly ThreadStreamItem[]) =>
  told.map((t) => {
    if (t.kind === "snapshot") {
      return `snapshot@${t.sequence}`;
    }
    if (t.kind === "synchronized") {
      return `sync@${t.sequence}`;
    }
    const { event } = t;
    if (event.type === "thread") {
      return `thread@${t.sequence}`;
    }
    const name = event.type === "itemText" ? `${event.itemId}+` : event.item.id;
    return `${name}@${t.sequence}`;
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

  it.effect(
    "settles the cards left open by the server before: a permission expires, a question waited on stays answerable by the next prompt",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(path.join(home, "threads"));
        const question = {
          answers: null,
          at: 1,
          id: "item_asked",
          kind: "question" as const,
          questions: [{ id: "plan", options: [], question: "Which plan?" }],
        };
        yield* fs.writeFileString(
          path.join(home, "threads", `${THREAD.id}.json`),
          JSON.stringify({
            items: [
              {
                at: 1,
                decision: null,
                id: "perm_open",
                kind: "permission",
                options: [],
                requestId: "perm_open",
                title: "Edit home",
              },
              {
                at: 1,
                decision: "allow",
                id: "perm_done",
                kind: "permission",
                options: [],
                requestId: "perm_done",
                title: "Edit home",
              },
              {
                ...question,
                elicitation: { message: "The agent asks" },
                id: "item_waited",
              },
              question,
              { ...question, id: "item_old", outcome: "cancelled" },
            ],
            thread: THREAD,
          })
        );
        const items = yield* Effect.gen(function* () {
          const store = yield* ThreadStore;
          return yield* store.items(THREAD.id);
        }).pipe(Effect.provide(storeIn(home)));
        const byId = new Map(items.map((i) => [i.id, i]));
        const open = byId.get("perm_open");
        assert.strictEqual(
          open?.kind === "permission" && open.decision,
          "expired"
        );
        assert.strictEqual(
          open?.kind === "permission" && open.settled?.how,
          "expired"
        );
        assert.strictEqual(
          byId.get("perm_done")?.kind === "permission" &&
            (byId.get("perm_done") as { decision: string }).decision,
          "allow"
        );
        const waited = byId.get("item_waited");
        assert.isTrue(
          waited?.kind === "question" &&
            waited.restartedAt !== undefined &&
            waited.answers === null &&
            waited.outcome === undefined
        );
        // The cards no agent waited on, and those settled already, read as they did.
        assert.deepStrictEqual(byId.get("item_asked"), question);
        assert.deepStrictEqual(byId.get("item_old"), {
          ...question,
          id: "item_old",
          outcome: "cancelled",
        });
        // Written back, so a second restart finds them settled.
        const stored = yield* storedIn(home);
        assert.strictEqual(
          (stored.items[0] as { decision?: string }).decision,
          "expired"
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
  describe("a thread followed (ADR 0130)", () => {
    it.effect(
      "from a sequence it held, tells exactly the changes after it, then the later ones as they happen",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* fs.makeTempDirectoryScoped();
          yield* Effect.gen(function* () {
            const store = yield* ThreadStore;
            // The thread is change 1, each item one more.
            yield* store.add(THREAD);
            yield* pushed(store, "item_1");
            yield* pushed(store, "item_2");
            yield* store.appendText(THREAD.id, "item_2", " more");
            yield* store.update(THREAD.id, { title: "B" });
            const resumed = yield* toldUpToNow(
              store.follow(THREAD.id, 2, yield* runOf(store))
            );
            assert.deepStrictEqual(shape(resumed), [
              "item_2@3",
              "item_2+@4",
              "thread@5",
              "sync@5",
            ]);
            const later = yield* followedLive(
              store.follow(THREAD.id, 5, yield* runOf(store)),
              Stream.take(2)
            );
            yield* pushed(store, "item_3");
            assert.deepStrictEqual(shape(yield* Fiber.join(later)), [
              "sync@5",
              "item_3@6",
            ]);
          }).pipe(Effect.provide(storeIn(home)));
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
    );

    it.effect(
      "from nothing, or past the changes it keeps, sends a snapshot of the thread as it is",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* fs.makeTempDirectoryScoped();
          yield* Effect.gen(function* () {
            const store = yield* ThreadStore;
            yield* store.add(THREAD);
            for (let i = 1; i <= 130; i += 1) {
              yield* pushed(store, `item_${i}`);
            }
            const [snapshot, sync] = yield* toldUpToNow(
              store.follow(THREAD.id)
            );
            assert.deepStrictEqual(
              shape([snapshot, sync].filter((t) => t !== undefined)),
              ["snapshot@131", "sync@131"]
            );
            assert.strictEqual(
              snapshot?.kind === "snapshot" ? snapshot.items.length : 0,
              130
            );
            // 129 changes after 2 is past the 128 kept.
            const far = yield* toldUpToNow(
              store.follow(THREAD.id, 2, yield* runOf(store))
            );
            assert.deepStrictEqual(shape(far), ["snapshot@131", "sync@131"]);
            const near = yield* toldUpToNow(
              store.follow(THREAD.id, 129, yield* runOf(store))
            );
            assert.deepStrictEqual(shape(near), [
              "item_129@130",
              "item_130@131",
              "sync@131",
            ]);
          }).pipe(Effect.provide(storeIn(home)));
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
    );

    it.effect(
      "keeps 1 MB of a thread's last changes at most, the oldest going first",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* fs.makeTempDirectoryScoped();
          yield* Effect.gen(function* () {
            const store = yield* ThreadStore;
            yield* store.add(THREAD);
            // Three changes of 400 kB each: the first is past the megabyte by the third.
            const big = "x".repeat(400_000);
            for (const id of ["item_1", "item_2", "item_3"]) {
              yield* store.push(THREAD.id, {
                at: 0,
                id,
                kind: "agent",
                text: big,
              });
            }
            const far = yield* toldUpToNow(
              store.follow(THREAD.id, 1, yield* runOf(store))
            );
            assert.deepStrictEqual(shape(far), ["snapshot@4", "sync@4"]);
            const near = yield* toldUpToNow(
              store.follow(THREAD.id, 2, yield* runOf(store))
            );
            assert.deepStrictEqual(shape(near), [
              "item_2@3",
              "item_3@4",
              "sync@4",
            ]);
          }).pipe(Effect.provide(storeIn(home)));
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
    );

    it.effect(
      "keeps its sequence in its file, so a restart carries on from it and an editor up to date replays nothing",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* fs.makeTempDirectoryScoped();
          yield* Effect.gen(function* () {
            const store = yield* ThreadStore;
            yield* store.add(THREAD);
            yield* pushed(store, "item_1");
          }).pipe(Effect.provide(storeIn(home)));
          yield* Effect.gen(function* () {
            const store = yield* ThreadStore;
            assert.deepStrictEqual(
              shape(
                yield* toldUpToNow(
                  store.follow(THREAD.id, 2, yield* runOf(store))
                )
              ),
              ["sync@2"]
            );
            // Ahead of what the server has: a snapshot.
            assert.deepStrictEqual(
              shape(
                yield* toldUpToNow(
                  store.follow(THREAD.id, 7, yield* runOf(store))
                )
              ),
              ["snapshot@2", "sync@2"]
            );
            yield* pushed(store, "item_2");
            assert.deepStrictEqual(
              shape(
                yield* toldUpToNow(
                  store.follow(THREAD.id, 2, yield* runOf(store))
                )
              ),
              ["item_2@3", "sync@3"]
            );
          }).pipe(Effect.provide(storeIn(home)));
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
    );

    it.effect(
      "trusts only the numbers of its own run: an editor from another gets a snapshot",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* fs.makeTempDirectoryScoped();
          const earlier = yield* Effect.gen(function* () {
            const store = yield* ThreadStore;
            yield* store.add(THREAD);
            yield* pushed(store, "item_1");
            const told = yield* toldUpToNow(store.follow(THREAD.id));
            const last = told.at(-1);
            return last?.kind === "synchronized" ? last.run : "";
          }).pipe(Effect.provide(storeIn(home)));
          yield* Effect.gen(function* () {
            const store = yield* ThreadStore;
            const told = yield* toldUpToNow(
              store.follow(THREAD.id, 2, earlier)
            );
            assert.deepStrictEqual(shape(told), ["snapshot@2", "sync@2"]);
            const last = told.at(-1);
            const now = last?.kind === "synchronized" ? last.run : "";
            assert.notStrictEqual(now, earlier);
            yield* pushed(store, "item_2");
            assert.deepStrictEqual(
              shape(yield* toldUpToNow(store.follow(THREAD.id, 2, now))),
              ["item_2@3", "sync@3"]
            );
          }).pipe(Effect.provide(storeIn(home)));
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
    );

    it.effect(
      "takes a resume that names no run for another run's: a snapshot",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = yield* fs.makeTempDirectoryScoped();
          yield* Effect.gen(function* () {
            const store = yield* ThreadStore;
            yield* store.add(THREAD);
            yield* pushed(store, "item_1");
            assert.deepStrictEqual(
              shape(yield* toldUpToNow(store.follow(THREAD.id, 1))),
              ["snapshot@2", "sync@2"]
            );
          }).pipe(Effect.provide(storeIn(home)));
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
    );

    it.effect(
      "follows a thread written before threads were numbered from a snapshot at 0",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const home = yield* fs.makeTempDirectoryScoped();
          yield* fs.makeDirectory(path.join(home, "threads"));
          yield* fs.writeFileString(
            path.join(home, "threads", `${THREAD.id}.json`),
            JSON.stringify({
              items: [{ at: 0, id: "item_1", kind: "agent", text: "old" }],
              thread: THREAD,
            })
          );
          const told = yield* Effect.gen(function* () {
            const store = yield* ThreadStore;
            return yield* toldUpToNow(store.follow(THREAD.id));
          }).pipe(Effect.provide(storeIn(home)));
          assert.deepStrictEqual(shape(told), ["snapshot@0", "sync@0"]);
          assert.deepStrictEqual(
            told[0]?.kind === "snapshot" ? told[0].items.map((i) => i.id) : [],
            ["item_1"]
          );
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
    );

    it.effect("ends when the thread is removed", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        yield* Effect.gen(function* () {
          const store = yield* ThreadStore;
          yield* store.add(THREAD);
          const followed = yield* followedLive(
            store.follow(THREAD.id, 1, yield* runOf(store))
          );
          yield* store.remove(THREAD.id);
          assert.deepStrictEqual(shape(yield* Fiber.join(followed)), [
            "sync@1",
          ]);
        }).pipe(Effect.provide(storeIn(home)));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
    );
  });
});
