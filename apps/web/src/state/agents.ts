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
  current: string | null;
  items: Record<string, readonly ThreadItem[]>;
  load: () => Promise<void>;
  open: (threadId: string | null) => Promise<void>;
  threads: readonly Thread[];
}

let bound = false;

export const useAgents = create<AgentsStore>((set, get) => ({
  agents: [],
  bind: () => {
    if (bound) {
      return;
    }
    bound = true;
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
        set((s) => ({
          items: {
            ...s.items,
            [ev.threadId]: [...(s.items[ev.threadId] ?? []), ev.item],
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
            items,
            threads,
          };
        });
      }
    });
  },
  current: null,
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
  threads: [],
}));
