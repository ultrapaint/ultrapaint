/**
 * The design-system sync (ADR 0025): the plan the server works out for the project as it is,
 * pushed again whenever something it reads changes. The Sync view draws it, and the rail's
 * Design system button shows a dot while it has something waiting.
 */
import type { SyncPlan } from "@ultrapaint/contracts/sync";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface SyncStore {
  /** Asks the server for the plan again: after a change the server may not have seen. */
  load: () => Promise<void>;
  plan: SyncPlan | null;
  /** A request for the plan is under way. */
  reading: boolean;
}

export const useSync = create<SyncStore>((set) => ({
  load: async () => {
    set({ reading: true });
    try {
      await syncData.read();
    } catch (error) {
      reportError(error);
    } finally {
      set({ reading: false });
    }
  },
  plan: null,
  reading: false,
}));

const take = (plan: SyncPlan) => useSync.setState({ plan });

const syncData = follow({
  apply: take,
  on: { syncPlan: take },
  read: () => api().request("sync.plan", undefined),
});

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
