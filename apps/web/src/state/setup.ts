/**
 * What stands between the user and an edit: a repository nobody has set up yet, or a design
 * system not yet imported. The editor opens either way; the first edit is where it asks.
 */
import { toast } from "sonner";
import { create } from "zustand";
import { useDesignSystem } from "./design-system.ts";
import { onNotConfigured, useProject } from "./project.ts";
import { type SetupNeed, setupNeedOf } from "./setup-need.ts";
import { viewedSnapshot } from "./snapshot-view.ts";

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
const setupNeed = (): SetupNeed | null => {
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
export const ensureEditable = (
  options: {
    /**
     * Whether the edit is worth asking about the design system first. Importing a Figma file is
     * itself a way to make one (ADR 0025), so it is not.
     */
    readonly designSystem?: boolean;
  } = {}
): boolean => {
  const snapshot = viewedSnapshot();
  if (snapshot) {
    toast.info(`The snapshot ${snapshot.snapshot.name} is open`, {
      description:
        "It is there to look at. Go back to now to change the designs, or restore it.",
    });
    return false;
  }
  const need = setupNeed();
  if (need === null || (need === "init" && options.designSystem === false)) {
    return true;
  }
  useSetup.getState().open(need);
  return false;
};

/** An edit the server turned away because nothing is open asks for the setup too. */
onNotConfigured(() => useSetup.getState().open("configure"));
