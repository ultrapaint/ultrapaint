/**
 * What is done to the designs' history (ADR 0087): a version saved (a point named), renamed or
 * taken out of the versions, a point opened to look at as it was, and the designs restored to
 * a point, which keeps the person's edits not in a point yet first and is one undo step. The
 * history follows the server's news of it (`state/history.ts`): nothing here reads it again.
 */
import type { HistoryPoint } from "@ultrapaint/contracts/snapshots";
import { plural } from "@ultrapaint/shared/text";
import { toast } from "sonner";
import { promptDialog } from "../components/dialogs.tsx";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { useHistory } from "../state/history.ts";
import { goTo } from "../state/location.ts";
import { layoutSaved } from "../state/page-layout.ts";
import { reportError, useProject } from "../state/project.ts";
import { viewSnapshot } from "../state/server-data.ts";
import { useSnapshotView } from "../state/snapshot-view.ts";
import { pointTitle } from "./history-words.ts";
import { undoOrRedo } from "./shortcuts.ts";

/** Asks for a name, and names the point, or the designs as they are now: a version. */
export const saveVersion = async (
  point?: HistoryPoint
): Promise<HistoryPoint | null> => {
  const name = await promptDialog({
    confirmLabel: "Save",
    defaultValue: point?.name ?? "",
    description: point
      ? "This point of the history, kept under a name."
      : "The designs as they are now, kept under a name.",
    placeholder: "Shown to the client",
    title: point?.name ? "Rename version" : "Save version",
  });
  if (name === null) {
    return null;
  }
  try {
    const saved = await api().request("history.save", {
      name: name.trim(),
      ...(point && { id: point.id }),
    });
    toast.success(`Saved ${saved.name ?? "the version"}`);
    return saved;
  } catch (error) {
    reportError(error);
    return null;
  }
};

/** A version back among the other points: its name taken away, nothing else. */
export const removeVersion = async (point: HistoryPoint) => {
  try {
    await api().request("history.rename", { id: point.id, name: null });
  } catch (error) {
    reportError(error);
  }
};

/** Opens the point to look at, where the editor is now when it has that canvas. */
export const openPoint = async (point: HistoryPoint) => {
  try {
    const view = await api().request("history.view", { id: point.id });
    // A move still being saved is the files': it lands before the point's layout is drawn.
    await layoutSaved();
    const editor = useEditor.getState();
    // Opening another point from one keeps the way back to now.
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
export const closePoint = async () => {
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

const time = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * The designs put back as the point kept them, at once: the edits not in a point yet are kept
 * in one first, which the toast says, and its Undo takes the restore back.
 */
export const restorePoint = async (point: HistoryPoint) => {
  const { pending } = useHistory.getState();
  try {
    if (useSnapshotView.getState().view) {
      await closePoint();
    }
    await api().request("history.restore", { id: point.id });
    toast.success(`Restored to “${pointTitle(point)}”`, {
      action: { label: "Undo", onClick: () => undoOrRedo(false) },
      ...(pending && {
        description: `Your ${plural(pending.edits, "edit")} since ${time.format(pending.since)} are kept in History.`,
      }),
    });
  } catch (error) {
    reportError(error);
  }
};
