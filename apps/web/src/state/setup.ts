/**
 * What stands between the user and an edit: a repository nobody has set up yet, or a design
 * system not yet imported. The editor opens either way; the first edit is where it asks.
 */
import { create } from "zustand";
import { useDesignSystem } from "./design-system.ts";
import { onNotConfigured, useProject } from "./project.ts";
import { type SetupNeed, setupNeedOf } from "./setup-need.ts";

interface SetupStore {
  close: () => void;
  /** Kept after closing, so the dialog's content stays while it animates out. */
  need: SetupNeed;
  open: (need: SetupNeed) => void;
  shown: boolean;
}

export const useSetup = create<SetupStore>((set) => ({
  close: () => set({ shown: false }),
  need: "configure",
  open: (need) => set({ need, shown: true }),
  shown: false,
}));

/** "Not now" to `/init` holds for the tab's session, per repository. */
const dismissedKey = (repoPath: string) =>
  `ultrapaint:init-dismissed:${repoPath}`;

export const dismissInit = () => {
  const { repoPath } = useProject.getState().info;
  if (repoPath) {
    sessionStorage.setItem(dismissedKey(repoPath), "1");
  }
  useSetup.getState().close();
};

/** What the next edit would be asked about, if anything. */
export const setupNeed = (): SetupNeed | null => {
  const { configured, repoPath } = useProject.getState().info;
  const { designSystem, loaded } = useDesignSystem.getState();
  let state: "loading" | "imported" | "missing" = "missing";
  if (!loaded) {
    state = "loading";
  } else if (designSystem) {
    state = "imported";
  }
  return setupNeedOf({
    configured,
    designSystem: state,
    dismissed:
      repoPath !== undefined &&
      sessionStorage.getItem(dismissedKey(repoPath)) !== null,
  });
};

/**
 * Called before an edit. `true` lets it go ahead; `false` means the setup dialog opened
 * instead, and the edit is dropped.
 */
export const ensureEditable = (): boolean => {
  const need = setupNeed();
  if (need === null) {
    return true;
  }
  useSetup.getState().open(need);
  return false;
};

/** An edit the server turned away because nothing is open asks for the setup too. */
onNotConfigured(() => useSetup.getState().open("configure"));
