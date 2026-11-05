/**
 * What stands between the user and an edit: a snapshot being looked at, or no folder open. A
 * folder opened is set up in a chat (ADR 0062) and can be edited meanwhile; with none open, the
 * settings are where one is chosen. A missing design system asks nothing: the default look draws.
 */
import { toast } from "sonner";
import { onNotConfigured, useProject } from "./project.ts";
import { setupNeedOf } from "./setup-need.ts";
import { viewedSnapshot } from "./snapshot-view.ts";

const chooseFolder = () =>
  useProject.getState().openSettings(true, "repository");

/**
 * Called before an edit. `true` lets it go ahead; `false` means it is dropped, and what stands
 * in its way was shown instead.
 */
export const ensureEditable = (): boolean => {
  const snapshot = viewedSnapshot();
  if (snapshot) {
    toast.info(`The snapshot ${snapshot.snapshot.name} is open`, {
      description:
        "It is there to look at. Go back to now to change the designs, or restore it.",
    });
    return false;
  }
  if (setupNeedOf({ configured: useProject.getState().info.configured })) {
    chooseFolder();
    return false;
  }
  return true;
};

/** An edit the server turned away because nothing is open asks for a folder too. */
onNotConfigured(chooseFolder);
