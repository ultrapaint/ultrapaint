/**
 * Starting a thread with a prompt already written: `/init` from the Design system panel or the
 * settings, `/implement` from a page. The thread opens in the chat with the prompt in its
 * composer, unsent, so the user can add to it — or pick another agent — before sending.
 */
import { create } from "zustand";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError } from "../state/project.ts";

/**
 * Prompt text carried into a thread's composer. A store, not a map read once: the thread's
 * composer can be on screen before the draft is known (the server announces the thread before
 * it answers the request that created it), and then takes the draft when it arrives.
 */
export const useDrafts = create<{ drafts: Record<string, string> }>(() => ({
  drafts: {},
}));

export const takeDraft = (threadId: string) => {
  const draft = useDrafts.getState().drafts[threadId] ?? "";
  if (draft) {
    useDrafts.setState((s) => {
      const { [threadId]: _taken, ...rest } = s.drafts;
      return { drafts: rest };
    });
  }
  return draft;
};

/** A draft that asks for the application's code; `--adopt` only links pages to code built already. */
const IMPLEMENT_RE = /^\/implement(?!\s+--adopt(?:\s|$))(\s|$)/;

/**
 * Creates a thread and opens it, its composer holding `draft`. Without an agent the server picks
 * the chat's default. Nothing waits on an agent: it starts with the thread's first prompt.
 */
export const createThread = async (draft = "", agentId?: string) => {
  try {
    // A thread that starts by implementing may write the application (ADR 0030).
    const implementing = IMPLEMENT_RE.test(draft.trim());
    const t = await api().request("threads.create", {
      ...(agentId && { agentId }),
      ...(implementing && { purpose: "implement" as const }),
    });
    if (draft) {
      useDrafts.setState((s) => ({ drafts: { ...s.drafts, [t.id]: draft } }));
    }
    useAgents.getState().show(t);
    return t;
  } catch (error) {
    reportError(error);
    return null;
  }
};

/**
 * Opens the chat on a new thread with `text` in its composer. Every workspace has the chat on its
 * rail, so the workspace stays the one the command was started from.
 */
export const startCommand = async (text: string) => {
  useEditor.getState().setLeftTab("chat");
  await createThread(text.endsWith(" ") ? text : `${text} `);
};

/** Opens a thread with `/init` in its composer, for the user to send. */
export const startInit = () => startCommand("/init");
