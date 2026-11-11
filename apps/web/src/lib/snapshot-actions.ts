/**
 * Named points in the history of the designs (ADR 0019): saved from the Changes panel, opened
 * to look at as they were, compared with now, restored as one undo step, and deleted with an
 * Undo. The list follows
 * the server's news of it (`state/kept.ts`): nothing here reads it again.
 */
import type { Checkpoint, Snapshot } from "@ultrapaint/contracts/snapshots";
import { toast } from "sonner";
import { promptDialog } from "../components/dialogs.tsx";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { goTo } from "../state/location.ts";
import { layoutSaved } from "../state/page-layout.ts";
import { reportError, useProject } from "../state/project.ts";
import { viewSnapshot } from "../state/server-data.ts";
import { useSnapshotView } from "../state/snapshot-view.ts";
import { undoOrRedo } from "./shortcuts.ts";

/** Asks for a name and keeps the designs as they are now, or as a checkpoint kept them. */
export const saveSnapshot = async (
  checkpoint?: Checkpoint
): Promise<Snapshot | null> => {
  const name = await promptDialog({
    confirmLabel: "Save",
    defaultValue: checkpoint?.label ?? "",
    description: checkpoint
      ? "The designs as they were before that agent turn, kept under a name until you delete it."
      : "The designs as they are now, kept under a name until you delete it: to look at again, or to come back to.",
    placeholder: "Shown to the client",
    title: "Save snapshot",
  });
  if (name === null) {
    return null;
  }
  try {
    const snapshot = await api().request("snapshots.create", {
      name: name.trim(),
      ...(checkpoint && { checkpoint: checkpoint.id }),
    });
    toast.success(`Saved ${snapshot.name}`);
    return snapshot;
  } catch (error) {
    reportError(error);
    return null;
  }
};

/** Opens the snapshot to look at, where the editor is now when it has that canvas. */
export const openSnapshot = async (snapshot: Snapshot) => {
  try {
    const view = await api().request("snapshots.view", { id: snapshot.id });
    // A move still being saved is the files': it lands before the snapshot's layout is drawn.
    await layoutSaved();
    const editor = useEditor.getState();
    // Opening another snapshot from one keeps the way back to now.
    useSnapshotView.setState((s) => ({
      live: s.live ?? {
        canvas: editor.canvas,
        page: editor.activePage,
        route: editor.route,
        variant: editor.variant,
      },
    }));
    await viewSnapshot(view);
    const canvas =
      view.canvases.find((c) => c.id === editor.canvas)?.id ??
      view.canvases[0]?.id ??
      "";
    await goTo({
      canvas,
      page: editor.activePage,
      route: editor.route,
      variant: editor.variant,
    });
  } catch (error) {
    reportError(error);
  }
};

/** Back to the designs as they are. */
export const closeSnapshot = async () => {
  const { live } = useSnapshotView.getState();
  useSnapshotView.setState({ live: null });
  // What did not read again is said, and the editor goes back to now all the same.
  await viewSnapshot(null).catch(reportError);
  const { canvases } = useProject.getState();
  const canvas =
    canvases.find((c) => c.id === live?.canvas)?.id ?? canvases[0]?.id ?? "";
  await goTo({
    canvas,
    page: live?.page ?? null,
    route: live?.route ?? null,
    variant: live?.variant ?? null,
  });
};

/** Back to the snapshot at once: it is one step, so the toast's Undo takes it back. */
export const restoreSnapshot = async (snapshot: Snapshot) => {
  try {
    if (useSnapshotView.getState().view) {
      await closeSnapshot();
    }
    await api().request("snapshots.restore", { id: snapshot.id });
    toast.success(`Restored ${snapshot.name}`, {
      action: { label: "Undo", onClick: () => undoOrRedo(false) },
    });
  } catch (error) {
    reportError(error);
  }
};

/** Deletes it at once, the design files left as they are: the toast's Undo brings it back. */
export const deleteSnapshot = async (snapshot: Snapshot) => {
  try {
    if (useSnapshotView.getState().view?.snapshot.id === snapshot.id) {
      await closeSnapshot();
    }
    await api().request("snapshots.delete", { id: snapshot.id });
    toast.success(`Deleted ${snapshot.name}`, {
      action: {
        label: "Undo",
        onClick: () =>
          api()
            .request("snapshots.undelete", { id: snapshot.id })
            .catch(reportError),
      },
    });
  } catch (error) {
    reportError(error);
  }
};
