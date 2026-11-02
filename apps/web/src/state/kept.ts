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
  /** Reads both, and follows them from then on. */
  load: () => Promise<void>;
  /** Null until read. */
  snapshots: readonly Snapshot[] | null;
}

export const useKept = create<KeptStore>(() => ({
  checkpoints: null,
  load: () =>
    Promise.all([checkpointsData.read(), snapshotsData.read()]).then(
      () => undefined,
      reportError
    ),
  snapshots: null,
}));

const takeCheckpoints = (checkpoints: readonly Checkpoint[]) =>
  useKept.setState({ checkpoints });

const takeSnapshots = (snapshots: readonly Snapshot[]) =>
  useKept.setState({ snapshots });

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
