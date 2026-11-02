import {
  type AgentConfig,
  type AgentEdited,
  type AgentEvent,
  type AgentFocus,
  summarise,
  TERMINAL_TAIL,
  type Thread,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";
import { create } from "zustand";
import { threadView } from "../lib/thread-view.ts";
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

/** Everything kept of a thread that is gone: its transcript, its terminals, its work. */
const withoutThread = (s: AgentsStore, threadId: string) => {
  const { [threadId]: _items, ...items } = s.items;
  const { [threadId]: _work, ...working } = s.working;
  const { [threadId]: _focus, ...focused } = s.focused;
  const prefix = terminalKey(threadId, "");
  const terminals = Object.fromEntries(
    Object.entries(s.terminals).filter(([key]) => !key.startsWith(prefix))
  );
  clearTimeout(doneTimers.get(threadId));
  doneTimers.delete(threadId);
  return { focused, items, terminals, working };
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
  load: () => agentsData.read().catch(reportError),
  open: async (threadId) => {
    if (!threadId) {
      set({ current: null, view: "list" });
      return;
    }
    set((s) => {
      const thread = s.threads.find((t) => t.id === threadId);
      const seen = { ...s.seen, [threadId]: thread?.updatedAt ?? Date.now() };
      writeSeen(seen);
      return { current: threadId, seen, view: "thread" };
    });
    try {
      const items = await api().request("threads.items", { threadId });
      set((s) => ({ items: { ...s.items, [threadId]: items } }));
    } catch (error) {
      reportError(error);
    }
  },
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

/** A thread's news: itself changed, an item added or updated, or the thread gone. */
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
      const items = [...(s.items[ev.threadId] ?? []), item];
      return {
        changed:
          item.kind === "turn_end"
            ? [...new Set([...s.changed, ...item.changedFiles])]
            : s.changed,
        items: { ...s.items, [ev.threadId]: items },
        threads: summarised(s.threads, ev.threadId, items),
      };
    });
  } else if (ev.type === "itemText") {
    // A streamed chunk: only its item changes, and only its text.
    set((s) => {
      const items = (s.items[ev.threadId] ?? []).map((i) =>
        i.id === ev.itemId && (i.kind === "agent" || i.kind === "thought")
          ? { ...i, text: i.text + ev.text }
          : i
      );
      return {
        items: { ...s.items, [ev.threadId]: items },
        threads: summarised(s.threads, ev.threadId, items),
      };
    });
  } else if (ev.type === "itemUpdate") {
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
    set((s) => {
      const threads = s.threads.filter((t) => t.id !== ev.threadId);
      const gone = s.current === ev.threadId;
      return {
        ...withoutThread(s, ev.threadId),
        current: gone ? null : s.current,
        following: s.following === ev.threadId ? null : s.following,
        threads,
        view: gone ? ("list" as const) : s.view,
      };
    });
  }
};

/** What the agents' piece reads: the transcript only of a thread open in the chat. */
interface AgentsRead {
  readonly agents: readonly AgentConfig[];
  readonly items: {
    readonly items: readonly ThreadItem[];
    readonly threadId: string;
  } | null;
  readonly threads: readonly Thread[];
}

/**
 * The agents, the threads and the transcript of the one open, and what the agents say as they
 * work: followed from the start, not only while the chat is open, as the badge over the tool
 * strip reports turns that changed files.
 */
const agentsData = follow({
  apply: ({ agents, items, threads }: AgentsRead) =>
    useAgents.setState((s) => ({
      agents,
      threads,
      ...(items && { items: { ...s.items, [items.threadId]: items.items } }),
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
    // The chat opens on the list; a thread is opened by choice, and its transcript read again.
    const { current, view } = useAgents.getState();
    const open = view === "thread" ? current : null;
    const [agents, threads, items] = await Promise.all([
      api().request("agents.list", undefined),
      api().request("threads.list", undefined),
      open ? api().request("threads.items", { threadId: open }) : null,
    ]);
    return {
      agents,
      items: open && items ? { items, threadId: open } : null,
      threads,
    };
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
        const { [threadId]: _gone, ...working } = s.working;
        return { working };
      });
    }, DONE_FOR_MS)
  );
};
