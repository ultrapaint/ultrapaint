import { summarise, Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";
import { AppLog } from "../../app-log.ts";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { EventBus } from "../../events.ts";
import { safeFileId } from "../../ids.ts";
import { makeKeyedLock } from "../../keyed-lock.ts";
import { Storage } from "../storage.ts";

const Stored = Schema.Struct({
  items: Schema.Array(ThreadItem),
  thread: Thread,
});
const StoredJson = Schema.fromJsonString(Stored);
const parseJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown)
);
const decodeStored = Schema.decodeUnknownEffect(Stored);
const encodeStored = Schema.encodeEffect(StoredJson);

/**
 * A thread as it is read at start: idle, whatever its file says, since no session survives a
 * restart. Set before the file is decoded, so a status no longer written (`starting`, `closed`)
 * reads too.
 */
const atRest = (stored: unknown): unknown => {
  const thread =
    typeof stored === "object" && stored !== null
      ? (stored as { thread?: unknown }).thread
      : undefined;
  return typeof thread === "object" && thread !== null
    ? { ...(stored as object), thread: { ...thread, status: "idle" } }
    : stored;
};

/** Where the threads are kept in the state directory: a file each, named by the thread's id. */
export const THREADS_DIR = "threads";
export const threadFileName = (id: string) => `${id}.json`;

/** How long a changed thread may wait before it is written. */
const FLUSH_DELAY = "250 millis";

interface Entry {
  items: ThreadItem[];
  thread: Thread;
}

/**
 * Threads and their transcripts: in memory, persisted as one JSON file per thread, and every
 * change published as an `agent` event. Knows nothing about agents or sessions.
 */
export class ThreadStore extends Context.Service<
  ThreadStore,
  {
    readonly add: (thread: Thread) => Effect.Effect<void>;
    readonly get: (id: string) => Effect.Effect<Thread | undefined>;
    readonly hasItem: (id: string, itemId: string) => boolean;
    readonly items: (id: string) => Effect.Effect<readonly ThreadItem[]>;
    readonly list: Effect.Effect<Thread[]>;
    readonly patchItem: (
      id: string,
      itemId: string,
      patch: (item: ThreadItem) => ThreadItem
    ) => Effect.Effect<void>;
    readonly push: (id: string, item: ThreadItem) => Effect.Effect<void>;
    /**
     * A streamed chunk at the end of an agent's message or thought: published as the chunk
     * alone (`itemText`), where a patch publishes the whole item, with the offset it was added
     * at. `items` is answered from memory beside the events, so the transcript an editor reads
     * may hold a chunk it is yet to be told: the offset is what lets it tell.
     */
    readonly appendText: (
      id: string,
      itemId: string,
      text: string
    ) => Effect.Effect<void>;
    readonly remove: (id: string) => Effect.Effect<void>;
    readonly update: (
      id: string,
      patch: Partial<Thread>
    ) => Effect.Effect<void>;
  }
>()("ultrapaint/server/ThreadStore") {
  static readonly layer = Layer.effect(
    ThreadStore,
    Effect.gen(function* () {
      const storage = yield* Storage;
      const events = yield* EventBus;
      const log = yield* AppLog;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      // Asked for on every write: saving an unsaved session moves the state directory.
      const fileOf = (id: string) =>
        Effect.flatMap(safeFileId("thread", id), (safe) =>
          Effect.map(storage.stateDir, (state) =>
            path.join(state, THREADS_DIR, threadFileName(safe))
          )
        );
      const dir = path.join(yield* storage.stateDir, THREADS_DIR);
      const threads = new Map<string, Entry>();
      // Streaming chunks persist the same file many times a second; keep the writes in order.
      const writes = makeKeyedLock();

      yield* Effect.orDie(fs.makeDirectory(dir, { recursive: true }));
      const names = yield* Effect.orDie(fs.readDirectory(dir));
      for (const name of names.filter((n) => n.endsWith(".json"))) {
        yield* fs.readFileString(path.join(dir, name)).pipe(
          Effect.flatMap(parseJson),
          Effect.map(atRest),
          Effect.flatMap(decodeStored),
          // Its id names the file it is written back to.
          Effect.tap((stored) => safeFileId("thread", stored.thread.id)),
          Effect.tap((stored) =>
            Effect.sync(() => {
              threads.set(stored.thread.id, {
                items: [...stored.items],
                thread: stored.thread,
              });
            })
          ),
          Effect.catch((error) =>
            log.log(
              "agent",
              "warn",
              `ignoring thread file ${name}: ${error.message}`
            )
          )
        );
      }

      const write = (id: string) =>
        writes.withLock(
          id,
          Effect.suspend(() => {
            const entry = threads.get(id);
            if (!entry) {
              return Effect.void;
            }
            return encodeStored(entry).pipe(
              Effect.flatMap((json) =>
                Effect.flatMap(fileOf(id), (file) => writeAtomic(file, json))
              ),
              // The transcript in memory stays correct; the next change retries the write.
              Effect.ignore({ log: true })
            );
          })
        );

      /*
       * Each write encodes the whole thread: written on every change, a long chat costs the
       * square of its length, a streamed reply once per chunk and a turn once per item. A change
       * only marks the thread dirty and its file is written at most every FLUSH_DELAY, so a
       * server killed outright loses a quarter of a second at most. A new thread is written at
       * once, and closing the store writes whatever is still dirty.
       */
      const dirty = new Set<string>();
      const scheduled = new Set<string>();
      const scope = yield* Effect.scope;
      // Uninterruptible once begun: the mark is cleared before the write, so a write cut short
      // by shutdown would lose what it carried.
      const flush = (id: string) =>
        Effect.uninterruptible(
          Effect.suspend(() => (dirty.delete(id) ? write(id) : Effect.void))
        );
      const persistSoon = (id: string) =>
        Effect.suspend(() => {
          dirty.add(id);
          if (scheduled.has(id)) {
            return Effect.void;
          }
          scheduled.add(id);
          return Effect.asVoid(
            Effect.forkIn(
              Effect.sleep(FLUSH_DELAY).pipe(
                Effect.andThen(Effect.sync(() => scheduled.delete(id))),
                Effect.andThen(flush(id))
              ),
              scope
            )
          );
        });
      const persist = (id: string) =>
        Effect.suspend(() => {
          dirty.delete(id);
          return write(id);
        });
      yield* Effect.addFinalizer(() =>
        Effect.forEach([...dirty], flush, { discard: true })
      );

      const update = Effect.fnUntraced(function* (
        id: string,
        patch: Partial<Thread>
      ) {
        const entry = threads.get(id);
        if (!entry) {
          return;
        }
        entry.thread = {
          ...entry.thread,
          ...patch,
          updatedAt: yield* Clock.currentTimeMillis,
        };
        yield* persistSoon(id);
        yield* events.publish("agent", {
          thread: entry.thread,
          type: "thread",
        });
      });

      const push = Effect.fnUntraced(function* (id: string, item: ThreadItem) {
        const entry = threads.get(id);
        if (!entry) {
          return;
        }
        entry.items.push(item);
        yield* persistSoon(id);
        yield* events.publish("agent", { item, threadId: id, type: "item" });
      });

      const patchItem = Effect.fnUntraced(function* (
        id: string,
        itemId: string,
        patch: (item: ThreadItem) => ThreadItem
      ) {
        const entry = threads.get(id);
        const index = entry?.items.findIndex((i) => i.id === itemId) ?? -1;
        const existing = entry?.items[index];
        if (!(entry && existing)) {
          return;
        }
        const item = patch(existing);
        entry.items[index] = item;
        yield* persistSoon(id);
        yield* events.publish("agent", {
          item,
          threadId: id,
          type: "itemUpdate",
        });
      });

      const appendText = Effect.fnUntraced(function* (
        id: string,
        itemId: string,
        text: string
      ) {
        const entry = threads.get(id);
        const index = entry?.items.findIndex((i) => i.id === itemId) ?? -1;
        const existing = entry?.items[index];
        if (
          !(entry && existing) ||
          (existing.kind !== "agent" && existing.kind !== "thought")
        ) {
          return;
        }
        entry.items[index] = { ...existing, text: existing.text + text };
        yield* persistSoon(id);
        yield* events.publish("agent", {
          itemId,
          // Where the text ended as this chunk was added, whatever was added since.
          offset: existing.text.length,
          text,
          threadId: id,
          type: "itemText",
        });
      });

      return ThreadStore.of({
        add: Effect.fnUntraced(function* (thread: Thread) {
          threads.set(thread.id, { items: [], thread });
          yield* persist(thread.id);
          yield* events.publish("agent", { thread, type: "thread" });
        }),
        appendText,
        get: (id) => Effect.sync(() => threads.get(id)?.thread),
        hasItem: (id, itemId) =>
          threads.get(id)?.items.some((i) => i.id === itemId) ?? false,
        items: (id) => Effect.sync(() => threads.get(id)?.items ?? []),
        list: Effect.sync(() =>
          Array.from(threads.values(), (e) => ({
            ...e.thread,
            summary: summarise(e.items),
          })).sort((a, b) => b.updatedAt - a.updatedAt)
        ),
        patchItem,
        push,
        remove: Effect.fnUntraced(function* (id: string) {
          // Only a thread there is has a file to remove.
          if (!threads.delete(id)) {
            return;
          }
          dirty.delete(id);
          // Behind any write still in flight, or its rename would bring the file back.
          yield* writes.withLock(
            id,
            Effect.ignore(
              Effect.flatMap(fileOf(id), (file) =>
                fs.remove(file, { force: true })
              )
            )
          );
          yield* events.publish("agent", { threadId: id, type: "removed" });
        }),
        update,
      });
    })
  );
}
