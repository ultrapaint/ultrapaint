/**
 * Starting a thread with a prompt already written: a task (`/init` from the Design system panel
 * or the settings, `/implement` from a page), or a prompt to finish. The thread opens in the chat
 * with the prompt in its composer, unsent, so the user can add to it — or pick another agent —
 * before sending. A task is written as the slash command the server reads back as it.
 */
import {
  commandOf,
  type TaskRequest,
  taskPurpose,
} from "@ultrapaint/contracts/tasks";
import type { ThreadPurpose } from "@ultrapaint/contracts/threads";
import { api } from "../state/connection.ts";
import { showLeftPanel } from "../state/panels.ts";
import { reportError } from "../state/project.ts";

/**
 * Creates a thread and opens it, its composer holding `draft`. Without an agent the server picks
 * the chat's default. Nothing waits on an agent: it starts with the thread's first prompt.
 */
export const createThread = async (
  draft = "",
  options: { readonly agentId?: string; readonly purpose?: ThreadPurpose } = {}
) => {
  const { agentId, purpose } = options;
  try {
    const t = await api().request("threads.create", {
      ...(agentId && { agentId }),
      // A thread that starts by implementing may write the application (ADR 0030).
      ...(purpose === "implement" && { purpose }),
    });
    await showLeftPanel({ chat: t, draft });
    return t;
  } catch (error) {
    reportError(error);
    return null;
  }
};

/**
 * Opens the chat on a new thread with `text` in its composer, a thread for `purpose` (one that
 * designs when not given). The chat is the canvas's: from the prototype, the canvas comes back.
 */
export const startPrompt = async (text: string, purpose?: ThreadPurpose) => {
  showLeftPanel("chat");
  await createThread(text.endsWith(" ") ? text : `${text} `, {
    ...(purpose && { purpose }),
  });
};

/** Opens a thread with a task's command in its composer, for the user to add to and send. */
export const startTask = (request: TaskRequest) =>
  startPrompt(commandOf(request), taskPurpose(request));

/** Opens a thread with `/init` in its composer, for the user to send. */
export const startInit = () => startTask({ _tag: "Init" });

/**
 * Runs a task at once in a new chat named `title`, opened in the left panel: what the editor
 * starts for the person rather than drafts for them, as making the design system from the code
 * (ADR 0062). The chat stays in the Agents list to read back and continue.
 */
export const runTask = async (request: TaskRequest, title: string) => {
  try {
    const purpose = taskPurpose(request);
    const thread = await api().request("threads.create", {
      ...(purpose === "implement" && { purpose }),
      title,
    });
    await showLeftPanel({ chat: thread, draft: "" });
    await api().request("threads.prompt", {
      attachments: [],
      text: commandOf(request),
      threadId: thread.id,
    });
  } catch (error) {
    reportError(error);
  }
};

/** The design system made from the application's code, in a chat of its own. */
export const makeSystemFromCode = () =>
  runTask({ _tag: "Init" }, "Design system from the code");

/** A new look for the project, described to an agent in a chat the person finishes and sends. */
export const startNewLook = () =>
  startPrompt(
    "Make a new look for this project: ask me how it should feel, then write its design system."
  );
