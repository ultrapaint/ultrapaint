/**
 * The selection's bar, docked above the tools (ADR 0058): only what the design system has — a
 * component's own variants, a text's styles, the colour, radius, spacing and shadow tokens of a
 * container — then the element's menu. Every control is a select that shows its value alone; the
 * menu it opens says which prop or token it sets. Add to chat is on the selection's tag, on the
 * canvas.
 */

import { metaOf } from "@ultrapaint/contracts/catalogue";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Thread } from "@ultrapaint/contracts/threads";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { Ellipsis, Group, MessageSquareText, Square } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
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
import { useComponents } from "../state/components.ts";
import { type MenuTarget, showMenu } from "../state/context-menu.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { frameRefOf, pageOfRef } from "../state/frame-ref.ts";
import { useDrag } from "./drag.ts";
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
import { PageControls } from "./page-toolbar.tsx";
import { Divider, SelectionDock } from "./selection-dock.tsx";
import { SpacingSelect } from "./spacing-select.tsx";
import { Targets } from "./toolbar-targets.ts";

/** A plain button of the bar: an icon and its label. */
const BAR_BUTTON_CLASS =
  "flex h-7 items-center gap-1.5 rounded-md px-2 font-body-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/25 [&_svg]:size-4 [&_svg]:text-muted-foreground";

const Controls = ({ node }: { node: DesignNode }) => {
  const meta = useComponents((s) =>
    node.type === "instance" ? metaOf(s.catalogue, node) : undefined
  );
  const { more, shown } = controlsOf(node, meta?.variants);
  const source = meta?.name ?? "props";
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
        <Spinner className="size-3.5 text-agent" />
        <AgentIcon agentId={thread.agentId} className="size-4" />
        {agent?.name ?? "An agent"} is changing this
      </span>
      <Divider />
      <button
        className={BAR_BUTTON_CLASS}
        onClick={() => openChat(thread.id)}
        type="button"
      >
        <MessageSquareText />
        Open chat
      </button>
      <button
        className={BAR_BUTTON_CLASS}
        onClick={() => stopThread(thread.id)}
        type="button"
      >
        <Square />
        Stop
      </button>
    </>
  );
};

export const ElementToolbar = ({ node }: { node: DesignNode }) => {
  const selection = useEditor((s) => s.selection);
  const dragging = useDrag((s) => s.dragged !== null);
  const workedOnBy = useWorkOn(selection);
  if (!selection || dragging) {
    return null;
  }
  // A page's root is the page (ADR 0075): its viewport and views, and the page's menu.
  const page =
    node.type === "page" ? pageOfRef(frameRefOf(selection.frame)) : null;
  return (
    <SelectionDock label={`Toolbar of ${nodeLabel(node)}`}>
      {workedOnBy ? (
        <>
          <AgentAtWork thread={workedOnBy} />
          <Divider />
        </>
      ) : (
        <Targets.Provider value={[selection]}>
          <Controls node={node} />
          <Divider />
          {page === null ? null : (
            <>
              <PageControls pageId={page} />
              <Divider />
            </>
          )}
        </Targets.Provider>
      )}
      <MoreButton
        menu={
          page === null
            ? { frame: selection.frame, kind: "node", nodeId: selection.nodeId }
            : { kind: "page", pageId: page }
        }
      />
    </SelectionDock>
  );
};

/**
 * The context menu of what the bar acts on, against the button. Opened on a node of the
 * selection, it acts on the whole selection, as a right-click on it does.
 */
export const MoreButton = ({ menu }: { menu: MenuTarget }) => {
  // Against the button: the menu opens on the side it has room on.
  const openMore = (e: ReactMouseEvent) => showMenu(menu, e.currentTarget);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="More"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25"
            onClick={openMore}
            type="button"
          />
        }
      >
        <Ellipsis className="size-4" />
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
 * The bar of several selected elements: what they share when they are of one kind, set on all of
 * them at once; wrapping siblings in a row, a column or a group. The chat is on their tag.
 */
export const GroupToolbar = ({
  nodes,
  targets,
}: {
  nodes: readonly DesignNode[];
  targets: readonly Selection[];
}) => {
  const dragging = useDrag((s) => s.dragged !== null);
  const [first] = nodes;
  if (dragging || !first) {
    return null;
  }
  const siblings = areSiblings(targets);
  return (
    <SelectionDock label={`Toolbar of ${nodes.length} elements`}>
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
        {targets[0] ? (
          <>
            <Divider />
            <MoreButton
              menu={{
                frame: targets[0].frame,
                kind: "node",
                nodeId: targets[0].nodeId,
              }}
            />
          </>
        ) : null}
      </Targets.Provider>
    </SelectionDock>
  );
};
