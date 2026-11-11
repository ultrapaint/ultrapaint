/**
 * The top of the editor's two cards: the project's row at the top of the left card, with search
 * and the left panel's toggle, and the right panel's toggle. In the desktop app on a Mac the
 * project's row is the window's title bar: the window's buttons sit at its start, and dragging it
 * moves the window.
 */

import {
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { chooseFolder } from "../lib/project-setup.ts";
import { usePanels } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { useWindowChrome } from "../state/window-controls.ts";
import { openCommandPalette } from "./command-palette.tsx";
import { Logo } from "./logo.tsx";
import { hasProjectSwitcher, ProjectSwitcher } from "./project-switcher.tsx";
import { CommandKeys } from "./shortcut-sheet.tsx";

/** Where the cards sit: this far from the window's edges, and this tall. */
export const EDGE = 8;
const TITLE_HEIGHT = 48;

// Saving needs settings to save; before the first ones exist a folder is chosen first.
const openSaveConfig = () => {
  const { openSaveConfig: open, settings } = useProject.getState();
  if (settings) {
    open(true);
  } else {
    chooseFolder();
  }
};

/** The open project's name and branch on one line, or the way to set one up. */
const ProjectName = () => {
  const info = useProject((s) => s.info);
  if (!info.configured) {
    return (
      <button
        className="window-no-drag min-w-0 truncate text-left font-body-medium text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
        onClick={chooseFolder}
        type="button"
      >
        Choose a folder
      </button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={<div className="flex min-w-0 flex-col justify-center" />}
      >
        <span className="truncate font-heading-xsmall">{info.name}</span>
        {info.branch ? (
          <span className="flex min-w-0 items-center gap-1 font-body-small text-muted-foreground">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{info.branch}</span>
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent side="bottom">{info.repoPath}</TooltipContent>
    </Tooltip>
  );
};

/**
 * A project whose settings are not saved: a status, not an error, so the system's neutral badge
 * with the warning's dot beside its words, quieter than the name. It opens Save configuration.
 */
const Unsaved = () => {
  const info = useProject((s) => s.info);
  if (info.storage.mode !== "ephemeral") {
    return null;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            className="window-no-drag h-6 shrink-0 gap-1.5 bg-foreground/6 px-2 text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25"
            render={<button onClick={openSaveConfig} type="button" />}
          />
        }
      >
        <span aria-hidden className="size-1.5 rounded-full bg-warning" />
        Not saved
      </TooltipTrigger>
      <TooltipContent className="max-w-64" side="bottom">
        Chats are lost when Ultrapaint stops. Save the configuration to keep them.
      </TooltipContent>
    </Tooltip>
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
          className="window-no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25 aria-pressed:bg-accent aria-pressed:text-foreground [&_svg]:size-4"
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
 * The project, the top row of the left card: the mark, its name over its branch, or the desktop
 * app's switcher between its projects, then search (every command, ⌘K) and the left panel's
 * toggle. On a Mac desktop window the window's buttons sit at its start.
 */
export const TitleRow = () => {
  const chrome = useWindowChrome();
  const hidden = usePanels((s) => s.left);
  const PanelIcon = hidden ? PanelLeftOpen : PanelLeftClose;
  const style: CSSProperties = {
    height: TITLE_HEIGHT,
    // The buttons reach this far from the window's edge; the card begins EDGE from it.
    paddingLeft: chrome.inset > 0 ? chrome.inset - EDGE : undefined,
  };
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-2.5 pr-1.5 pl-2.5",
        chrome.drag && "window-drag"
      )}
      style={style}
    >
      <Logo />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* A shell with a list of projects puts its switcher where the name is (Platform). */}
        {hasProjectSwitcher() ? (
          <div className="window-no-drag min-w-0 max-w-64">
            <ProjectSwitcher />
          </div>
        ) : (
          <ProjectName />
        )}
        <Unsaved />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <TopButton
          command="palette"
          label="Search"
          onClick={openCommandPalette}
        >
          <Search />
        </TopButton>
        <TopButton
          command="toggleLeft"
          label={hidden ? "Show the left panel" : "Hide the left panel"}
          onClick={toggleLeft}
        >
          <PanelIcon />
        </TopButton>
      </div>
    </header>
  );
};

/** Puts the right panel away: at the end of its tabs' row, or of the board inspector's header. */
export const HideRightPanel = () => (
  <TopButton
    command="toggleRight"
    label="Hide the right panel"
    onClick={toggleRight}
  >
    <PanelRightClose />
  </TopButton>
);

/**
 * The right panel put away: a small card at the window's top right, the panel's name beside the
 * icon that brings it back. Out, its toggle is in the panel's own top row.
 */
export const RightPanelBar = ({ name }: { name: string }) => (
  <div className="floating pointer-events-auto flex h-11 shrink-0 items-center gap-1.5 pr-3 pl-1.5">
    <TopButton
      command="toggleRight"
      label="Show the right panel"
      onClick={toggleRight}
    >
      <PanelRightOpen />
    </TopButton>
    <span className="font-body-medium text-muted-foreground">{name}</span>
  </div>
);
