/**
 * The design-system sync (ADR 0025): the plan the server works out for the project as it is,
 * pushed again whenever something it reads changes. The Sync view draws it, and the rail's
 * Design system button shows a dot while it has something waiting.
 */
import type { SyncPlan } from "@ultrapaint/contracts/sync";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";

interface SyncStore {
  /** Asks the server for the plan again: after a change the server may not have seen. */
  load: () => Promise<void>;
  plan: SyncPlan | null;
  /** A request for the plan is under way. */
  reading: boolean;
}

let bound = false;

export const useSync = create<SyncStore>((set) => ({
  load: async () => {
    if (!bound) {
      bound = true;
      api().on("syncPlan", (plan) => set({ plan }));
    }
    set({ reading: true });
    try {
      set({ plan: await api().request("sync.plan", undefined) });
    } catch (error) {
      reportError(error);
    } finally {
      set({ reading: false });
    }
  },
  plan: null,
  reading: false,
}));

/** Whether the plan has something the user should look at: what the rail's dot says. */
export const syncWaiting = (plan: SyncPlan | null) =>
  plan?.steps.some(
    (s) =>
      s.state === "attention" &&
      (s.kind === "settings" ||
        s.kind === "describe" ||
        s.kind === "design-md" ||
        s.kind === "design-tokens" ||
        s.kind === "figma-tokens")
  ) ?? false;
