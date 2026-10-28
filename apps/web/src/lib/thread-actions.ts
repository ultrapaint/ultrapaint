/**
 * What is done to an agent thread from outside the chat: the strip under the canvas, an agent's
 * badge on a frame, the chat's thread picker and the context menu.
 */
import { toast } from "sonner";
import { confirmDialog } from "../components/dialogs.tsx";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { showLeftPanel } from "../state/panels.ts";
import { reportError } from "../state/project.ts";

/** Every workspace has the chat on its rail; the thread opens there. */
export const openChat = (threadId: string) => showLeftPanel({ chat: threadId });

export const stopThread = (threadId: string) =>
  api()
    .request("threads.cancel", { threadId })
    .then(() => toast.success("Asked the agent to stop"))
    .catch(reportError);

export const toggleFollowing = (threadId: string) => {
  const { following, setFollowing } = useAgents.getState();
  setFollowing(following === threadId ? null : threadId);
};

export const deleteThread = async (threadId: string) => {
  const thread = useAgents.getState().threads.find((t) => t.id === threadId);
  if (!thread) {
    return;
  }
  const ok = await confirmDialog({
    confirmLabel: "Delete",
    description: `“${thread.title}” and its history are removed.`,
    destructive: true,
    title: "Delete this thread?",
  });
  if (ok) {
    api().request("threads.delete", { threadId }).catch(reportError);
  }
};
