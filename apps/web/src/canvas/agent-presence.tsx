/**
 * Where an agent is working, on the canvas itself: the frame it is reading or editing is outlined
 * in that agent's colour and says what it is doing. Nothing here moves the canvas — following is
 * asked for, in the strip under it.
 */
import { useEffect, useRef } from "react";
import { type AgentActivity, activityOnPage } from "../lib/agent-activity.ts";
import { viewportSize } from "../lib/shortcuts.ts";
import { useAgentActivityOf } from "../state/agent-activity.ts";
import { useAgents } from "../state/agents.ts";
import { zoomToSelection } from "../state/camera.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useEditor } from "../state/editor.ts";
import { goTo } from "../state/location.ts";
import { reportError, useProject } from "../state/project.ts";
import { screenPx, UNZOOM } from "./camera.ts";

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
export const FramePresence = ({ pageId }: { pageId: string }) => {
  const here = useAgentActivityOf((activity) =>
    activityOnPage(activity, pageId)
  );
  const threads = useAgents((s) => s.threads);
  if (!here) {
    return null;
  }
  const name = threads.find((t) => t.id === here.threadId)?.title ?? "Agent";
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ outline: `${screenPx(2)} solid ${here.color}` }}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: a shortcut for the pointer; the strip under the canvas has the same menu. */}
      <div
        className="absolute right-0 flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 font-body font-medium text-white"
        onContextMenu={(e) =>
          openMenuAt(e, { kind: "thread", threadId: here.threadId })
        }
        style={{
          backgroundColor: here.color,
          bottom: `calc(100% + ${screenPx(6)})`,
          transform: UNZOOM,
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
  // Only the page the followed agent is on: the canvas this runs in is not drawn again for
  // each word an agent writes.
  const target = useAgentActivityOf(
    (activity) =>
      activity.find((a) => a.threadId === following)?.pageIds[0] ?? null
  );
  const pages = useProject((s) => s.pages);
  const lastPage = useRef<string | null>(null);

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
    if (editor.canvas !== page.canvas) {
      goTo({
        canvas: page.canvas,
        page: page.id,
        route: page.route ?? null,
      }).catch(reportError);
      return;
    }
    if (editor.workspace === "prototype") {
      goTo({ page: page.id });
      return;
    }
    editor.selectPage(page.id);
    zoomToSelection(viewportSize());
  }, [target, pages]);

  useEffect(() => {
    if (!following) {
      lastPage.current = null;
    }
  }, [following]);
};
