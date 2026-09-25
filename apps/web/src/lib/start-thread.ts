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

const LAST_AGENT_KEY = "ultrapaint:agent";

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

/** The agent a new thread starts with: the one used last, else the first there is. */
export const defaultAgentId = async (): Promise<string | null> => {
  if (useAgents.getState().agents.length === 0) {
    await useAgents.getState().load();
  }
  const { agents } = useAgents.getState();
  const last = localStorage.getItem(LAST_AGENT_KEY);
  return agents.find((a) => a.id === last)?.id ?? agents[0]?.id ?? null;
};

/** Creates a thread with the agent, its composer holding `draft`, and opens it. */
export const createThread = async (agentId: string, draft = "") => {
  try {
    localStorage.setItem(LAST_AGENT_KEY, agentId);
    const t = await api().request("threads.create", { agentId });
    if (draft) {
      useDrafts.setState((s) => ({ drafts: { ...s.drafts, [t.id]: draft } }));
    }
    await useAgents.getState().open(t.id);
    return t;
  } catch (error) {
    reportError(error);
    return null;
  }
};

/** Opens the chat on a new thread with the default agent and `text` in its composer. */
export const startCommand = async (text: string) => {
  const agentId = await defaultAgentId();
  if (!agentId) {
    reportError(new Error("No agent is available to start a thread with"));
    return;
  }
  const editor = useEditor.getState();
  if (editor.workspace !== "vibe") {
    editor.setWorkspace("vibe");
  }
  editor.setLeftTab("chat");
  await createThread(agentId, text.endsWith(" ") ? text : `${text} `);
};
