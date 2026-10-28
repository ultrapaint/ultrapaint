/**
 * An agent's work, on the elements it changes: pink, whichever agent it is, with a light passing
 * through while it works, and its name and what it is doing on the edge of the first of them.
 * The text and pictures it announced and has not changed yet are skeletons, drawn by the preview.
 * This is where an agent's work shows; nothing about it sits at the bottom of the canvas.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  canvasDocOf,
  findNode,
  findPath,
} from "@ultrapaint/design-document/tree";
import { Check } from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { AgentIcon } from "../components/agent-icon.tsx";
import { type AgentWork, useAgents } from "../state/agents.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { isNodeFrame, rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { screenPx, UNZOOM } from "./camera.ts";
import { frameOf } from "./editor-frame.ts";

/** Enough outlines to see where the work is; past that they only add noise. */
const MAX_OUTLINES = 12;

interface FrameWork {
  /** Outermost changed nodes only: a row and the cells inside it are one piece of work. */
  readonly nodeIds: readonly string[];
  readonly threadId: string;
  readonly work: AgentWork;
}

const outermost = (
  ids: readonly string[],
  pathOf: (id: string) => DesignNode[] | null
) => {
  const set = new Set(ids);
  return ids.filter((id) =>
    (pathOf(id) ?? []).slice(0, -1).every((ancestor) => !set.has(ancestor.id))
  );
};

/** The work of each agent on this frame's document, by thread; the same entries until one changes. */
const useWorkOn = (frameId: string, canvas: string | null) =>
  useAgents(
    useShallow((s) => {
      const canvasDoc = canvas === null ? null : canvasDocOf(canvas);
      const here: Record<string, AgentWork> = {};
      for (const [threadId, work] of Object.entries(s.working)) {
        if (
          work.doc === frameId ||
          (isNodeFrame(frameId) && work.doc === canvasDoc)
        ) {
          here[threadId] = work;
        }
      }
      return here;
    })
  );

/** The agents' work on this frame, and the ids the preview has to measure or skeleton. */
export const useFrameWork = (frameId: string) => {
  const canvas = useEditor((s) => s.canvas);
  const working = useWorkOn(frameId, canvas);
  // Only what this frame draws: an edit to another page changes nothing here.
  const root = useDocuments((s) => rootOfFrame(s.docs, canvas, frameId));
  return useMemo(() => {
    const pieces: FrameWork[] = [];
    const skeletons: string[] = [];
    for (const [threadId, work] of Object.entries(working)) {
      const here = (id: string) => findNode(root, id);
      const ids = work.nodeIds.filter((id) => here(id));
      const pathOf = (id: string) => findPath(root, id);
      pieces.push({
        nodeIds: outermost(ids, pathOf).slice(0, MAX_OUTLINES),
        threadId,
        work,
      });
      for (const id of work.intent) {
        const node = here(id);
        if (node?.type === "text" || node?.type === "image") {
          skeletons.push(id);
        }
      }
    }
    return { pieces, skeletons };
  }, [working, root]);
};

/** Tells the preview which nodes are skeletons now; none once the work is done. */
export const useSkeletons = (frameId: string, skeletons: readonly string[]) => {
  const key = skeletons.join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the list.
  useEffect(() => {
    frameOf(frameId).skeleton(skeletons);
  }, [frameId, key]);
};

const Tag = ({ threadId, work }: { threadId: string; work: AgentWork }) => {
  const thread = useAgents((s) => s.threads.find((t) => t.id === threadId));
  const agent = useAgents((s) =>
    s.agents.find((a) => a.id === thread?.agentId)
  );
  let detail: ReactNode = null;
  if (work.done) {
    detail = (
      <span className="flex items-center gap-0.5 font-normal opacity-90">
        <Check className="size-3" />
        Changed
      </span>
    );
  } else if (work.action) {
    detail = (
      <span className="truncate font-normal opacity-85">· {work.action}</span>
    );
  }
  return (
    <button
      className="pointer-events-auto absolute left-0 flex h-5 max-w-72 cursor-pointer items-center gap-1 whitespace-nowrap rounded-t-[5px] bg-agent px-1.5 font-body font-semibold text-agent-foreground leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => {
        useEditor.getState().setLeftTab("chat");
        useAgents.getState().open(threadId);
      }}
      onContextMenu={(e) => openMenuAt(e, { kind: "thread", threadId })}
      style={{
        bottom: "100%",
        transform: `translate(${screenPx(-1)}, ${screenPx(-1)}) ${UNZOOM}`,
        transformOrigin: "bottom left",
      }}
      title={thread?.title}
      type="button"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-white">
        <AgentIcon agentId={thread?.agentId ?? ""} className="size-2.5" />
      </span>
      <span className="truncate">{agent?.name ?? "Agent"}</span>
      {detail}
    </button>
  );
};

export const AgentWorkOverlay = ({
  frameId,
  pieces,
}: {
  frameId: string;
  pieces: readonly FrameWork[];
}) => {
  const rects = useEditor((s) => s.rects[frameId]);
  return (
    <>
      {pieces.map(({ nodeIds, threadId, work }) =>
        nodeIds.map((id, i) => {
          const rect = rects?.[id];
          if (!rect) {
            return null;
          }
          return (
            <div
              className="pointer-events-none absolute"
              key={`${threadId}:${id}`}
              style={{
                height: rect.height,
                left: rect.x,
                outline: `${screenPx(2)} solid var(--agent)`,
                outlineOffset: screenPx(-1),
                top: rect.y,
                width: rect.width,
              }}
            >
              <div
                className={
                  work.done
                    ? "absolute inset-0 bg-agent/10 transition-opacity"
                    : "absolute inset-0 animate-agent-sweep bg-[linear-gradient(100deg,color-mix(in_srgb,var(--agent)_10%,transparent)_20%,color-mix(in_srgb,var(--agent)_28%,transparent)_45%,color-mix(in_srgb,var(--agent)_10%,transparent)_70%)] bg-size-[250%_100%]"
                }
              />
              {i === 0 ? <Tag threadId={threadId} work={work} /> : null}
            </div>
          );
        })
      )}
    </>
  );
};
