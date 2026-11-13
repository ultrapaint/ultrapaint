/**
 * A folder to design on, when none is open: the server was started in the home directory or at
 * the root, which are never a project (ADR 0092). A shell with a native folder picker offers it;
 * otherwise the folder is typed in the settings' Repository section. Setting one up, an agent
 * checking what detection found against the code (`/setup`), is never started on its own: a new
 * chat suggests it while the settings are detected and not saved (ADR 0073).
 */
import { defaultSettings } from "@ultrapaint/contracts/settings";
import { toast } from "sonner";
import { platform } from "../platform.ts";
import { useProject } from "../state/project.ts";
import { detect, setUpDesigns } from "./settings-actions.ts";

const openRepository = () =>
  useProject.getState().openSettings(true, "repository");

/**
 * Opens `folder` as the project: what detection finds in it, its designs directory made, the
 * settings saved where this session keeps them. What stops it is said in a toast.
 */
const openFolder = async (folder: string) => {
  try {
    const { onto } = await detect(folder);
    const problems = await setUpDesigns(onto(defaultSettings(folder)));
    if (problems.length > 0) {
      toast.error("Couldn’t open the folder", {
        action: { label: "Settings", onClick: openRepository },
        description: problems.join(" "),
      });
    }
  } catch (error) {
    toast.error("Couldn’t open the folder", {
      description: (error as Error).message,
    });
  }
};

/** Picks a folder with the shell's picker, or opens the settings where one is typed. */
export const chooseFolder = async () => {
  const { pickFolder } = platform();
  if (!pickFolder) {
    openRepository();
    return;
  }
  try {
    const folder = await pickFolder({ title: "A folder to design in" });
    if (folder) {
      await openFolder(folder);
    }
  } catch (error) {
    toast.error("Couldn’t open the folder picker", {
      description: (error as Error).message,
    });
  }
};
