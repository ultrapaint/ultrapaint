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
import { screenPx } from "./camera.ts";

const VERBS: Record<AgentActivity["action"], string> = {
  editing: "editing",
  reading: "reading",
  running: "running",
  thinking: "thinking",
};

/** The agent working on one page, if one is: its thread's id, its name and what it is doing. */
const usePresenceOn = (pageId: string) => {
  const here = useAgentActivityOf((activity) =>
    activityOnPage(activity, pageId)
  );
  const threads = useAgents((s) => s.threads);
  if (!here) {
    return null;
  }
  const name = threads.find((t) => t.id === here.threadId)?.title ?? "Agent";
  return { action: here.action, name, threadId: here.threadId };
};

/** The outline of an agent working on one page, in the agents' colour over the frame's edge. */
export const FramePresence = ({ pageId }: { pageId: string }) =>
  usePresenceOn(pageId) ? (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ outline: `${screenPx(2)} solid var(--agent)` }}
    />
  ) : null;

/**
 * The label of an agent working on one page, in the frame's header at the right end, before the
 * breakpoint (ADR 0085): half the header's width at most.
 */
export const PresenceLabel = ({ pageId }: { pageId: string }) => {
  const here = usePresenceOn(pageId);
  if (!here) {
    return null;
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: a shortcut for the pointer; the strip under the canvas has the same menu.
    <div
      className="flex h-5 min-w-0 max-w-[50cqw] items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm bg-agent px-1.5 font-body-small-medium text-agent-foreground"
      onContextMenu={(e) =>
        openMenuAt(e, { kind: "thread", threadId: here.threadId })
      }
    >
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-agent-foreground motion-reduce:animate-none" />
      <span className="min-w-0 truncate">
        {here.name} · {VERBS[here.action]}
      </span>
    </div>
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
