import type { AgentConfig, Thread, ThreadItem } from "@ultrapaint/contracts";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";

interface AgentsStore {
  agents: readonly AgentConfig[];
  threads: readonly Thread[];
  items: Record<string, readonly ThreadItem[]>;
  current: string | null;
  load: () => Promise<void>;
  open: (threadId: string | null) => Promise<void>;
  bind: () => void;
}

let bound = false;

export const useAgents = create<AgentsStore>((set, get) => ({
  agents: [],
  threads: [],
  items: {},
  current: null,
  load: async () => {
    try {
      const [agents, threads] = await Promise.all([
        api().request("agents.list", undefined),
        api().request("threads.list", undefined),
      ]);
      set({ agents, threads });
      const current = get().current ?? threads[0]?.id ?? null;
      if (current) await get().open(current);
    } catch (error) {
      reportError(error);
    }
  },
  open: async (threadId) => {
    set({ current: threadId });
    if (!threadId) return;
    try {
      const items = await api().request("threads.items", { threadId });
      set((s) => ({ items: { ...s.items, [threadId]: items } }));
    } catch (error) {
      reportError(error);
    }
  },
  bind: () => {
    if (bound) return;
    bound = true;
    api().on("agent", (ev) => {
      if (ev.type === "thread") {
        set((s) => {
          const exists = s.threads.some((t) => t.id === ev.thread.id);
          const threads = exists
            ? s.threads.map((t) => (t.id === ev.thread.id ? ev.thread : t))
            : [ev.thread, ...s.threads];
          return { threads, current: s.current ?? ev.thread.id };
        });
      } else if (ev.type === "item") {
        set((s) => ({
          items: { ...s.items, [ev.threadId]: [...(s.items[ev.threadId] ?? []), ev.item] },
        }));
      } else if (ev.type === "itemUpdate") {
        set((s) => ({
          items: {
            ...s.items,
            [ev.threadId]: (s.items[ev.threadId] ?? []).map((i) =>
              i.id === ev.item.id ? ev.item : i,
            ),
          },
        }));
      } else if (ev.type === "removed") {
        set((s) => {
          const { [ev.threadId]: _gone, ...items } = s.items;
          const threads = s.threads.filter((t) => t.id !== ev.threadId);
          return {
            items,
            threads,
            current: s.current === ev.threadId ? (threads[0]?.id ?? null) : s.current,
          };
        });
      }
    });
  },
}));
