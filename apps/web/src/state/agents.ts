import {
  type AgentConfig,
  type AgentEdited,
  type AgentEvent,
  type AgentFocus,
  summarise,
  TERMINAL_TAIL,
  type Thread,
  type ThreadEvent,
  type ThreadItem,
  type ThreadStreamItem,
  withChunk,
} from "@ultrapaint/contracts/threads";
import { create } from "zustand";
import { isOpenQuestion } from "../lib/answers.ts";
import { threadView } from "../lib/thread-view.ts";
import { forgetAnswers } from "./answers.ts";
import { dropChips } from "./attachments.ts";
import { api } from "./connection.ts";
import { dropDraft } from "./drafts.ts";
import { reportError } from "./project.ts";
import { readProjectItem, writeProjectItem } from "./project-storage.ts";
import { follow } from "./server-data.ts";

interface AgentsStore {
  agents: readonly AgentConfig[];
  /**
   * The number of the last change the editor applied of the thread it follows, the one open in
   * the chat (ADR 0130): what its stream resumes from after a reconnect.
   */
  applied: Record<string, number>;
  /** The server's run the applied numbers are of, by thread: resumed from only in that run. */
  appliedRun: Record<string, string>;
  /** Back from a thread to the list of threads; the thread's session goes on. */
  back: () => void;
  /** Files agent turns changed while the app was open, until they are looked at. */
  changed: readonly string[];
  clearChanged: (files?: readonly string[]) => void;
  current: string | null;
  /** Pages agents have said they are working on, by thread. */
  focused: Record<string, string>;
  /** Thread whose agent the canvas follows while it works. Off unless asked for. */
  following: string | null;
  items: Record<string, readonly ThreadItem[]>;
  load: () => Promise<void>;
  open: (threadId: string | null) => Promise<void>;
  /**
   * The threads opened whose transcript could not be read, until it is: with none held of it, the
   * chat says so in its place rather than draw a chat nothing was said in.
   */
  readFailed: Record<string, true>;
  /** When each thread was last looked at, so the list can say which ones have news. */
  seen: Record<string, number>;
  setFollowing: (threadId: string | null) => void;
  /** Opens a thread just created, at once: it has no transcript to wait for, and is followed. */
  show: (thread: Thread) => void;
  /** Output of the terminals agents are running, by `terminalKey`, as it arrives. */
  terminals: Record<string, string>;
  threads: readonly Thread[];
  /** The chat shows the list of threads, or the one open. */
  view: "list" | "thread";
  /** What each running agent is changing, node by node: what it said it would, then what it did. */
  working: Record<string, AgentWork>;
}

/**
 * An agent's work on one document: the nodes it said it is about to change (`focus`) or changed
 * (`apply_operations`), with what it said it is doing. `done` once its turn ended, for a moment.
 */
export interface AgentWork {
  readonly action?: string;
  readonly doc: string;
  readonly done: boolean;
  /** Nodes it announced, not yet changed: drawn as skeletons where they are text or pictures. */
  readonly intent: readonly string[];
  readonly nodeIds: readonly string[];
}

/** How long an agent's work stays on the canvas once its turn ended. */
const DONE_FOR_MS = 4000;
const doneTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** When each thread was last looked at: the project's own (`project-storage.ts`). */
const SEEN_KEY = "ultrapaint:threads-seen";

const readSeen = (): Record<string, number> => {
  try {
    const parsed: unknown = JSON.parse(readProjectItem(SEEN_KEY) ?? "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    // Unreadable means nothing was seen yet: every thread shows as read on its next open.
    return {};
  }
};

const writeSeen = (seen: Record<string, number>) => {
  writeProjectItem(SEEN_KEY, JSON.stringify(seen));
};

/** Whether a thread changed since it was last looked at. */
export const isUnread = (thread: Thread, seen: Record<string, number>) =>
  thread.updatedAt > (seen[thread.id] ?? thread.createdAt);

/**
 * The threads with one's summary brought up to date from the items the editor holds. The same
 * list, and the same thread, while the summary stays what it was: an agent streaming its answer
 * updates an item many times a second, and everything showing the thread would redraw each time.
 */
export const summarised = (
  threads: readonly Thread[],
  threadId: string,
  items: readonly ThreadItem[]
): readonly Thread[] => {
  const at = threads.findIndex((t) => t.id === threadId);
  const thread = threads[at];
  if (!thread || items.length === 0) {
    return threads;
  }
  const summary = summarise(items);
  if (
    thread.summary?.text === summary.text &&
    thread.summary.waiting === summary.waiting
  ) {
    return threads;
  }
  return threads.with(at, { ...thread, summary });
};

/**
 * An agent's work once it says what it is about to change: added to what it is already doing on
 * the same document, or begun afresh on another.
 */
export const focusedWork = (
  before: AgentWork | undefined,
  ev: AgentFocus & { readonly nodeIds: readonly string[] }
): AgentWork => {
  const same = before?.doc === ev.pageId && !before.done;
  return {
    doc: ev.pageId,
    done: false,
    intent: ev.nodeIds,
    nodeIds: [...new Set([...(same ? before.nodeIds : []), ...ev.nodeIds])],
    ...(ev.action === undefined ? {} : { action: ev.action }),
  };
};

/**
 * An agent's work once it changed nodes: what it announced and has now changed is no longer a
 * skeleton, and what it said it is doing stays said.
 */
export const editedWork = (
  before: AgentWork | undefined,
  ev: AgentEdited
): AgentWork => {
  const same = before?.doc === ev.doc && !before.done;
  const action = same ? before.action : ev.label;
  return {
    doc: ev.doc,
    done: false,
    intent: same ? before.intent.filter((id) => !ev.nodeIds.includes(id)) : [],
    nodeIds: [...new Set([...(same ? before.nodeIds : []), ...ev.nodeIds])],
    ...(action === undefined ? {} : { action }),
  };
};

/**
 * Everything kept of a thread that is gone: its transcript and whether it was read, its
 * terminals, its work, and when it was last looked at.
 */
const withoutThread = (s: AgentsStore, threadId: string) => {
  const { [threadId]: _items, ...items } = s.items;
  const { [threadId]: _work, ...working } = s.working;
  const { [threadId]: _focus, ...focused } = s.focused;
  const { [threadId]: _seen, ...seen } = s.seen;
  const { [threadId]: _failed, ...readFailed } = s.readFailed;
  const prefix = terminalKey(threadId, "");
  const terminals = Object.fromEntries(
    Object.entries(s.terminals).filter(([key]) => !key.startsWith(prefix))
  );
  clearTimeout(doneTimers.get(threadId));
  doneTimers.delete(threadId);
  return { focused, items, readFailed, seen, terminals, working };
};

/**
 * What other stores keep of a thread that is gone: the chips its next prompt would have taken,
 * and the answers being given to its cards.
 */
const forgetThread = (threadId: string) => {
  const items = useAgents.getState().items[threadId] ?? [];
  dropChips(threadId);
  dropDraft(threadId);
  forgetAnswers(items.flatMap((i) => (i.kind === "question" ? [i.id] : [])));
};

/** The threads whose transcript could not be read, one of them read now or being read again. */
const nowRead = (
  failed: AgentsStore["readFailed"],
  threadId: string
): AgentsStore["readFailed"] => {
  if (!failed[threadId]) {
    return failed;
  }
  const { [threadId]: _read, ...rest } = failed;
  return rest;
};

/** A terminal id is the agent session's; the thread makes it the editor's. */
export const terminalKey = (threadId: string, terminalId: string) =>
  `${threadId}/${terminalId}`;

export const useAgents = create<AgentsStore>((set) => ({
  agents: [],
  applied: {},
  appliedRun: {},
  back: () => {
    set({ view: "list" });
    followOpen().catch(reportError);
  },
  changed: [],
  clearChanged: (files) =>
    set((s) => ({
      changed: files ? s.changed.filter((f) => !files.includes(f)) : [],
    })),
  current: null,
  focused: {},
  following: null,
  items: {},
  load: async () => {
    await agentsData.read().catch(reportError);
  },
  open: async (threadId) => {
    if (!threadId) {
      set({ current: null, view: "list" });
      followOpen().catch(reportError);
      return;
    }
    set((s) => {
      const thread = s.threads.find((t) => t.id === threadId);
      const seen = { ...s.seen, [threadId]: thread?.updatedAt ?? Date.now() };
      writeSeen(seen);
      return {
        current: threadId,
        readFailed: nowRead(s.readFailed, threadId),
        seen,
        view: "thread",
      };
    });
    await followOpen();
  },
  readFailed: {},
  seen: readSeen(),
  setFollowing: (threadId) => set({ following: threadId }),
  show: (thread) => {
    set((s) => ({
      current: thread.id,
      items: { ...s.items, [thread.id]: s.items[thread.id] ?? [] },
      // The server announces it too, usually first.
      threads: s.threads.some((t) => t.id === thread.id)
        ? s.threads
        : [thread, ...s.threads],
      view: "thread",
    }));
    followOpen().catch(reportError);
  },
  terminals: {},
  threads: [],
  view: "list",
  working: {},
}));

/** The thread open in the chat: the one whose stream the editor follows. */
const openThread = () => {
  const { current, view } = useAgents.getState();
  return view === "thread" ? current : null;
};

type Change = Partial<AgentsStore> | null;

/**
 * A streamed chunk: only its item changes, and only its text, by what the chunk says past the
 * end of it (`withChunk`). A chunk of an item not held, or one past the end of its text, changes
 * nothing: in a thread not followed, its stream's snapshot puts it right once it is opened.
 */
const chunked = (
  s: AgentsStore,
  ev: Extract<ThreadEvent, { type: "itemText" }>
): Change => {
  const held = s.items[ev.threadId];
  const at = held?.findLastIndex((i) => i.id === ev.itemId) ?? -1;
  const item = held?.[at];
  if (!(held && item) || (item.kind !== "agent" && item.kind !== "thought")) {
    return null;
  }
  const text = withChunk(item.text, ev);
  if (text === null || text === item.text) {
    return null;
  }
  const items = held.with(at, { ...item, text });
  return {
    items: { ...s.items, [ev.threadId]: items },
    threads: summarised(s.threads, ev.threadId, items),
  };
};

/** An item added to a thread, or updated: put where it is in what the editor holds. */
const withItem = (s: AgentsStore, threadId: string, item: ThreadItem) => {
  const held = s.items[threadId] ?? [];
  const at = held.findIndex((i) => i.id === item.id);
  const items = at === -1 ? [...held, item] : held.with(at, item);
  return {
    items: { ...s.items, [threadId]: items },
    threads: summarised(s.threads, threadId, items),
  };
};

const holds = (threadId: string, itemId: string) =>
  useAgents.getState().items[threadId]?.some((i) => i.id === itemId) ?? false;

/**
 * A thread's news: itself changed, an item added or updated, or the thread gone. The items of
 * the thread followed are its stream's to tell, in order (`takeStreamed`); another thread's are
 * taken as far as they are news, which keeps the list's summaries live, and its stream's
 * snapshot puts them right once it is opened.
 */
const takeAgentEvent = (ev: AgentEvent) => {
  const set = useAgents.setState;
  if (ev.type === "thread") {
    set((s) => {
      const exists = s.threads.some((t) => t.id === ev.thread.id);
      // The summary is derived when the list is read; an update carries none.
      const threads = exists
        ? s.threads.map((t) =>
            t.id === ev.thread.id ? { summary: t.summary, ...ev.thread } : t
          )
        : [ev.thread, ...s.threads];
      const work = s.working[ev.thread.id];
      if (work && !threadView(ev.thread).busy && !work.done) {
        finishWork(ev.thread.id);
      }
      // The open thread is being looked at: its news is not news.
      if (s.view === "thread" && s.current === ev.thread.id) {
        const seen = { ...s.seen, [ev.thread.id]: ev.thread.updatedAt };
        writeSeen(seen);
        return { current: s.current, seen, threads };
      }
      return { current: s.current ?? ev.thread.id, threads };
    });
    return;
  }
  if (ev.type === "removed") {
    const followed = openThread() === ev.threadId;
    forgetThread(ev.threadId);
    set((s) => {
      const threads = s.threads.filter((t) => t.id !== ev.threadId);
      const gone = s.current === ev.threadId;
      const left = withoutThread(s, ev.threadId);
      if (Object.hasOwn(s.seen, ev.threadId)) {
        writeSeen(left.seen);
      }
      return {
        ...left,
        current: gone ? null : s.current,
        following: s.following === ev.threadId ? null : s.following,
        threads,
        view: gone ? ("list" as const) : s.view,
      };
    });
    if (followed) {
      followOpen().catch(reportError);
    }
    return;
  }
  if (ev.type === "item" && ev.item.kind === "turn_end") {
    const files = ev.item.changedFiles;
    set((s) => ({ changed: [...new Set([...s.changed, ...files])] }));
  }
  // A card answered or declined is asked no more: what was being given to it is let go of.
  if (
    ev.type === "itemUpdate" &&
    ev.item.kind === "question" &&
    !isOpenQuestion(ev.item)
  ) {
    forgetAnswers([ev.item.id]);
  }
  // The thread followed: its stream tells its items, in order.
  if (Object.hasOwn(useAgents.getState().applied, ev.threadId)) {
    return;
  }
  if (ev.type === "itemText") {
    set((s) => chunked(s, ev) ?? s);
    return;
  }
  const held = holds(ev.threadId, ev.item.id);
  // An item held already stays as it is held, no older than this.
  const added = ev.type === "item" && !held;
  // An update of one not held waits for the thread's snapshot.
  const updated = ev.type === "itemUpdate" && held;
  if (added || updated) {
    set((s) => withItem(s, ev.threadId, ev.item));
  }
};

/**
 * What the thread followed's stream says (ADR 0130): a snapshot in place of what the editor
 * held, then each change after the last one applied, in order; a change at or below it was
 * applied already, and is dropped. A snapshot read while a change was being made may hold the
 * change it then tells: taken by its item's id, or by its offset for a chunk, it changes nothing.
 */
const takeStreamed = (threadId: string, told: ThreadStreamItem) =>
  useAgents.setState((s) => {
    const last = s.applied[threadId];
    // Up to date: its transcript is read, whether or not anything was told before it.
    if (told.kind === "synchronized") {
      return {
        applied: {
          ...s.applied,
          [threadId]: Math.max(last ?? told.sequence, told.sequence),
        },
        appliedRun: { ...s.appliedRun, [threadId]: told.run },
        readFailed: nowRead(s.readFailed, threadId),
      };
    }
    if (
      told.kind !== "snapshot" &&
      last !== undefined &&
      told.sequence <= last
    ) {
      return s;
    }
    const applied = { ...s.applied, [threadId]: told.sequence };
    if (told.kind === "snapshot") {
      return {
        applied,
        appliedRun: { ...s.appliedRun, [threadId]: told.run },
        items: { ...s.items, [threadId]: told.items },
        readFailed: nowRead(s.readFailed, threadId),
        threads: summarised(s.threads, threadId, told.items),
      };
    }
    if (told.event.type === "thread") {
      return { applied };
    }
    const { event } = told;
    const change =
      event.type === "itemText"
        ? chunked(s, event)
        : withItem(s, threadId, event.item);
    return { ...change, applied };
  });

/** The thread whose stream the editor follows, and who waits for it to be up to date. */
let streamed: {
  readonly stop: () => void;
  readonly threadId: string;
  readonly synchronized: () => void;
} | null = null;

/**
 * Follows the thread open in the chat, from the last change applied of it, and stops following
 * any other: called whenever the thread open may have changed. The connection starts its stream
 * again at every open, from the last change applied then. Settles once the stream has told
 * everything up to now, or failed, or is stopped.
 */
const followOpen = (): Promise<void> => {
  const threadId = openThread();
  const before = streamed;
  streamed = null;
  before?.stop();
  before?.synchronized();
  if (before && before.threadId !== threadId) {
    useAgents.setState((s) => {
      const { [before.threadId]: _gone, ...applied } = s.applied;
      const { [before.threadId]: _run, ...appliedRun } = s.appliedRun;
      return { applied, appliedRun };
    });
  }
  if (threadId === null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let waiting = true;
    const synchronized = () => {
      waiting = false;
      resolve();
    };
    const stop = api().follow(
      "threads.follow",
      () => {
        const { applied, appliedRun } = useAgents.getState();
        const afterSequence = applied[threadId];
        const run = appliedRun[threadId];
        return afterSequence === undefined || run === undefined
          ? { threadId }
          : { afterSequence, run, threadId };
      },
      {
        onError: (error) => {
          useAgents.setState((s) => ({
            readFailed: { ...s.readFailed, [threadId]: true },
          }));
          reportError(error);
          synchronized();
        },
        onItem: (told) => {
          takeStreamed(threadId, told);
          if (told.kind === "synchronized" && waiting) {
            synchronized();
          }
        },
      }
    );
    streamed = { stop, synchronized, threadId };
  });
};

/**
 * The threads a list read says, each kept as held where the row held is newer: a read made as the
 * connection opened is answered after the events that followed it, and must not take a thread
 * back to what it was before them (ADR 0130).
 */
const newerOf = (
  held: readonly Thread[],
  read: readonly Thread[]
): Thread[] => {
  const byId = new Map(held.map((t) => [t.id, t]));
  return read.map((t) => {
    const mine = byId.get(t.id);
    return mine !== undefined && mine.updatedAt > t.updatedAt ? mine : t;
  });
};

interface AgentsRead {
  readonly agents: readonly AgentConfig[];
  readonly threads: readonly Thread[];
}

/**
 * The agents and the threads, and what the agents say they work on, change and run. The threads'
 * news is followed from the start, not only while the chat is open, as the badge over the tool
 * strip reports turns that changed files; the transcript of the thread open in the chat is its
 * stream's (`followOpen`).
 */
const agentsData = follow({
  // Read with the threads, the project known by then: what this project's pages saw.
  apply: ({ agents, threads }: AgentsRead) =>
    useAgents.setState((s) => ({
      agents,
      seen: { ...readSeen(), ...s.seen },
      threads: newerOf(s.threads, threads),
    })),
  on: {
    agent: takeAgentEvent,
    "agent.edited": (ev) =>
      useAgents.setState((s) => ({
        working: {
          ...s.working,
          [ev.threadId]: editedWork(s.working[ev.threadId], ev),
        },
      })),
    "agent.focus": (ev) =>
      useAgents.setState((s) => {
        const focused = { ...s.focused, [ev.threadId]: ev.pageId };
        const { nodeIds } = ev;
        if (!nodeIds?.length) {
          return { focused };
        }
        const work = focusedWork(s.working[ev.threadId], { ...ev, nodeIds });
        return { focused, working: { ...s.working, [ev.threadId]: work } };
      }),
    "agent.terminal": (ev) => {
      const key = terminalKey(ev.threadId, ev.terminalId);
      useAgents.setState((s) => ({
        terminals: {
          ...s.terminals,
          [key]: ((s.terminals[key] ?? "") + ev.chunk).slice(-TERMINAL_TAIL),
        },
      }));
    },
  },
  read: async (): Promise<AgentsRead> => {
    const [agents, threads] = await Promise.all([
      api().request("agents.list", undefined),
      api().request("threads.list", undefined),
    ]);
    return { agents, threads };
  },
});

/** Marks a thread's work done, and takes it off the canvas a moment later. */
export const finishWork = (threadId: string) => {
  queueMicrotask(() => {
    useAgents.setState((s) => {
      const work = s.working[threadId];
      return work
        ? {
            working: {
              ...s.working,
              [threadId]: { ...work, done: true, intent: [] },
            },
          }
        : s;
    });
  });
  clearTimeout(doneTimers.get(threadId));
  doneTimers.set(
    threadId,
    setTimeout(() => {
      doneTimers.delete(threadId);
      useAgents.setState((s) => {
        // A turn begun since is the thread's work again: only work still done goes.
        if (!s.working[threadId]?.done) {
          return s;
        }
        const { [threadId]: _gone, ...working } = s.working;
        return { working };
      });
    }, DONE_FOR_MS)
  );
};
