/**
 * The start screen's prompt (ADR 0062), sent in the project's first chat once it opens. The
 * desktop app keeps it, with its pictures and text files, for the project it opens, and gives it
 * once (`projects.takeFirstPrompt`), so a reload sends nothing again.
 */
import type { FirstPrompt } from "@ultrapaint/contracts/shell-bridge";
import {
  isModelOption,
  type PromptAttachment,
} from "@ultrapaint/contracts/threads";
import { platform } from "../platform.ts";
import { api } from "../state/connection.ts";
import { showLeftPanel } from "../state/panels.ts";
import { reportError } from "../state/project.ts";

/** The prompt the shell kept for this project, taken: none in a browser, or once it was taken. */
const takeFirstPrompt = async (): Promise<FirstPrompt | null> => {
  try {
    return (await platform().projects?.takeFirstPrompt()) ?? null;
  } catch (error) {
    reportError(error);
    return null;
  }
};

/**
 * Sends a prompt in a new chat with the agent and model it names (the agent's own when it has no
 * such model), opened in the left panel, with what it carries: what was attached on the start
 * screen, then the look page's pictures.
 */
export const sendPrompt = async (
  start: FirstPrompt,
  attachments: readonly PromptAttachment[] = []
) => {
  try {
    const thread = await api().request("threads.create", {
      ...(start.agentId && { agentId: start.agentId }),
    });
    const model = thread.configOptions?.find(isModelOption);
    if (
      start.model !== undefined &&
      model !== undefined &&
      model.currentValue !== start.model &&
      model.options.some((choice) => choice.value === start.model)
    ) {
      await api().request("threads.setConfigOption", {
        optionId: model.id,
        threadId: thread.id,
        value: start.model,
      });
    }
    await showLeftPanel({ chat: thread, draft: "" });
    await api().request("threads.prompt", {
      attachments: [...(start.attachments ?? []), ...attachments],
      text: start.prompt,
      threadId: thread.id,
    });
  } catch (error) {
    reportError(error);
  }
};

/**
 * The start screen's prompt, if the editor was opened with one. A person who picks the look
 * picks it on the look page first (`openLook`), which sends the prompt once it is chosen.
 */
export const sendFirstPrompt = async (
  openLook: (pending: FirstPrompt) => void = () => undefined
) => {
  const start = await takeFirstPrompt();
  if (!start) {
    return;
  }
  if (start.look === "pick") {
    openLook(start);
    return;
  }
  await sendPrompt(start);
};
