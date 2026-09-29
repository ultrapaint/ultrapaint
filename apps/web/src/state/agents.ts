import {
  type AgentConfig,
  summarise,
  type Thread,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";

interface AgentsStore {
  agents: readonly AgentConfig[];
  /** Back from a thread to the list of threads; the thread's session goes on. */
  back: () => void;
  bind: () => void;
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

/** The thread with its summary brought up to date from the items the editor holds. */
const summarised = (
  threads: readonly Thread[],
  threadId: string,
  items: readonly ThreadItem[]
) =>
  threads.map((t) =>
    t.id === threadId && items.length > 0
      ? { ...t, summary: summarise(items) }
      : t
  );

/** What a terminal's tail is worth keeping in memory while it runs. */
const TERMINAL_TAIL = 8000;

/** A terminal id is the agent session's; the thread makes it the editor's. */
export const terminalKey = (threadId: string, terminalId: string) =>
  `${threadId}/${terminalId}`;

let bound = false;

export const useAgents = create<AgentsStore>((set, get) => ({
  agents: [],
  back: () => set({ view: "list" }),
  bind: () => {
    if (bound) {
      return;
    }
    bound = true;
    api().on("agent.focus", (ev) => {
      set((s) => {
        const focused = { ...s.focused, [ev.threadId]: ev.pageId };
        if (!ev.nodeIds?.length) {
          return { focused };
        }
        const before = s.working[ev.threadId];
        const same = before?.doc === ev.pageId && !before.done;
        const work: AgentWork = {
          doc: ev.pageId,
          done: false,
          intent: ev.nodeIds,
          nodeIds: [
            ...new Set([...(same ? before.nodeIds : []), ...ev.nodeIds]),
          ],
          ...(ev.action === undefined ? {} : { action: ev.action }),
        };
        return { focused, working: { ...s.working, [ev.threadId]: work } };
      });
    });
    api().on("agent.edited", (ev) => {
      set((s) => {
        const before = s.working[ev.threadId];
        const same = before?.doc === ev.doc && !before.done;
        const action = same ? before.action : ev.label;
        const work: AgentWork = {
          doc: ev.doc,
          done: false,
          // What it announced and has now changed is no longer a skeleton.
          intent: same
            ? before.intent.filter((id) => !ev.nodeIds.includes(id))
            : [],
          nodeIds: [
            ...new Set([...(same ? before.nodeIds : []), ...ev.nodeIds]),
          ],
          ...(action === undefined ? {} : { action }),
        };
        return { working: { ...s.working, [ev.threadId]: work } };
      });
    });
    api().on("agent.terminal", (ev) => {
      const key = terminalKey(ev.threadId, ev.terminalId);
      set((s) => ({
        terminals: {
          ...s.terminals,
          [key]: ((s.terminals[key] ?? "") + ev.chunk).slice(-TERMINAL_TAIL),
        },
      }));
    });
    api().on("agent", (ev) => {
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
          const stopped =
            ev.thread.status !== "running" && ev.thread.status !== "starting";
          if (work && stopped && !work.done) {
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
          const { [ev.threadId]: _gone, ...items } = s.items;
          const threads = s.threads.filter((t) => t.id !== ev.threadId);
          const gone = s.current === ev.threadId;
          return {
            current: gone ? null : s.current,
            following: s.following === ev.threadId ? null : s.following,
            items,
            threads,
            view: gone ? ("list" as const) : s.view,
          };
        });
      }
    });
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
    try {
      const [agents, threads] = await Promise.all([
        api().request("agents.list", undefined),
        api().request("threads.list", undefined),
      ]);
      set({ agents, threads });
      // The chat opens on the list; a thread is opened by choice.
      const { current, view } = get();
      if (current && view === "thread") {
        await get().open(current);
      }
    } catch (error) {
      reportError(error);
    }
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

/** Marks a thread's work done, and takes it off the canvas a moment later. */
const finishWork = (threadId: string) => {
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
