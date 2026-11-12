/**
 * The designs' history (ADR 0087): its points, newest first, and the person's edits not in one
 * yet. The server publishes both as they change, whoever changed them (an edit, a turn, a
 * version saved in another tab), so nothing that saves or restores reads them again.
 */
import type {
  HistoryPoint,
  PendingEdits,
} from "@ultrapaint/contracts/snapshots";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface HistoryStore {
  /** The last `load` could not read the history; false again once it is asked anew or it comes. */
  failed: boolean;
  /** Reads the history, and follows it from then on. */
  load: () => Promise<void>;
  pending: PendingEdits | null;
  /** Null until read. */
  points: readonly HistoryPoint[] | null;
}

export const useHistory = create<HistoryStore>(() => ({
  failed: false,
  load: () => {
    useHistory.setState({ failed: false });
    return historyData
      .read()
      .catch((error: unknown) => {
        useHistory.setState({ failed: true });
        throw error;
      })
      .then(() => undefined, reportError);
  },
  pending: null,
  points: null,
}));

// Not kept by a point on screen: the history stays live while one is open, to open another.
const historyData = follow({
  apply: (history: {
    readonly pending: PendingEdits | null;
    readonly points: readonly HistoryPoint[];
  }) =>
    useHistory.setState({
      failed: false,
      pending: history.pending,
      points: history.points,
    }),
  on: {
    history: (points) => useHistory.setState({ failed: false, points }),
    "history.pending": (pending) => useHistory.setState({ pending }),
  },
  read: () => api().request("history.get", undefined),
  whole: ["history"],
});
