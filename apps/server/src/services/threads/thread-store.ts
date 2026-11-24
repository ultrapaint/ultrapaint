import { NotFound } from "@ultrapaint/contracts/errors";
import {
  answeredInTurn,
  isBusy,
  isStopping,
  summarise,
  Thread,
  type ThreadEvent,
  ThreadItem,
  type ThreadStatus,
  type ThreadStreamItem,
} from "@ultrapaint/contracts/threads";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Result,
  Schema,
  Stream,
} from "effect";
import { AppLog } from "../../app-log.ts";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { EventBus } from "../../events.ts";
import { makeId, safeFileId } from "../../ids.ts";
import { makeKeyedLock } from "../../keyed-lock.ts";
import { Storage } from "../storage.ts";

const Stored = Schema.Struct({
  items: Schema.Array(ThreadItem),
  /** The number of the thread's last change (ADR 0130); a file written before has none, 0. */
  sequence: Schema.optionalKey(Schema.Int),
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

/**
 * A change that brings a settled thread back to the list (ADR 0141): a prompt starting a turn,
 * or the turn failing. Whatever else changes it (its title, its status as the turn ends) leaves
 * it where the designer put it.
 */
const comesBack = (patch: Partial<Thread>) =>
  patch.status === "running" || patch.status === "error";

/** An item that asks the designer something: a question or a permission, not yet answered. */
const asks = (item: ThreadItem) =>
  (item.kind === "question" && item.answers === null) ||
  (item.kind === "permission" && item.decision === null);

/**
 * A thread's queue as it is read at start (ADR 0137): no prompt of it is being edited, nor waits
 * to go into a turn, since no session or editor survives a restart. Held by an edit no window
 * has open, it would wait for good.
 */
const queueAtRest = (thread: Thread): Thread =>
  thread.queued?.some((q) => q.editing || q.steering)
    ? {
        ...thread,
        queued: thread.queued.map((q) => ({
          ...q,
          editing: undefined,
          steering: undefined,
        })),
      }
    : thread;

/**
 * A thread's cards as they are read at start (ADR 0125): no agent waits on any of them, since no
 * session survives a restart. A permission still asked expires, never granted to an agent no
 * longer asking; a question its agent waited on stays answerable, its answers sent as the next
 * prompt, as for an agent that cannot wait. Null when there was none to settle.
 */
const settledAtStart = (
  items: readonly ThreadItem[],
  now: number
): ThreadItem[] | null => {
  let changed = false;
  const settled = items.map((item): ThreadItem => {
    if (item.kind === "permission" && item.decision === null) {
      changed = true;
      return {
        ...item,
        decision: "expired",
        settled: { at: now, how: "expired" },
      };
    }
    if (
      item.kind === "question" &&
      answeredInTurn(item) &&
      item.answers === null &&
      item.outcome === undefined
    ) {
      changed = true;
      return { ...item, restartedAt: now };
    }
    return item;
  });
  return changed ? settled : null;
};

/** Where the threads are kept in the state directory: a file each, named by the thread's id. */
export const THREADS_DIR = "threads";
export const threadFileName = (id: string) => `${id}.json`;

/** How long a changed thread may wait before it is written. */
const FLUSH_DELAY = "250 millis";

/**
 * How many of a thread's last changes are kept to be told again, and how much of them at most
 * (the reference product's bounds, ADR 0130): the oldest go first past either, and an editor
 * further behind gets a snapshot.
 */
export const REPLAY_MAX_EVENTS = 128;
export const REPLAY_MAX_BYTES = 1_048_576;

/** A thread's change and its number, or the thread gone, as the store tells its followers. */
type Told =
  | {
      readonly event: ThreadEvent;
      readonly sequence: number;
      readonly threadId: string;
    }
  | { readonly event?: undefined; readonly threadId: string };

interface Entry {
  items: ThreadItem[];
  /**
   * Its last changes since the server started, oldest first: `REPLAY_MAX_EVENTS` at most, and
   * `REPLAY_MAX_BYTES` of JSON at most (`recentBytes`).
   */
  recent: {
    readonly bytes: number;
    readonly event: ThreadEvent;
    readonly sequence: number;
  }[];
  recentBytes: number;
  /** The number of its last change. */
  sequence: number;
  thread: Thread;
}

/**
 * What an editor that applied a thread's changes up to `after` is told to be up to date: the
 * changes after it while the store holds them all and they are not too many, else (or with no
 * `after`, or one past the thread's last) a snapshot.
 */
const resume = (
  entry: Entry,
  after: number | undefined,
  run: string
): ThreadStreamItem[] => {
  const snapshot: ThreadStreamItem[] = [
    {
      items: [...entry.items],
      kind: "snapshot",
      run,
      sequence: entry.sequence,
      thread: entry.thread,
    },
  ];
  if (after === undefined || after > entry.sequence) {
    return snapshot;
  }
  const missed = entry.recent.filter((r) => r.sequence > after);
  if (missed.length < entry.sequence - after) {
    return snapshot;
  }
  return missed.map(({ event, sequence }) => ({
    event,
    kind: "event",
    sequence,
  }));
};

/** The turns ended since the server started, by how each ended (ADR 0107). */
export interface TurnsEnded {
  /** Stopped by the person (a cancel), which is no one's news. */
  readonly cancelled: number;
  /** Stopped on an error. */
  readonly failed: number;
  readonly finished: number;
}

/**
 * How a turn ended when a thread's status goes from `before` to `after`: none while it is still
 * under way, or was not. A turn stopped while it was being cancelled, or force stopped, was
 * cancelled.
 */
export const turnEnd = (
  before: ThreadStatus,
  after: ThreadStatus
): keyof TurnsEnded | null => {
  if (!isBusy(before) || isBusy(after)) {
    return null;
  }
  if (after === "error") {
    return "failed";
  }
  return isStopping(before) ? "cancelled" : "finished";
};

/**
 * Threads and their transcripts: in memory, persisted as one JSON file per thread, and every
 * change numbered by the thread's sequence, told to the thread's followers (`follow`) and
 * published as an `agent` event. Knows nothing about agents or sessions.
 */
export class ThreadStore extends Context.Service<
  ThreadStore,
  {
    readonly add: (thread: Thread) => Effect.Effect<void>;
    /**
     * The thread as it changes (ADR 0130): what an editor that applied its changes up to
     * `afterSequence` is missing (`resume`), then `synchronized`, then each change as it is made.
     * Numbers of another `run` of the server's than this one, or of no run named, are not
     * trusted: a snapshot. Ends
     * when the thread is removed; fails for a thread there is not.
     */
    readonly follow: (
      id: string,
      afterSequence?: number,
      run?: string
    ) => Stream.Stream<ThreadStreamItem, NotFound>;
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
    /**
     * How many turns ended since the server started, by how they ended: for the desktop app,
     * which tells the person of a turn that finished or failed in a project not on screen.
     */
    readonly turnsEnded: Effect.Effect<TurnsEnded>;
    /**
     * Changes a thread and stamps it `updatedAt` now, unless `news` is false: a change of the
     * designer's to the chat's place in the list (settling it, renaming it) is no news of it, and
     * leaves its place and its unread state as they were (ADR 0141).
     */
    readonly update: (
      id: string,
      patch: Partial<Thread>,
      options?: { readonly news?: boolean }
    ) => Effect.Effect<void>;
  }
>()("ultrapaint/server/ThreadStore") {
  static readonly layer = Layer.effect(
    ThreadStore,
    Effect.gen(function* () {
      const storage = yield* Storage;
      const events = yield* EventBus;
      // This run of the server's: the numbers of changes a server killed outright lost (its
      // files lag by up to FLUSH_DELAY) may be given again, so another run's are not trusted.
      const run = yield* makeId("run");
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
      let turnsEnded: TurnsEnded = { cancelled: 0, failed: 0, finished: 0 };
      // Streaming chunks persist the same file many times a second; keep the writes in order.
      const writes = makeKeyedLock();

      yield* Effect.orDie(fs.makeDirectory(dir, { recursive: true }));
      const names = yield* Effect.orDie(fs.readDirectory(dir));
      const startedAt = yield* Clock.currentTimeMillis;
      // Threads whose cards were settled at start, written back once the store is up.
      const settledOnRead: string[] = [];
      for (const name of names.filter((n) => n.endsWith(".json"))) {
        yield* fs.readFileString(path.join(dir, name)).pipe(
          Effect.flatMap(parseJson),
          Effect.map(atRest),
          Effect.flatMap(decodeStored),
          // Its id names the file it is written back to.
          Effect.tap((stored) => safeFileId("thread", stored.thread.id)),
          Effect.tap((stored) =>
            Effect.sync(() => {
              const settled = settledAtStart(stored.items, startedAt);
              if (settled !== null) {
                settledOnRead.push(stored.thread.id);
              }
              threads.set(stored.thread.id, {
                items: settled ?? [...stored.items],
                recent: [],
                recentBytes: 0,
                sequence: stored.sequence ?? 0,
                thread: queueAtRest(stored.thread),
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
            const { items, sequence, thread } = entry;
            return encodeStored({ items, sequence, thread }).pipe(
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
      yield* Effect.forEach(settledOnRead, persistSoon, { discard: true });

      const feed = yield* Effect.acquireRelease(
        PubSub.unbounded<Told>(),
        PubSub.shutdown
      );
      /** Numbers a change and gives it to the thread's followers: synchronous, never split. */
      const number = (id: string, entry: Entry, event: ThreadEvent) => {
        entry.sequence += 1;
        const { sequence } = entry;
        const bytes = Buffer.byteLength(JSON.stringify(event));
        entry.recent.push({ bytes, event, sequence });
        entry.recentBytes += bytes;
        while (
          entry.recent.length > REPLAY_MAX_EVENTS ||
          entry.recentBytes > REPLAY_MAX_BYTES
        ) {
          entry.recentBytes -= entry.recent.shift()?.bytes ?? 0;
        }
        PubSub.publishUnsafe(feed, { event, sequence, threadId: id });
      };

      /**
       * A change to thread `id`: `make` reads the thread, changes it and says the change, and the
       * change is numbered, in one synchronous step, so no other change falls between the two and
       * changes are numbered in the order they were made (an editor drops one numbered below what
       * it applied). Then the thread is marked to be written and the change told on the bus, the
       * whole of it uninterruptible. Nothing when there is no such thread, or `make` says null.
       */
      const change = (
        id: string,
        make: (entry: Entry) => ThreadEvent | null
      ): Effect.Effect<void> =>
        Effect.flatMap(
          Effect.sync(() => {
            const entry = threads.get(id);
            const event = entry ? make(entry) : null;
            if (entry && event) {
              number(id, entry, event);
            }
            return event;
          }),
          (event) =>
            event === null
              ? Effect.void
              : Effect.andThen(persistSoon(id), events.publish("agent", event))
          // Whole, once begun: a change made is always marked to be written, whoever stops
          // waiting for it (a cancel's socket closing, say).
        ).pipe(Effect.uninterruptible);

      const update = Effect.fnUntraced(function* (
        id: string,
        patch: Partial<Thread>,
        options?: { readonly news?: boolean }
      ) {
        const now = yield* Clock.currentTimeMillis;
        yield* change(id, (entry) => {
          const ended =
            patch.status === undefined
              ? null
              : turnEnd(entry.thread.status, patch.status);
          if (ended) {
            turnsEnded = { ...turnsEnded, [ended]: turnsEnded[ended] + 1 };
          }
          entry.thread = {
            ...entry.thread,
            ...patch,
            ...(comesBack(patch) && { settledAt: undefined }),
            // Later than its last change whatever the clock says, even within one millisecond:
            // the order an editor keeps the later of two copies by (ADR 0141).
            changedAt: Math.max(
              now,
              (entry.thread.changedAt ?? entry.thread.updatedAt) + 1
            ),
            updatedAt: options?.news === false ? entry.thread.updatedAt : now,
          };
          return { thread: entry.thread, type: "thread" };
        });
      });

      const push = (id: string, item: ThreadItem) =>
        Effect.andThen(
          change(id, (entry) => {
            entry.items.push(item);
            return { item, threadId: id, type: "item" };
          }),
          // A card the agent opens needs the designer: a settled chat comes back for it.
          Effect.suspend(() =>
            asks(item) && threads.get(id)?.thread.settledAt !== undefined
              ? update(id, { settledAt: undefined })
              : Effect.void
          )
        );

      const patchItem = (
        id: string,
        itemId: string,
        patch: (item: ThreadItem) => ThreadItem
      ) =>
        change(id, (entry) => {
          const index = entry.items.findIndex((i) => i.id === itemId);
          const existing = entry.items[index];
          if (!existing) {
            return null;
          }
          const item = patch(existing);
          entry.items[index] = item;
          return { item, threadId: id, type: "itemUpdate" };
        });

      const appendText = (id: string, itemId: string, text: string) =>
        change(id, (entry) => {
          const index = entry.items.findIndex((i) => i.id === itemId);
          const existing = entry.items[index];
          if (
            !existing ||
            (existing.kind !== "agent" && existing.kind !== "thought")
          ) {
            return null;
          }
          entry.items[index] = { ...existing, text: existing.text + text };
          return {
            itemId,
            // Where the text ended as this chunk was added, whatever was added since.
            offset: existing.text.length,
            text,
            threadId: id,
            type: "itemText",
          };
        });

      return ThreadStore.of({
        add: Effect.fnUntraced(function* (thread: Thread) {
          const entry: Entry = {
            items: [],
            recent: [],
            recentBytes: 0,
            sequence: 0,
            thread,
          };
          const event: ThreadEvent = { thread, type: "thread" };
          // Kept and numbered in one step, before it is written, so its file says the change
          // that made it.
          yield* Effect.sync(() => {
            threads.set(thread.id, entry);
            number(thread.id, entry, event);
          });
          yield* events.publish("agent", event);
          yield* persist(thread.id);
        }),
        appendText,
        follow: (id, afterSequence, from) =>
          Stream.unwrap(
            Effect.gen(function* () {
              // Subscribed before the thread is read: a change made in between is in what is
              // read, and told again only past its number.
              const subscription = yield* PubSub.subscribe(feed);
              const entry = threads.get(id);
              if (!entry) {
                return yield* new NotFound({ message: `unknown thread ${id}` });
              }
              const { sequence } = entry;
              const upToNow: ThreadStreamItem[] = [
                ...resume(entry, from === run ? afterSequence : undefined, run),
                { kind: "synchronized", run, sequence },
              ];
              const later = Stream.fromSubscription(subscription).pipe(
                Stream.filter((told) => told.threadId === id),
                Stream.takeWhile((told) => told.event !== undefined),
                Stream.filterMap((told) =>
                  told.event !== undefined && told.sequence > sequence
                    ? Result.succeed<ThreadStreamItem>({
                        event: told.event,
                        kind: "event",
                        sequence: told.sequence,
                      })
                    : Result.failVoid
                )
              );
              return Stream.concat(Stream.fromIterable(upToNow), later);
            })
          ),
        get: (id) => Effect.sync(() => threads.get(id)?.thread),
        hasItem: (id, itemId) =>
          threads.get(id)?.items.some((i) => i.id === itemId) ?? false,
        // A copy: the answer is the transcript as it is now, whatever is said before it is sent.
        items: (id) => Effect.sync(() => [...(threads.get(id)?.items ?? [])]),
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
          PubSub.publishUnsafe(feed, { threadId: id });
          yield* events.publish("agent", { threadId: id, type: "removed" });
        }),
        turnsEnded: Effect.sync(() => turnsEnded),
        update,
      });
    })
  );
}
