/**
 * Where an agent is working, on the canvas itself: the frame it is reading or editing is outlined
 * in that agent's colour and says what it is doing. Nothing here moves the canvas — following is
 * asked for, in the strip under it.
 */
import { useEffect, useRef } from "react";
import { type AgentActivity, activityOnPage } from "../lib/agent-activity.ts";
import { viewportSize } from "../lib/shortcuts.ts";
import { useAgentActivity } from "../state/agent-activity.ts";
import { useAgents } from "../state/agents.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

const VERBS: Record<AgentActivity["action"], string> = {
  editing: "editing",
  reading: "reading",
  running: "running",
  thinking: "thinking",
};

/**
 * The outline and label of an agent working on one page. Drawn inside the frame's own chrome, at
 * a constant size whatever the zoom, the way the page's name is.
 */
export const FramePresence = ({
  inv,
  pageId,
}: {
  inv: number;
  pageId: string;
}) => {
  const activity = useAgentActivity();
  const here = activityOnPage(activity, pageId);
  const threads = useAgents((s) => s.threads);
  if (!here) {
    return null;
  }
  const name = threads.find((t) => t.id === here.threadId)?.title ?? "Agent";
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ outline: `${2 * inv}px solid ${here.color}` }}
      />
      <div
        className="absolute right-0 flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 font-medium text-[11px] text-white"
        style={{
          backgroundColor: here.color,
          bottom: `calc(100% + ${6 * inv}px)`,
          transform: `scale(${inv})`,
          transformOrigin: "bottom right",
        }}
      >
        <span className="size-1.5 animate-pulse rounded-full bg-white/90" />
        {name} · {VERBS[here.action]}
      </div>
    </>
  );
};

/**
 * Moves the canvas to what the followed agent is working on. Off unless asked for, and it steps
 * aside as soon as the user takes the canvas somewhere themselves.
 */
export const useFollowAgent = () => {
  const following = useAgents((s) => s.following);
  const activity = useAgentActivity();
  const pages = useProject((s) => s.pages);
  const followed = activity.find((a) => a.threadId === following);
  const lastPage = useRef<string | null>(null);

  const target = followed?.pageIds[0] ?? null;
  useEffect(() => {
    if (!target || target === lastPage.current) {
      return;
    }
    lastPage.current = target;
    const editor = useEditor.getState();
    const page = pages.find((p) => p.id === target);
    if (!page) {
      return;
    }
    if (editor.space !== page.space) {
      editor.openSpace(page.space, page.route).catch(reportError);
      return;
    }
    if (editor.workspace === "prototype") {
      editor.navigate(page.route);
      return;
    }
    editor.selectPage(page.id);
    editor.zoomToSelection(viewportSize());
  }, [target, pages]);

  useEffect(() => {
    if (!following) {
      lastPage.current = null;
    }
  }, [following]);
};
