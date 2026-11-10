/**
 * What the snapshot store keeps of the open repository's designs: the named snapshots (ADR 0019)
 * and the agent turns' checkpoints (ADR 0008), newest first. The server publishes each list as it
 * changes, whoever changed it (a save here or in another tab, a turn, the oldest checkpoints let
 * go of), so nothing that saves, deletes or prompts reads them again.
 */
import type { Checkpoint, Snapshot } from "@ultrapaint/contracts/snapshots";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface KeptStore {
  /** Null until read. */
  checkpoints: readonly Checkpoint[] | null;
  /** The last `load` could not read the checkpoints; false again once it is asked anew or they come. */
  checkpointsFailed: boolean;
  /**
   * Reads both, and follows them from then on. A list that cannot be read is reported and says
   * so in its `…Failed`; the other is read all the same.
   */
  load: () => Promise<void>;
  /** Null until read. */
  snapshots: readonly Snapshot[] | null;
  /** As `checkpointsFailed`, of the snapshots. */
  snapshotsFailed: boolean;
}

/** A list's read, its failure noted on the store on the way to whoever reports it. */
const noting =
  (failed: Partial<KeptStore>) =>
  (error: unknown): never => {
    useKept.setState(failed);
    throw error;
  };

export const useKept = create<KeptStore>(() => ({
  checkpoints: null,
  checkpointsFailed: false,
  load: () => {
    useKept.setState({ checkpointsFailed: false, snapshotsFailed: false });
    return Promise.all([
      checkpointsData.read().catch(noting({ checkpointsFailed: true })),
      snapshotsData.read().catch(noting({ snapshotsFailed: true })),
    ]).then(() => undefined, reportError);
  },
  snapshots: null,
  snapshotsFailed: false,
}));

const takeCheckpoints = (checkpoints: readonly Checkpoint[]) =>
  useKept.setState({ checkpoints, checkpointsFailed: false });

const takeSnapshots = (snapshots: readonly Snapshot[]) =>
  useKept.setState({ snapshots, snapshotsFailed: false });

// Not kept by a snapshot: the history stays live while one is open, to open another or go back.
const checkpointsData = follow({
  apply: takeCheckpoints,
  on: { checkpoints: takeCheckpoints },
  read: () => api().request("checkpoints.list", undefined),
  whole: ["checkpoints"],
});

const snapshotsData = follow({
  apply: takeSnapshots,
  on: { snapshots: takeSnapshots },
  read: () => api().request("snapshots.list", undefined),
  whole: ["snapshots"],
});
