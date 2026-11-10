/**
 * The selection's name on its top-left edge, in its colour, the same size at every zoom, with the
 * agent's button beside it: all that hangs off the selection on the canvas, never wider than the
 * element, the icon alone on a small one (ADR 0058). Its controls are in the bar above the tools.
 * The name's menu walks up to the parents and down to the children, which is how a nested element
 * is reached without the layers. When the element is in a chat, the tag says so.
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NodeIcon } from "../components/node-icon.tsx";
import { describeLink } from "../lib/links.ts";
import { pathIn, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { select } from "../state/selection.ts";
import { ChatButton, useChatLink } from "./element-toolbar-chat.tsx";

/** The tag's height on screen, which the element needs above it in its frame to sit over it. */
export const TAG_HEIGHT = 20;
/** The narrowest the tag gets: the element's icon and the agent's button. */
const TAG_MIN_WIDTH = 46;
/** Under this width on screen the element's name and what follows it go, its icon stays. */
const TAG_NAMED_WIDTH = 96;

/** What follows the icon on a tag with room for it: the name, where it leads, that it is in a chat. */
const TagName = ({ inChat, node }: { inChat: boolean; node: DesignNode }) => {
  const canvas = useEditor((s) => s.canvas);
  // Subscribed to so the label follows a page renamed or removed.
  const pages = useProject((s) => s.pages);
  const linked = node.link
    ? describeLink(
        pages.filter((p) => p.canvas === canvas),
        node.link
      )
    : null;
  return (
    <>
      <span className="truncate">{nodeLabel(node)}</span>
      {linked ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex min-w-0 items-center gap-1 border-white/35 border-l pl-1 text-white/85" />
            }
          >
            <Link2 className="size-2.5 shrink-0" />
            <span
              className={linked.broken ? "truncate line-through" : "truncate"}
            >
              {linked.label}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {linked.broken
              ? "Leads to a page that is not there"
              : "Where it leads in the prototype"}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {inChat ? (
        <span className="flex shrink-0 items-center gap-1 border-white/35 border-l pl-1 text-white/85">
          <MessageSquare className="size-2.5" />
          In chat
        </span>
      ) : null}
      <ChevronDown className="size-2.5 shrink-0 opacity-80" />
    </>
  );
};

export const SelectionTag = ({
  color,
  inside = false,
  inv,
  node,
  width,
}: {
  color: string;
  /** No room above the element in its frame: the tag goes inside its top-left corner. */
  inside?: boolean;
  inv: number;
  node: DesignNode;
  /** The element's width on screen, which the tag keeps within. */
  width: number;
}) => {
  const selection = useEditor((s) => s.selection);
  const canvas = useEditor((s) => s.canvas);
  const docs = useDocuments((s) => s.docs);
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
  const selectNode = (target: DesignNode) => {
    if (selection) {
      select({ frame: selection.frame, nodeId: target.id });
    }
  };
  const named = width >= TAG_NAMED_WIDTH;
  return (
    <div
      className="pointer-events-auto absolute left-0 flex items-end gap-0.5"
      style={{
        maxWidth: Math.max(width, TAG_MIN_WIDTH),
        ...(inside
          ? {
              top: 0,
              transform: `scale(${inv})`,
              transformOrigin: "top left",
            }
          : {
              bottom: "100%",
              transform: `translate(${-1 * inv}px, ${-1 * inv}px) scale(${inv})`,
              transformOrigin: "bottom left",
            }),
      }}
    >
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <button
                    aria-label={named ? undefined : nodeLabel(node)}
                    className="flex h-5 min-w-0 max-w-64 items-center gap-1 rounded-t-sm px-1.5 font-body-small-medium text-white outline-none focus-visible:underline"
                    style={{ background: color }}
                    type="button"
                  />
                }
              />
            }
          >
            <NodeIcon className="size-3 shrink-0" node={node} />
            {named ? <TagName inChat={thread !== null} node={node} /> : null}
          </TooltipTrigger>
          {named ? null : <TooltipContent>{nodeLabel(node)}</TooltipContent>}
        </Tooltip>
        <DropdownMenuContent align="start" className="w-56">
          {parents.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Inside</DropdownMenuLabel>
              {parents.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => selectNode(p)}>
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
                <DropdownMenuItem key={c.id} onClick={() => selectNode(c)}>
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
      {selection ? <ChatButton selection={selection} /> : null}
    </div>
  );
};
