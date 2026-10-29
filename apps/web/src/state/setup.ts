/**
 * What stands between the user and an edit: a repository nobody has set up yet. The editor opens
 * either way; the first edit is where it asks. A missing design system asks nothing: Sync's
 * badge and the Design system panel offer it.
 */
import { toast } from "sonner";
import { create } from "zustand";
import { onNotConfigured, useProject } from "./project.ts";
import { setupNeedOf } from "./setup-need.ts";
import { viewedSnapshot } from "./snapshot-view.ts";

interface SetupStore {
  close: () => void;
  open: () => void;
  shown: boolean;
}

export const useSetup = create<SetupStore>((set) => ({
  close: () => set({ shown: false }),
  open: () => set({ shown: true }),
  shown: false,
}));

/**
 * Called before an edit. `true` lets it go ahead; `false` means the setup dialog opened
 * instead, and the edit is dropped.
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
    useSetup.getState().open();
    return false;
  }
  return true;
};

/** An edit the server turned away because nothing is open asks for the setup too. */
onNotConfigured(() => useSetup.getState().open());
