/**
 * The selection's name on its top-left edge, in Vibe: in its colour, the same size at every zoom.
 * Its menu walks up to the parents and down to the children, which is how a nested element is
 * reached without the layers. When the element is in a chat, the tag says so.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { childrenOf, nodeLabel } from "@ultrapaint/design-document/tree";
import { ChevronDown, CornerLeftUp, Link2, MessageSquare } from "lucide-react";
import { useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NodeIcon } from "../components/node-icon.tsx";
import { chatLinkOf } from "../lib/chat-link.ts";
import { describeLink } from "../lib/links.ts";
import { useAgents } from "../state/agents.ts";
import { fileOfFrame, useAttachments } from "../state/attachments.ts";
import { pathIn, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";

/** How the selected node is in a chat, if it is: attached to the open thread, or what one was started on. */
export const useChatLink = () => {
  const selection = useEditor((s) => s.selection);
  const threads = useAgents((s) => s.threads);
  const current = useAgents((s) => s.current);
  const byThread = useAttachments((s) => s.byThread);
  return selection
    ? chatLinkOf(
        threads,
        byThread,
        current,
        selection,
        fileOfFrame(selection.frame)
      )
    : null;
};

export const SelectionTag = ({
  color,
  inside = false,
  inv,
  node,
}: {
  color: string;
  /** No room above the element in its frame: the tag goes inside its top-left corner. */
  inside?: boolean;
  inv: number;
  node: DesignNode;
}) => {
  const selection = useEditor((s) => s.selection);
  const canvas = useEditor((s) => s.canvas);
  const docs = useDocuments((s) => s.docs);
  // Subscribed to so the label follows a page renamed or removed.
  const pages = useProject((s) => s.pages);
  const linked = node.link
    ? describeLink(
        pages.filter((p) => p.canvas === canvas),
        node.link
      )
    : null;
  const path = useMemo(
    () =>
      selection
        ? pathIn(docs, canvas, selection.frame, selection.nodeId)
        : null,
    [docs, canvas, selection]
  );
  const thread = useChatLink()?.thread ?? null;
  const parents = (path ?? []).slice(0, -1).reverse();
  const children = childrenOf(node);
  const select = (target: DesignNode) => {
    if (selection) {
      useEditor
        .getState()
        .select({ frame: selection.frame, nodeId: target.id });
    }
  };
  return (
    <div
      className="pointer-events-auto absolute left-0 flex items-center"
      style={
        inside
          ? {
              top: 0,
              transform: `scale(${inv})`,
              transformOrigin: "top left",
            }
          : {
              bottom: "100%",
              transform: `translate(${-1 * inv}px, ${-1 * inv}px) scale(${inv})`,
              transformOrigin: "bottom left",
            }
      }
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              className="flex h-5 max-w-64 items-center gap-1 rounded-t-[5px] px-1.5 font-body font-semibold text-white leading-4 outline-none"
              style={{ background: color }}
              type="button"
            />
          }
        >
          <NodeIcon className="size-3 shrink-0" node={node} />
          <span className="truncate">{nodeLabel(node)}</span>
          {linked ? (
            <span
              className="flex min-w-0 items-center gap-1 border-white/40 border-l pl-1 font-normal text-white/90"
              title={
                linked.broken
                  ? "Leads to a page that is not there"
                  : "Where it leads in the prototype"
              }
            >
              <Link2 className="size-2.5 shrink-0" />
              <span
                className={linked.broken ? "truncate line-through" : "truncate"}
              >
                {linked.label}
              </span>
            </span>
          ) : null}
          {thread ? (
            <span className="flex shrink-0 items-center gap-1 border-white/40 border-l pl-1 font-normal text-white/90">
              <MessageSquare className="size-2.5" />
              In chat
            </span>
          ) : null}
          <ChevronDown className="size-2.5 shrink-0 opacity-80" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {parents.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Inside</DropdownMenuLabel>
              {parents.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => select(p)}>
                  <CornerLeftUp />
                  <span className="truncate">{nodeLabel(p)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
          {parents.length > 0 && children.length > 0 ? (
            <DropdownMenuSeparator />
          ) : null}
          {children.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Holds</DropdownMenuLabel>
              {children.map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => select(c)}>
                  <NodeIcon node={c} />
                  <span className="truncate">{nodeLabel(c)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
          {thread ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => showLeftPanel({ chat: thread.id })}
              >
                <MessageSquare />
                <span className="truncate">Open “{thread.title}”</span>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
