import {
  type AgentConfig,
  type AgentEdited,
  type AgentEvent,
  type AgentFocus,
  summarise,
  TERMINAL_TAIL,
  type Thread,
  type ThreadItem,
  withChunk,
} from "@ultrapaint/contracts/threads";
import { create } from "zustand";
import { isOpenQuestion } from "../lib/answers.ts";
import { threadView } from "../lib/thread-view.ts";
import { forgetAnswers } from "./answers.ts";
import { dropChips } from "./attachments.ts";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface AgentsStore {
  agents: readonly AgentConfig[];
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
  /** Opens a thread just created: it has no transcript to fetch. */
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

const SEEN_KEY = "ultrapaint:threads-seen";

const readSeen = (): Record<string, number> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    // Unreadable means nothing was seen yet: every thread shows as read on its next open.
    return {};
  }
};

const writeSeen = (seen: Record<string, number>) => {
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
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
  back: () => set({ view: "list" }),
  changed: [],
  clearChanged: (files) =>
    set((s) => ({
      changed: files ? s.changed.filter((f) => !files.includes(f)) : [],
    })),
  current: null,
  focused: {},
  following: null,
  items: {},
  // The transcript's piece is asked for with the lists', so that every connection open reads it.
  load: async () => {
    await Promise.all([
      agentsData.read().catch(reportError),
      transcriptData.read().catch(reportError),
    ]);
  },
  open: async (threadId) => {
    if (!threadId) {
      set({ current: null, view: "list" });
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
    await transcriptData.read().catch(reportError);
  },
  readFailed: {},
  seen: readSeen(),
  setFollowing: (threadId) => set({ following: threadId }),
  show: (thread) =>
    set((s) => ({
      current: thread.id,
      items: { ...s.items, [thread.id]: s.items[thread.id] ?? [] },
      // The server announces it too, usually first.
      threads: s.threads.some((t) => t.id === thread.id)
        ? s.threads
        : [thread, ...s.threads],
      view: "thread",
    })),
  terminals: {},
  threads: [],
  view: "list",
  working: {},
}));

/** The thread open in the chat: the one whose transcript the editor reads, and reads again. */
const openThread = () => {
  const { current, view } = useAgents.getState();
  return view === "thread" ? current : null;
};

/**
 * News that does not continue what the editor holds of a transcript: a chunk that starts past
 * the end of its message, or news of an item it does not hold. Something told before it was
 * missed, so it is not taken, and the transcript of the thread open in the chat is read again;
 * another thread's is when it is opened. One that could not be read is not asked for again with
 * every chunk: opening it, or the connection, asks.
 */
const missed = (threadId: string) => {
  if (openThread() === threadId && !useAgents.getState().readFailed[threadId]) {
    transcriptData.read().catch(reportError);
  }
};

/**
 * A streamed chunk: only its item changes, and only its text, by what the chunk says past the
 * end of it (`withChunk`).
 */
const takeChunk = (ev: Extract<AgentEvent, { type: "itemText" }>) => {
  const held = useAgents.getState().items[ev.threadId];
  const at = held?.findLastIndex((i) => i.id === ev.itemId) ?? -1;
  const item = held?.[at];
  if (!(held && item)) {
    missed(ev.threadId);
    return;
  }
  if (item.kind !== "agent" && item.kind !== "thought") {
    return;
  }
  const text = withChunk(item.text, ev);
  if (text === null) {
    missed(ev.threadId);
    return;
  }
  if (text === item.text) {
    return;
  }
  const items = held.with(at, { ...item, text });
  useAgents.setState((s) => ({
    items: { ...s.items, [ev.threadId]: items },
    threads: summarised(s.threads, ev.threadId, items),
  }));
};

/**
 * A thread's news: itself changed, an item added or updated, or the thread gone. What is told
 * of a transcript may be in the transcript read already (the server answers a read from its
 * memory, beside the events it is still sending), so each is taken only as far as it is news.
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
  } else if (ev.type === "item") {
    const { item } = ev;
    set((s) => {
      const held = s.items[ev.threadId] ?? [];
      // An item the transcript read already held stays as it was read: no older than this.
      const known = held.some((i) => i.id === item.id);
      const items = known ? held : [...held, item];
      return {
        changed:
          item.kind === "turn_end"
            ? [...new Set([...s.changed, ...item.changedFiles])]
            : s.changed,
        items: known ? s.items : { ...s.items, [ev.threadId]: items },
        threads: summarised(s.threads, ev.threadId, items),
      };
    });
  } else if (ev.type === "itemText") {
    takeChunk(ev);
  } else if (ev.type === "itemUpdate") {
    // A card answered or declined is asked no more: what was being given to it is let go of.
    if (ev.item.kind === "question" && !isOpenQuestion(ev.item)) {
      forgetAnswers([ev.item.id]);
    }
    if (
      !useAgents.getState().items[ev.threadId]?.some((i) => i.id === ev.item.id)
    ) {
      missed(ev.threadId);
      return;
    }
    set((s) => {
      const items = (s.items[ev.threadId] ?? []).map((i) =>
        i.id === ev.item.id ? ev.item : i
      );
      return {
        items: { ...s.items, [ev.threadId]: items },
        threads: summarised(s.threads, ev.threadId, items),
      };
    });
  } else if (ev.type === "removed") {
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
  }
};

interface AgentsRead {
  readonly agents: readonly AgentConfig[];
  readonly threads: readonly Thread[];
}

/** The agents and the threads, and what the agents say they work on, change and run. */
const agentsData = follow({
  apply: ({ agents, threads }: AgentsRead) =>
    useAgents.setState({ agents, threads }),
  on: {
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

/**
 * The transcript of the thread open in the chat, and the threads' news: followed from the start,
 * not only while the chat is open, as the badge over the tool strip reports turns that changed
 * files. The chat opens on the list; a thread is opened by choice, and its transcript read then
 * and at every connection open.
 *
 * A read is ordered with the news as a document's is (ADR 0044): what is told while it is on its
 * way waits for its answer, which the server may have read before it, and is taken after it. The
 * answer may as well hold what the editor is yet to be told, which `takeAgentEvent` tells apart.
 */
const transcriptData = follow({
  apply: (items: readonly ThreadItem[], threadId: string) =>
    useAgents.setState((s) => ({
      items: { ...s.items, [threadId]: items },
      readFailed: nowRead(s.readFailed, threadId),
    })),
  key: openThread,
  news: ["agent"],
  on: { agent: takeAgentEvent },
  read: async (threadId) => {
    try {
      return await api().request("threads.items", { threadId });
    } catch (error) {
      // Said before the news that waited is taken, which would ask for it again (`missed`).
      useAgents.setState((s) => ({
        readFailed: { ...s.readFailed, [threadId]: true },
      }));
      throw error;
    }
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
