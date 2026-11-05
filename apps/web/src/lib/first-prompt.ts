/**
 * The start screen's prompt (ADR 0062), sent in the project's first chat once it opens. The
 * desktop app opens the project with it on the editor's address (`first-prompt`), and with
 * `new-design` when it has just written the project; both are taken off it, so a reload sends
 * nothing again.
 */
import {
  FIRST_PROMPT_PARAM,
  FirstPrompt,
} from "@ultrapaint/contracts/shell-bridge";
import { isModelOption } from "@ultrapaint/contracts/threads";
import { Option, Schema } from "effect";
import { api } from "../state/connection.ts";
import { showLeftPanel } from "../state/panels.ts";
import { reportError } from "../state/project.ts";

/** What the desktop app adds for a project it has just written. */
const NEW_DESIGN_PARAM = "new-design";

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(FirstPrompt));

/** The prompt the editor was opened with, taken off the address with the new design's mark. */
export const takeFirstPrompt = (): FirstPrompt | null => {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get(FIRST_PROMPT_PARAM);
  if (raw === null && !url.searchParams.has(NEW_DESIGN_PARAM)) {
    return null;
  }
  url.searchParams.delete(FIRST_PROMPT_PARAM);
  url.searchParams.delete(NEW_DESIGN_PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  return raw === null ? null : Option.getOrNull(decode(raw));
};

/**
 * What is sent. A person who picks the look is asked for it before the agent draws: the look
 * page that will show it (PLAN-onboarding, slice 4) is not there yet.
 */
export const promptText = (start: FirstPrompt) =>
  start.look === "pick"
    ? `${start.prompt}\n\nI'll pick the look myself: ask me how it should look and feel before you draw.`
    : start.prompt;

/**
 * Sends the start screen's prompt, if the editor was opened with one: a new chat with the agent
 * and model it names (the agent's own when it has no such model), opened in the left panel.
 */
export const sendFirstPrompt = async () => {
  const start = takeFirstPrompt();
  if (!start) {
    return;
  }
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
      attachments: [],
      text: promptText(start),
      threadId: thread.id,
    });
  } catch (error) {
    reportError(error);
  }
};
