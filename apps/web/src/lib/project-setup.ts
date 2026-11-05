/**
 * A folder opened for the first time is set up in a chat (ADR 0062): an agent checks what
 * detection found against the code and saves it (`/setup`). The chat is an ordinary one, kept in
 * the Agents list; it is found again by its title. With no folder open at all, there is nothing
 * to set up: the folder is chosen in the settings.
 */
import { commandOf } from "@ultrapaint/contracts/tasks";
import { api } from "../state/connection.ts";
import { showLeftPanel } from "../state/panels.ts";
import { reportError, useProject } from "../state/project.ts";

/** The setup chat's title, which finds it again. */
export const setupTitle = (name: string) => `Set up ${name}`;

/** The settings' Repository section, where the folder is chosen. */
export const chooseFolder = () =>
  useProject.getState().openSettings(true, "repository");

/**
 * Opens the folder's setup chat, started with `/setup` when it has none yet. Unless `show`, it
 * runs behind whatever is open, a dot on the Agents icon.
 */
export const startSetup = async ({ show = true } = {}) => {
  const { info } = useProject.getState();
  if (!info.configured) {
    chooseFolder();
    return;
  }
  try {
    const title = setupTitle(info.name ?? "this folder");
    const existing = (await api().request("threads.list", undefined)).find(
      (t) => t.title === title
    );
    if (existing) {
      if (show) {
        await showLeftPanel({ chat: existing });
      }
      return;
    }
    const thread = await api().request("threads.create", { title });
    if (show) {
      await showLeftPanel({ chat: thread, draft: "" });
    }
    await api().request("threads.prompt", {
      attachments: [],
      text: commandOf({ _tag: "Setup" }),
      threadId: thread.id,
    });
  } catch (error) {
    reportError(error);
  }
};

/**
 * A folder whose settings were detected and never saved is set up as it opens. Behind a first
 * prompt from the start screen, which takes the chat.
 */
export const setUpOnOpen = async ({ behind = false } = {}) => {
  const { info } = useProject.getState();
  if (info.configured && info.setup === "detected") {
    await startSetup({ show: !behind });
  }
};
