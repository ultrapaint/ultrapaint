/**
 * Starting an application where the repository has none (ADR 0025): the user says where, the
 * server writes a Vite, React and Tailwind v4 application with its components (its theme from
 * a Figma file when one is imported) and installs it, and the settings that point the tool at it
 * are applied. Offered by the first-run setup and by the Sync view.
 */
import {
  defaultSettings,
  type Settings,
} from "@ultrapaint/contracts/settings";
import { toast } from "sonner";
import { promptDialog } from "../components/dialogs.tsx";
import { api } from "../state/connection.ts";
import { save } from "./settings-actions.ts";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Asks where, writes and installs, and applies the settings; true when the project is set up
 * on the new application.
 */
export const startApplication = async (options: {
  /** The repository's root already has a package.json: the application goes in a directory. */
  readonly beside: boolean;
  readonly repoPath: string;
  /** The settings to keep what is not about the application; the defaults when none. */
  readonly settings?: Settings | null;
}): Promise<boolean> => {
  const dir = await promptDialog({
    confirmLabel: "Write and install",
    defaultValue: options.beside ? "app" : ".",
    description:
      "A Vite, React and Tailwind v4 application with a component for each of the editor's system components is written there (its theme from your Figma file, when one is imported), then installed with the repository's package manager. `.` is the repository's root.",
    title: "Start an application",
  });
  if (dir === null || dir.trim() === "") {
    return false;
  }
  const name = options.repoPath.split("/").filter(Boolean).at(-1) ?? "app";
  const id = toast.loading("Writing the application and installing it…");
  try {
    const made = await api().request("setup.scaffold", {
      dir: dir.trim(),
      install: true,
      name,
      repoPath: options.repoPath,
    });
    const base = options.settings ?? defaultSettings(options.repoPath);
    const problems = await save({ ...base, ...made.settings });
    if (problems.length > 0) {
      toast.error(problems.join(" "), { id });
      return false;
    }
    if (made.installed) {
      toast.success(
        `${made.created.length} files written and installed with ${made.packageManager}.`,
        { id }
      );
    } else {
      toast.warning(
        `${made.created.length} files written. Install them with \`${made.packageManager} install\` in ${dir.trim()}${made.installLog ? `:\n${made.installLog}` : "."}`,
        { duration: 20_000, id }
      );
    }
    return true;
  } catch (error) {
    toast.error(messageOf(error), { id });
    return false;
  }
};
