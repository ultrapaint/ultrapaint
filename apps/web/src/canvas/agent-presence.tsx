/**
 * Where an agent is working, on the canvas itself: the frame it is reading or editing is outlined
 * in that agent's colour and says what it is doing. Nothing here moves the canvas — following is
 * asked for, in the strip under it.
 */
import { useEffect, useRef } from "react";
import { type AgentActivity, activityOnPage } from "../lib/agent-activity.ts";
import { reveal } from "../lib/reveal.ts";
import { useAgentActivityOf } from "../state/agent-activity.ts";
import { useAgents } from "../state/agents.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useProject } from "../state/project.ts";
import { onScreen, screenPx, UNZOOM } from "./camera.ts";

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
  pageId,
  width,
}: {
  pageId: string;
  /** The page's width on the canvas: the label is no wider than the page on screen. */
  width: number;
}) => {
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
        style={{ outline: `${screenPx(2)} solid var(--agent)` }}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: a shortcut for the pointer; the strip under the canvas has the same menu. */}
      <div
        className="absolute right-0 flex h-5 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm bg-agent px-1.5 font-body-small-medium text-agent-foreground"
        onContextMenu={(e) =>
          openMenuAt(e, { kind: "thread", threadId: here.threadId })
        }
        style={{
          // On the header's line, beside the page's name: half the page's width at most.
          bottom: `calc(100% + ${screenPx(6)})`,
          maxWidth: onScreen(width / 2),
          transform: UNZOOM,
          transformOrigin: "bottom right",
        }}
      >
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-agent-foreground motion-reduce:animate-none" />
        <span className="min-w-0 truncate">
          {name} · {VERBS[here.action]}
        </span>
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
    if (pages.some((p) => p.id === target)) {
      reveal({ page: target });
    }
  }, [target, pages]);

  useEffect(() => {
    if (!following) {
      lastPage.current = null;
    }
  }, [following]);
};
