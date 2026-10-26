/**
 * The Vibe toolbar over the selection: only what the design system has — a component's own
 * variants, a text's styles, the colour, radius, spacing and shadow tokens of a container — then
 * Add to chat and the element's menu. Every control is a select that shows its value alone; the
 * menu it opens says which prop or token it sets. Design keeps the plain selection and the
 * inspector instead.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import type { Thread } from "@ultrapaint/contracts/threads";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { Ellipsis, Group, MessageSquareText, Square } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useContext,
} from "react";
import { createPortal } from "react-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentIcon } from "../components/agent-icon.tsx";
import { controlsOf } from "../lib/element-controls.ts";
import { areSiblings, wrapNodes } from "../lib/node-actions.ts";
import { openChat, stopThread } from "../lib/thread-actions.ts";
import { useAgents } from "../state/agents.ts";
import { componentMetaOf, useCatalogue } from "../state/catalogue.ts";
import { type MenuTarget, showMenu } from "../state/context-menu.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { useDrag } from "./drag.ts";
import { ChatButton, GroupChatButton } from "./element-toolbar-chat.tsx";
import { ToolbarLayer, usePlacement } from "./element-toolbar-placement.ts";
import {
  AlignSelect,
  MenuHead,
  MoreProps,
  PropSelect,
  TextStyleSelect,
  TokenSelect,
  ValueTrigger,
} from "./element-toolbar-selects.tsx";
import { LinkControl } from "./link-control.tsx";
import { SpacingSelect } from "./spacing-select.tsx";
import { Targets } from "./toolbar-targets.ts";

export const Divider = () => (
  <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />
);

const Controls = ({ node }: { node: DesignNode }) => {
  const meta = useCatalogue((s) =>
    node.type === "instance" ? componentMetaOf(s.catalogue, node) : undefined
  );
  const { more, shown } = controlsOf(node, meta?.variants);
  const source = meta?.file.split("/").at(-1) ?? "props";
  return (
    <>
      {shown.map((control) => {
        switch (control.kind) {
          case "prop":
            return node.type === "instance" ? (
              <PropSelect
                control={control}
                key={control.name}
                node={node}
                source={source}
              />
            ) : null;
          case "textStyle":
            return node.type === "text" ? (
              <TextStyleSelect key="style" node={node} />
            ) : null;
          case "align":
            return node.type === "text" ? (
              <AlignSelect key="align" node={node} />
            ) : null;
          case "spacing":
            return <SpacingSelect key="spacing" />;
          default:
            return (
              <TokenSelect control={control} key={control.field} node={node} />
            );
        }
      })}
      {node.type === "instance" && more.length > 0 ? (
        <MoreProps count={more.length} node={node} />
      ) : null}
      <LinkControl node={node} />
    </>
  );
};

/** The thread whose agent is changing this node right now, if one is. */
const useWorkOn = (selection: Selection | null) =>
  useAgents((s) => {
    if (!selection) {
      return null;
    }
    const entry = Object.entries(s.working).find(
      ([, w]) => !w.done && w.nodeIds.includes(selection.nodeId)
    );
    return entry ? (s.threads.find((t) => t.id === entry[0]) ?? null) : null;
  });

/** While an agent changes the element: who, the way to its thread, and the way to stop it. */
const AgentAtWork = ({ thread }: { thread: Thread }) => {
  const agent = useAgents((s) => s.agents.find((a) => a.id === thread.agentId));
  return (
    <>
      <span className="flex h-7 items-center gap-1.5 px-2 font-body">
        <AgentIcon agentId={thread.agentId} className="size-3.5" />
        {agent?.name ?? "An agent"} is changing this
        <Spinner className="size-3 text-agent" />
      </span>
      <Divider />
      <button
        className="flex h-7 items-center gap-1.5 rounded-md px-2 font-body outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => openChat(thread.id)}
        type="button"
      >
        <MessageSquareText className="size-3.5" />
        Open chat
      </button>
      <button
        className="flex h-7 items-center gap-1.5 rounded-md px-2 font-body outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => stopThread(thread.id)}
        type="button"
      >
        <Square className="size-3" />
        Stop
      </button>
    </>
  );
};

/** A box over the element, in the frame's toolbar layer, that the toolbar hangs from. */
const OverFrame = ({ children, rect }: { children: ReactNode; rect: Rect }) => {
  const layer = useContext(ToolbarLayer);
  return layer
    ? createPortal(
        <div
          className="pointer-events-none absolute"
          style={{
            height: rect.height,
            left: rect.x,
            top: rect.y,
            width: rect.width,
          }}
        >
          {children}
        </div>,
        layer
      )
    : null;
};

export const ElementToolbar = ({
  frame,
  inv,
  node,
  rect,
}: {
  /** The frame's size, which the toolbar stays inside while it fits. */
  frame: { height: number; width: number };
  inv: number;
  node: DesignNode;
  /** Where the element is in the frame, which decides where the toolbar can go. */
  rect: Rect;
}) => {
  const [placeAt, placement] = usePlacement(rect, inv, frame);
  const selection = useEditor((s) => s.selection);
  const dragging = useDrag((s) => s.dragged !== null);
  const workedOnBy = useWorkOn(selection);
  if (!selection || dragging) {
    return null;
  }
  return (
    <OverFrame rect={rect}>
      <div
        aria-label={`Toolbar of ${nodeLabel(node)}`}
        className="pointer-events-auto absolute left-1/2 flex items-center gap-0.5 whitespace-nowrap rounded-[10px] border bg-popover p-0.5 text-popover-foreground shadow-lg"
        data-element-toolbar
        onPointerDown={(e) => e.stopPropagation()}
        ref={placeAt}
        role="toolbar"
        style={placement}
      >
        {workedOnBy ? (
          <AgentAtWork thread={workedOnBy} />
        ) : (
          <Targets.Provider value={[selection]}>
            <Controls node={node} />
            <Divider />
            <ChatButton selection={selection} />
          </Targets.Provider>
        )}
        <MoreButton
          menu={{
            frame: selection.frame,
            kind: "node",
            nodeId: selection.nodeId,
          }}
        />
      </div>
    </OverFrame>
  );
};

/**
 * The context menu of what the toolbar is over, under the button. Opened on a node of the
 * selection, it acts on the whole selection, as a right-click on it does.
 */
export const MoreButton = ({ menu }: { menu: MenuTarget }) => {
  const openMore = (e: ReactMouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(menu, { x: r.left, y: r.bottom + 4 });
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="More"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={openMore}
            type="button"
          />
        }
      >
        <Ellipsis className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>More</TooltipContent>
    </Tooltip>
  );
};

/** Whether nodes are of one kind, so the controls of one of them fit all: one component, or one type. */
const sameKind = (nodes: readonly DesignNode[]) => {
  const [first] = nodes;
  return nodes.every((n) =>
    n.type === "instance" && first?.type === "instance"
      ? n.component === first.component && n.from === first.from
      : n.type === first?.type
  );
};

const WRAPS = [
  ["row", "Row"],
  ["column", "Column"],
  ["group", "Group"],
] as const;

/**
 * The toolbar over several selected elements: what they share when they are of one kind, set on
 * all of them at once; wrapping siblings in a row, a column or a group; all of them to the chat.
 */
export const GroupToolbar = ({
  frame,
  inv,
  nodes,
  rect,
  targets,
}: {
  frame: { height: number; width: number };
  inv: number;
  nodes: readonly DesignNode[];
  rect: Rect;
  targets: readonly Selection[];
}) => {
  const [placeAt, placement] = usePlacement(rect, inv, frame);
  const dragging = useDrag((s) => s.dragged !== null);
  const [first] = nodes;
  if (dragging || !first) {
    return null;
  }
  const siblings = areSiblings(targets);
  return (
    <OverFrame rect={rect}>
      <div
        aria-label={`Toolbar of ${nodes.length} elements`}
        className="pointer-events-auto absolute left-1/2 flex items-center gap-0.5 whitespace-nowrap rounded-[10px] border bg-popover p-0.5 text-popover-foreground shadow-lg"
        data-element-toolbar
        onPointerDown={(e) => e.stopPropagation()}
        ref={placeAt}
        role="toolbar"
        style={placement}
      >
        <Targets.Provider value={targets}>
          {sameKind(nodes) ? (
            <>
              <Controls node={first} />
              <Divider />
            </>
          ) : null}
          <DropdownMenu>
            <ValueTrigger
              icon={Group}
              tooltip={
                siblings
                  ? "Wrap them in"
                  : "Only siblings can be wrapped together"
              }
            >
              Wrap in
            </ValueTrigger>
            <DropdownMenuContent className="w-40">
              <DropdownMenuGroup>
                <MenuHead name="wrap in" />
                {WRAPS.map(([type, label]) => (
                  <DropdownMenuItem
                    disabled={!siblings}
                    key={type}
                    onClick={() => wrapNodes(targets, type)}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Divider />
          <GroupChatButton targets={targets} />
          {targets[0] ? (
            <MoreButton
              menu={{
                frame: targets[0].frame,
                kind: "node",
                nodeId: targets[0].nodeId,
              }}
            />
          ) : null}
        </Targets.Provider>
      </div>
    </OverFrame>
  );
};
