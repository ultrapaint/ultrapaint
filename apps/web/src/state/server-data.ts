/**
 * The server's data the editor follows: the project, its pages, the documents of the canvas open,
 * the design system, the threads and the rest. Each store declares what it follows with `follow`
 * (how a piece of it is read, what the store does with it, the events that bring news of it) and
 * holds no wiring of its own.
 *
 * Following means four things, written here once:
 *
 * - The server's events reach every piece that declared them, from `followServer` on.
 * - A piece is read when its store asks, and from then on again at every connection open: news
 *   sent while the editor was away is lost, and reading again is how the editor catches up. The
 *   pieces read `atOpen` are read first, one after the other, at the first open too.
 * - A piece of something chosen (the documents of the canvas open) reads what its `key` names
 *   now, and an answer for what is no longer chosen is dropped.
 * - Answers are taken in the order their reads began: one older than an answer taken, or than
 *   an event that brings the whole piece (`whole`: the checkpoints, git's status), is dropped.
 *   An event that brings news of a part of it (`news`: a document's change) told while a read
 *   is on its way waits for its answer, which may be older, and is taken after it.
 * - A snapshot on screen (ADR 0019) keeps the canvases with their pages, the documents and the
 *   layouts: each piece of those reads from the snapshot instead of the server, the live and the
 *   snapshot's being its two sources, and its news is held back until the editor goes back to
 *   now, when it is read again. What a snapshot does not keep (comments, the design system, the
 *   threads) stays live while one is open.
 */
import {
  type EventName,
  type EventPayload,
  eventNames,
} from "@ultrapaint/contracts/rpc";
import type { SnapshotView } from "@ultrapaint/contracts/snapshots";
import { api, useConnection } from "./connection.ts";
import { useSnapshotView } from "./snapshot-view.ts";

/** What each event the server sends does to a store. */
type Handlers = {
  readonly [E in EventName]?: (payload: EventPayload<E>) => void;
};

export interface Piece<T, K = undefined> {
  /** Takes what was read into the store; a read that keeps what it read itself has none. */
  readonly apply?: (value: T, key: K) => void;
  /**
   * Read at every connection open, the first one included, while this holds: what the editor
   * needs before anything else (the project). Any other piece is read at an open once asked for.
   */
  readonly atOpen?: () => boolean;
  /** Which of it is followed now (the canvas open); null when nothing is. */
  readonly key?: () => K | null;
  /**
   * The events of `on` that bring news of a part of it (a document of the canvas open): one told
   * while a read is on its way waits for its answer, which the server may have read before it,
   * and is taken after it, so the answer does not take the news back.
   */
  readonly news?: readonly EventName[];
  /** The server's news of it. */
  readonly on?: Handlers;
  /** Reads it from the server. */
  readonly read: (key: K) => Promise<T>;
  /** What a snapshot keeps in its place, for what a snapshot keeps. */
  readonly snapshot?: (view: SnapshotView, key: K) => T;
  /**
   * The events of `on` that bring the whole of it, as a read does (a state, not news of a
   * change): an answer to a read begun before one of them is older, and is dropped.
   */
  readonly whole?: readonly EventName[];
}

export interface Followed<T, K> {
  /** What the source in force holds for `key`, as `read` would take it, left to the caller. */
  readonly get: (key: K) => Promise<T>;
  /** Reads it again, from the source in force, and takes it into the store. */
  readonly read: () => Promise<void>;
  /** Stops following it: what a component that follows something while it is shown calls. */
  readonly stop: () => void;
}

interface Entry {
  /** Asked for once: read again at every open. */
  asked: boolean;
  /** The reads begun and the whole states pushed, counted: how new each is. */
  begun: number;
  /** The news (`news`) told while a read is on its way, in order. */
  readonly held: { readonly event: EventName; readonly payload: unknown }[];
  readonly piece: Piece<unknown, unknown>;
  /** The reads on their way. */
  reading: number;
  /** How new what the store took last is: an answer older than that is dropped. */
  taken: number;
}

/** Every piece followed, in the order declared: the order the pieces read `atOpen` are read in. */
const entries = new Set<Entry>();

const viewed = () => useSnapshotView.getState().view;

/** What `piece` holds for `key`, from the snapshot on screen when it keeps it, else the server. */
const fromSource = <T, K>(piece: Piece<T, K>, key: K): Promise<T> => {
  const view = viewed();
  return view && piece.snapshot
    ? Promise.resolve(piece.snapshot(view, key))
    : piece.read(key);
};

const readEntry = async (entry: Entry) => {
  const { piece } = entry;
  const key = piece.key ? piece.key() : undefined;
  if (key === null) {
    return;
  }
  entry.begun += 1;
  const at = entry.begun;
  entry.reading += 1;
  try {
    const value = await fromSource(piece, key);
    // Something else was chosen while it was on its way.
    if (piece.key && !Object.is(piece.key(), key)) {
      return;
    }
    // Newer news of it came while it was on its way.
    if (at < entry.taken) {
      return;
    }
    entry.taken = at;
    piece.apply?.(value, key);
  } finally {
    entry.reading -= 1;
    if (entry.reading === 0) {
      for (const { event, payload } of entry.held.splice(0)) {
        deliver(entry, event, payload);
      }
    }
  }
};

/** Declares a piece of the server's data a store follows. */
export const follow = <T, K = undefined>(
  piece: Piece<T, K>
): Followed<T, K> => {
  const entry: Entry = {
    asked: false,
    begun: 0,
    held: [],
    piece: piece as Piece<unknown, unknown>,
    reading: 0,
    taken: 0,
  };
  entries.add(entry);
  return {
    get: (key) => {
      entry.asked = true;
      return fromSource(piece, key);
    },
    read: () => {
      entry.asked = true;
      return readEntry(entry);
    },
    stop: () => {
      entries.delete(entry);
    },
  };
};

/**
 * An event, to a piece that declared it; a snapshot on screen holds back what it keeps, and a
 * read on its way the news it would take back.
 */
const deliver = (entry: Entry, event: EventName, payload: unknown) => {
  const { piece } = entry;
  const handler = piece.on?.[event] as ((p: unknown) => void) | undefined;
  if (!handler || (viewed() !== null && piece.snapshot)) {
    return;
  }
  if (entry.reading > 0 && piece.news?.includes(event)) {
    entry.held.push({ event, payload });
    return;
  }
  if (piece.whole?.includes(event)) {
    entry.begun += 1;
    entry.taken = entry.begun;
  }
  handler(payload);
};

const dispatch = (event: EventName, payload: unknown) => {
  for (const entry of entries) {
    deliver(entry, event, payload);
  }
};

/** What a connection open reads: the pieces read `atOpen` in turn, then every other asked for. */
const readAtOpen = async (report: (error: unknown) => void) => {
  const all = [...entries];
  for (const entry of all) {
    if (entry.piece.atOpen?.()) {
      entry.asked = true;
      // biome-ignore lint/performance/noAwaitInLoops: each may decide whether the next is read.
      await readEntry(entry).catch(report);
    }
  }
  await Promise.all(
    all
      .filter((e) => e.asked && !e.piece.atOpen && entries.has(e))
      .map((e) => readEntry(e).catch(report))
  );
};

/** The reads the latest connection open started, settled once they have all landed. */
let reading: Promise<void> = Promise.resolve();

/**
 * Settles once the reads the latest connection open started have all landed (each failure given
 * to `report`): the editor has caught up with the server. What a test awaits after the connection
 * opens, rather than time passing.
 */
export const caughtUp = (): Promise<void> => reading;

/**
 * Follows the server on the connection: its events reach the pieces, and every connection open
 * reads them again, the one open now included. A read that fails is given to `report`. Returns
 * what stops following.
 */
export const followServer = (options: {
  readonly report: (error: unknown) => void;
}): (() => void) => {
  const connection = api();
  const offs = eventNames.map((event) =>
    connection.on(event, (payload) => dispatch(event, payload))
  );
  const read = () => {
    reading = readAtOpen(options.report).catch(options.report);
  };
  const offState = useConnection.subscribe((now, before) => {
    if (now.state === "open" && before.state !== "open") {
      read();
    }
  });
  if (useConnection.getState().state === "open") {
    read();
  }
  return () => {
    offState();
    for (const off of offs) {
      off();
    }
  };
};

/**
 * Puts a snapshot on screen in place of what it keeps, or, with null, goes back to now: each
 * piece a snapshot keeps is read again from the source now in force, in the order declared (the
 * pages before the layouts drawn with them). One that fails leaves the others to be read, and
 * the first failure is the promise's.
 */
export const viewSnapshot = async (view: SnapshotView | null) => {
  useSnapshotView.setState({ view });
  const failures: unknown[] = [];
  for (const entry of entries) {
    if (entry.piece.snapshot && (entry.asked || entry.piece.atOpen?.())) {
      // biome-ignore lint/performance/noAwaitInLoops: the pages first, then what is drawn with them.
      await readEntry(entry).catch((error: unknown) => failures.push(error));
    }
  }
  if (failures.length > 0) {
    throw failures[0];
  }
};
