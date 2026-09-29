/**
 * The selection's name on its top-left edge, in Vibe: in its colour, the same size at every zoom.
 * Its menu walks up to the parents and down to the children, which is how a nested element is
 * reached without the layers. When the element is in a chat, the tag says so.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { childrenOf, nodeLabel } from "@ultrapaint/design-document/tree";
import { ChevronDown, CornerLeftUp, MessageSquare } from "lucide-react";
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
import { threadOfNode } from "../lib/add-to-chat.ts";
import { useAgents } from "../state/agents.ts";
import { fileOfFrame, useAttachments } from "../state/attachments.ts";
import { pathIn, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";

/** The thread this node is in, if any: attached to the open one, or what one was started on. */
export const useThreadOfSelection = () => {
  const selection = useEditor((s) => s.selection);
  const threads = useAgents((s) => s.threads);
  const current = useAgents((s) => s.current);
  const byThread = useAttachments((s) => s.byThread);
  return selection
    ? threadOfNode(
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
  const space = useEditor((s) => s.space);
  const docs = useDocuments((s) => s.docs);
  const path = useMemo(
    () =>
      selection ? pathIn(docs, space, selection.frame, selection.nodeId) : null,
    [docs, space, selection]
  );
  const thread = useThreadOfSelection();
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
              className="flex h-5 max-w-64 items-center gap-1 rounded-t-[5px] px-1.5 font-semibold text-[11px] text-white outline-none"
              style={{ background: color }}
              type="button"
            />
          }
        >
          <NodeIcon className="size-3 shrink-0" node={node} />
          <span className="truncate">{nodeLabel(node)}</span>
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
                onClick={() => {
                  useEditor.getState().setLeftTab("chat");
                  useAgents.getState().open(thread.id);
                }}
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
