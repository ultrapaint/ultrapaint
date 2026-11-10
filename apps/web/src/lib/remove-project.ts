/**
 * Taking a project off the shell's list (ADR 0031), as the switcher and the start screen do. The
 * shell deletes the session it kept for the project with it, which nothing brings back: when
 * that session holds what the project's folder does not, the person is asked first.
 */
import { confirmDialog } from "../components/dialogs.tsx";
import type { PlatformProject, ProjectSwitcher } from "../platform.ts";

/** Whether it went: false when the person kept it. Fails as the shell's `remove` does. */
export const removeFromList = async (
  switcher: Pick<ProjectSwitcher, "remove">,
  project: PlatformProject
) => {
  if (project.unsaved) {
    const ok = await confirmDialog({
      confirmLabel: "Remove",
      description:
        "The designs not saved to its folder are deleted; the folder stays as it is.",
      destructive: true,
      title: `Remove ${project.name} from the list?`,
    });
    if (!ok) {
      return false;
    }
  }
  await switcher.remove(project.id);
  return true;
};
