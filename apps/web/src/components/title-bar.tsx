/**
 * The two cards at the top of the window: the title card at the left, with the project and the
 * left panel's toggle, and the actions at the right. In the desktop app on a Mac they are the
 * window's title bar: the window's buttons sit at the title card's start, and dragging either
 * card moves the window.
 */

import { nodeLabel } from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Search,
  Square,
  TriangleAlert,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditor } from "../state/editor.ts";
import { usePanels } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { useInspected } from "../state/selection.ts";
import { useWindowChrome } from "../state/window-controls.ts";
import { openCommandPalette } from "./command-palette.tsx";
import { GitUserButton } from "./git-user.tsx";
import { IconButton } from "./icon-button.tsx";
import { NodeIcon } from "./node-icon.tsx";
import { hasProjectSwitcher, ProjectSwitcher } from "./project-switcher.tsx";
import { openSetup } from "./setup-dialog.tsx";
import { CommandKeys } from "./shortcut-sheet.tsx";

/** Where the cards sit: this far from the window's edges, and this tall. */
export const EDGE = 8;
const TITLE_HEIGHT = 44;

// Saving needs settings to save; before the first ones exist the setup dialog is the way in.
const openSaveConfig = () => {
  const { openSaveConfig: open, settings } = useProject.getState();
  if (settings) {
    open(true);
  } else {
    openSetup();
  }
};

/** The open project's name and branch on one line, or the way to set one up. */
const ProjectName = () => {
  const info = useProject((s) => s.info);
  if (!info.configured) {
    return (
      <button
        className="window-no-drag min-w-0 truncate text-left text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
        onClick={openSetup}
        type="button"
      >
        No repository set up
      </button>
    );
  }
  return (
    <div
      className="flex min-w-0 items-baseline gap-2 font-body"
      title={info.repoPath}
    >
      <span className="truncate font-semibold">{info.name}</span>
      {info.branch ? (
        <span className="flex min-w-0 items-center gap-1 self-center text-muted-foreground">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{info.branch}</span>
        </span>
      ) : null}
    </div>
  );
};

const Unsaved = () => {
  const info = useProject((s) => s.info);
  if (info.storage.mode !== "ephemeral") {
    return null;
  }
  return (
    <IconButton
      className="window-no-drag size-7 text-warning hover:text-warning"
      label="Not saved: save a configuration"
      onClick={openSaveConfig}
      side="bottom"
      tooltip={
        <span className="block max-w-64">
          {info.setup === "detected"
            ? "Not saved. The settings were detected in the repository, and chats are lost when the tool stops. Click to save a configuration."
            : "Not saved. Started without a configuration file, so settings and chats are lost when the tool stops. Click to save a configuration."}
        </span>
      }
    >
      <TriangleAlert />
    </IconButton>
  );
};

/** A button of the top cards, with its tooltip and key under it. */
const TopButton = ({
  children,
  command,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode;
  /** The command it is, whose keys the tooltip shows. */
  command?: string;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <button
          aria-label={label}
          aria-pressed={pressed}
          className="window-no-drag flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-muted aria-pressed:text-foreground [&_svg]:size-4"
          onClick={onClick}
          type="button"
        />
      }
    >
      {children}
    </TooltipTrigger>
    <TooltipContent side="bottom">
      {label}
      {command ? <CommandKeys id={command} /> : null}
    </TooltipContent>
  </Tooltip>
);

const toggleLeft = () => usePanels.getState().toggleLeft();
const toggleRight = () => usePanels.getState().toggleRight();

/**
 * The project, at the window's top left over the rail and the left panel: its name and branch,
 * or the desktop app's switcher between its projects, and the left panel's toggle. On a Mac
 * desktop window the window's buttons sit at its start.
 */
export const TitleCard = ({ width }: { width: number | null }) => {
  const chrome = useWindowChrome();
  const hidden = usePanels((s) => s.left);
  const PanelIcon = hidden ? PanelLeftOpen : PanelLeftClose;
  const style: CSSProperties = {
    height: TITLE_HEIGHT,
    // The buttons reach this far from the window's edge; the card begins EDGE from it.
    paddingLeft: chrome.inset > 0 ? chrome.inset - EDGE : undefined,
    ...(width === null ? {} : { width }),
  };
  return (
    <header
      className={cn(
        "floating pointer-events-auto flex shrink-0 items-center gap-2 pr-1.5 pl-2",
        chrome.drag && "window-drag"
      )}
      style={style}
    >
      <span
        aria-label="Ultrapaint"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand font-body font-bold text-brand-foreground tracking-tight"
        role="img"
      >
        UP
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {/* A shell with a list of projects puts its switcher where the name is (Platform). */}
        {hasProjectSwitcher() ? (
          <div className="window-no-drag min-w-0 max-w-64 flex-1">
            <ProjectSwitcher />
          </div>
        ) : (
          <ProjectName />
        )}
        <Unsaved />
      </div>
      <TopButton
        label={hidden ? "Show the left panel" : "Hide the left panel"}
        onClick={toggleLeft}
      >
        <PanelIcon />
      </TopButton>
    </header>
  );
};

const togglePrototype = () => {
  const editor = useEditor.getState();
  editor.setWorkspace(
    editor.workspace === "prototype" ? "design" : "prototype"
  );
};

/** Puts the right panel away, from the row of its tabs. */
/** What the right panel is about: the layer selected, its icon and name, or how many there are. */
const Inspecting = () => {
  const inspected = useInspected();
  if (!inspected) {
    return null;
  }
  const { node, nodes } = inspected;
  const component = node.type === "instance";
  return (
    <span
      className={cn(
        "flex h-7 min-w-0 items-center gap-1.5 truncate rounded-md px-2 font-body",
        component
          ? "bg-component/15 text-component"
          : "bg-muted text-foreground"
      )}
    >
      <NodeIcon className="size-3.5 shrink-0" node={node} />
      <span className="truncate">
        {nodes.length > 1 ? `${nodes.length} layers` : nodeLabel(node)}
      </span>
    </span>
  );
};

/**
 * The row over the right panel, its own card: the layer it is about and the panel's toggle (as
 * pen.dev has it). Kept while the panel is put away, as wide as its toggle and that layer.
 */
export const RightPanelBar = ({ width }: { width: number | null }) => {
  const hidden = usePanels((s) => s.right);
  return (
    <div
      className="floating pointer-events-auto flex h-10 shrink-0 items-center gap-1 pr-1 pl-1.5"
      style={width === null ? undefined : { width }}
    >
      <div className="flex min-w-0 flex-1">
        <Inspecting />
      </div>
      <TopButton
        label={hidden ? "Show the right panel" : "Hide the right panel"}
        onClick={toggleRight}
      >
        {hidden ? <PanelRightOpen /> : <PanelRightClose />}
      </TopButton>
    </div>
  );
};

/**
 * The actions at the window's top right, over the right panel: every command (⌘K), who the user
 * is, and the prototype. The right panel's toggle is on its own row under them (`RightPanelBar`).
 */
export const TopActions = () => {
  const chrome = useWindowChrome();
  const prototype = useEditor((s) => s.workspace === "prototype");
  return (
    <div
      className={cn(
        "floating pointer-events-auto flex shrink-0 items-center gap-1 px-1.5",
        chrome.drag && "window-drag"
      )}
      style={{ height: TITLE_HEIGHT }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label="Search the commands"
              className="window-no-drag flex h-8 items-center gap-2 rounded-lg pr-1.5 pl-2 font-body text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={openCommandPalette}
              type="button"
            />
          }
        >
          <Search className="size-4" />
          <span>Commands</span>
          <CommandKeys id="palette" />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Everything the editor can do, by name
        </TooltipContent>
      </Tooltip>
      <span className="window-no-drag flex size-8 items-center justify-center">
        <GitUserButton />
      </span>
      <TopButton
        command={prototype ? "workspace:design" : "workspace:prototype"}
        label={prototype ? "Back to the canvas" : "Prototype: click through"}
        onClick={togglePrototype}
        pressed={prototype}
      >
        {prototype ? <Square className="fill-current" /> : <Play />}
      </TopButton>
    </div>
  );
};
