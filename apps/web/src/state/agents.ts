import type {
  AgentConfig,
  Thread,
  ThreadItem,
} from "@ultrapaint/contracts/threads";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";

interface AgentsStore {
  agents: readonly AgentConfig[];
  bind: () => void;
  /** Files agent turns changed while the app was open, until they are looked at. */
  changed: readonly string[];
  clearChanged: (files?: readonly string[]) => void;
  current: string | null;
  /** Routes agents have said they are working on, by thread. */
  focused: Record<string, string>;
  /** Thread whose agent the canvas follows while it works. Off unless asked for. */
  following: string | null;
  items: Record<string, readonly ThreadItem[]>;
  load: () => Promise<void>;
  open: (threadId: string | null) => Promise<void>;
  setFollowing: (threadId: string | null) => void;
  /** Output of the terminals agents are running, by terminal id, as it arrives. */
  terminals: Record<string, string>;
  threads: readonly Thread[];
}

/** What a terminal's tail is worth keeping in memory while it runs. */
const TERMINAL_TAIL = 8000;

let bound = false;

export const useAgents = create<AgentsStore>((set, get) => ({
  agents: [],
  bind: () => {
    if (bound) {
      return;
    }
    bound = true;
    api().on("agent.focus", (ev) => {
      set((s) => ({ focused: { ...s.focused, [ev.threadId]: ev.route } }));
    });
    api().on("agent.terminal", (ev) => {
      set((s) => ({
        terminals: {
          ...s.terminals,
          [ev.terminalId]: (
            (s.terminals[ev.terminalId] ?? "") + ev.chunk
          ).slice(-TERMINAL_TAIL),
        },
      }));
    });
    api().on("agent", (ev) => {
      if (ev.type === "thread") {
        set((s) => {
          const exists = s.threads.some((t) => t.id === ev.thread.id);
          const threads = exists
            ? s.threads.map((t) => (t.id === ev.thread.id ? ev.thread : t))
            : [ev.thread, ...s.threads];
          return { current: s.current ?? ev.thread.id, threads };
        });
      } else if (ev.type === "item") {
        const { item } = ev;
        set((s) => ({
          changed:
            item.kind === "turn_end"
              ? [...new Set([...s.changed, ...item.changedFiles])]
              : s.changed,
          items: {
            ...s.items,
            [ev.threadId]: [...(s.items[ev.threadId] ?? []), item],
          },
        }));
      } else if (ev.type === "itemUpdate") {
        set((s) => ({
          items: {
            ...s.items,
            [ev.threadId]: (s.items[ev.threadId] ?? []).map((i) =>
              i.id === ev.item.id ? ev.item : i
            ),
          },
        }));
      } else if (ev.type === "removed") {
        set((s) => {
          const { [ev.threadId]: _gone, ...items } = s.items;
          const threads = s.threads.filter((t) => t.id !== ev.threadId);
          return {
            current:
              s.current === ev.threadId ? (threads[0]?.id ?? null) : s.current,
            following: s.following === ev.threadId ? null : s.following,
            items,
            threads,
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
      const current = get().current ?? threads[0]?.id ?? null;
      if (current) {
        await get().open(current);
      }
    } catch (error) {
      reportError(error);
    }
  },
  open: async (threadId) => {
    set({ current: threadId });
    if (!threadId) {
      return;
    }
    try {
      const items = await api().request("threads.items", { threadId });
      set((s) => ({ items: { ...s.items, [threadId]: items } }));
    } catch (error) {
      reportError(error);
    }
  },
  setFollowing: (threadId) => set({ following: threadId }),
  terminals: {},
  threads: [],
}));
