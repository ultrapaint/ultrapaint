/**
 * What the agents are doing, under the canvas, in every workspace. The chat lives in one panel of
 * one workspace; supervising an agent should not mean keeping that panel open.
 *
 * It says what the agent is on, offers to follow it around the canvas, and stops the turn.
 */
import { Eye, EyeOff, MessageSquare, Square } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "../components/icon-button.tsx";
import type { AgentActivity } from "../lib/agent-activity.ts";
import { useAgentActivity } from "../state/agent-activity.ts";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

const VERBS: Record<AgentActivity["action"], string> = {
  editing: "Editing",
  reading: "Reading",
  running: "Running",
  thinking: "Thinking",
};

/** The file's page name when it is one of ours, else the path as the agent gave it. */
const useWhere = (activity: AgentActivity) => {
  const pages = useProject((s) => s.pages);
  const [place] = activity.places;
  if (!place) {
    return null;
  }
  const page = pages.find((p) => p.file === place.path);
  if (page) {
    return place.line === undefined ? page.name : `${page.name}:${place.line}`;
  }
  return place.path.split("/").at(-1) ?? place.path;
};

const openChat = (threadId: string) => {
  const editor = useEditor.getState();
  if (editor.workspace !== "vibe") {
    editor.setWorkspace("vibe");
  }
  editor.setLeftTab("chat");
  useAgents.getState().open(threadId).catch(reportError);
};

const Row = ({ activity }: { activity: AgentActivity }) => {
  const threads = useAgents((s) => s.threads);
  const following = useAgents((s) => s.following);
  const where = useWhere(activity);
  const thread = threads.find((t) => t.id === activity.threadId);
  // The page it is working on, else what it called the tool call, else the verb alone.
  const subject = where ?? activity.title;
  const isFollowed = following === activity.threadId;

  const toggleFollow = () =>
    useAgents.getState().setFollowing(isFollowed ? null : activity.threadId);

  const stop = () => {
    api()
      .request("threads.cancel", { threadId: activity.threadId })
      .then(() => toast.success("Asked the agent to stop"))
      .catch(reportError);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the pill's buttons raise the menu from the keyboard, and it bubbles here.
    <div
      className="pointer-events-auto flex h-7 items-center gap-1 rounded-full border bg-sidebar pr-1 pl-2.5 text-sidebar-foreground text-xs shadow-black/30 shadow-lg"
      onContextMenu={(e) =>
        openMenuAt(e, { kind: "thread", threadId: activity.threadId })
      }
    >
      <span
        className="size-1.5 shrink-0 animate-pulse rounded-full"
        style={{ backgroundColor: activity.color }}
      />
      <button
        className="max-w-72 truncate outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => openChat(activity.threadId)}
        title={`${thread?.title ?? "Agent"}: ${activity.title ?? "working"}`}
        type="button"
      >
        <span className="text-muted-foreground">{VERBS[activity.action]}</span>
        {subject ? ` ${subject}` : ""}
      </button>
      <IconButton
        onClick={toggleFollow}
        tooltip={isFollowed ? "Stop following" : "Follow on the canvas"}
      >
        {isFollowed ? <Eye /> : <EyeOff />}
      </IconButton>
      <IconButton
        onClick={() => openChat(activity.threadId)}
        tooltip="Open the chat"
      >
        <MessageSquare />
      </IconButton>
      <IconButton onClick={stop} tooltip="Stop the turn">
        <Square />
      </IconButton>
    </div>
  );
};

export const AgentActivityStrip = () => {
  const activity = useAgentActivity();
  if (activity.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col items-center gap-1">
      {activity.map((a) => (
        <Row activity={a} key={a.threadId} />
      ))}
    </div>
  );
};
