/**
 * Named points in the history of the designs (ADR 0019): saved from the Changes panel, opened
 * to look at as they were, compared with now, and restored as one undo step.
 */
import type { Checkpoint } from "@ultrapaint/contracts/git";
import type { Snapshot } from "@ultrapaint/contracts/snapshots";
import { toast } from "sonner";
import { confirmDialog, promptDialog } from "../components/dialogs.tsx";
import { api } from "../state/connection.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { useSnapshotView } from "../state/snapshot-view.ts";

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
    title: checkpoint ? "Keep this checkpoint" : "Save a snapshot",
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
    const editor = useEditor.getState();
    const { live } = useSnapshotView.getState();
    useSnapshotView.setState({
      // Opening another snapshot from one keeps the way back to now.
      live: live ?? {
        canvas: editor.canvas,
        page: editor.activePage,
        route: editor.route,
        variant: editor.variant,
      },
      view,
    });
    useProject.setState({ canvases: view.canvases, pages: view.pages });
    const canvas =
      view.canvases.find((c) => c.id === editor.canvas)?.id ??
      view.canvases[0]?.id ??
      "";
    await editor.openCanvas(canvas, {
      page: editor.activePage,
      route: editor.route,
      variant: editor.variant,
    });
    await useDocuments.getState().load(canvas);
  } catch (error) {
    reportError(error);
  }
};

/** Back to the designs as they are. */
export const closeSnapshot = async () => {
  const { live } = useSnapshotView.getState();
  useSnapshotView.setState({ live: null, view: null });
  await useProject.getState().load();
  const { canvases } = useProject.getState();
  const canvas =
    canvases.find((c) => c.id === live?.canvas)?.id ?? canvases[0]?.id ?? "";
  await useEditor.getState().openCanvas(canvas, {
    page: live?.page ?? null,
    route: live?.route ?? null,
    variant: live?.variant ?? null,
  });
  await useDocuments.getState().load(canvas);
};

export const restoreSnapshot = async (snapshot: Snapshot) => {
  const ok = await confirmDialog({
    confirmLabel: "Restore",
    description:
      "Every design file goes back to how the snapshot kept it, and files made since are removed. It is one step: undo takes it back. Comments stay as they are.",
    destructive: true,
    title: `Restore ${snapshot.name}?`,
  });
  if (!ok) {
    return;
  }
  try {
    if (useSnapshotView.getState().view) {
      await closeSnapshot();
    }
    await api().request("snapshots.restore", { id: snapshot.id });
    toast.success(`Restored ${snapshot.name}`);
  } catch (error) {
    reportError(error);
  }
};

export const deleteSnapshot = async (snapshot: Snapshot) => {
  const ok = await confirmDialog({
    confirmLabel: "Delete",
    description: "The design files stay as they are; only the snapshot goes.",
    destructive: true,
    title: `Delete the snapshot ${snapshot.name}?`,
  });
  if (!ok) {
    return false;
  }
  if (useSnapshotView.getState().view?.snapshot.id === snapshot.id) {
    await closeSnapshot();
  }
  try {
    await api().request("snapshots.delete", { id: snapshot.id });
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};
