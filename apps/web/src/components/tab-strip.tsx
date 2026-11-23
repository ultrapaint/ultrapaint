/**
 * The desktop app's tabs over the window (ADR 0107, `docs/designs/projects/1-tabs`): Home first
 * (the start page), then one per open project in the order opened, with its icon and name, a
 * spinner while an agent works there and a dot while one waits on the person, the shown one's ×
 * and the others' under the pointer, and a + at the end. A project's tab is one width whatever its
 * name and marks, the name cut short with an ellipsis, narrower only when the window runs out of
 * room; past that the project tabs scroll sideways, the shown one kept in view, Home and the +
 * always in sight. The + opens a menu and never a project by itself: Recent (the projects not open,
 * each with a × that takes it off the list), Open folder…, Open over SSH…, New project…; what is
 * chosen opens in a new tab. The strip is the window's title bar on a Mac, the room for its
 * buttons left at its start. It is a page of its own (`tabs.html`), in a view over the projects'
 * pages, that covers the window while a menu or dialog of its is open. Ultrapaint Dev lays its
 * blueprint under the strip and its drawing in the room past the + (ADR 0113).
 */
import type { ShellTab } from "@ultrapaint/contracts/shell-bridge";
import { House, LoaderCircle, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { removeFromList } from "../lib/remove-project.ts";
import { devCheckout } from "../lib/ultrapaint-dev.ts";
import { type PlatformProject, platform } from "../platform.ts";
import { useShellTabs } from "../state/shell-tabs.ts";
import { useWindowChrome } from "../state/window-controls.ts";
import { CutPath } from "./cut-path.tsx";
import { DevBlueprint, DevBlueprintDrawing } from "./dev-blueprint.tsx";
import { DialogHost, useDialogOpen } from "./dialogs.tsx";
import { ProjectIcon } from "./project-icon.tsx";
import {
  openRemoteProject,
  RemoteProjectDialog,
  useRemoteProjectShown,
} from "./remote-project-dialog.tsx";

/** Where the strip begins where the system draws the window's frame, as the drawing has it. */
const START = 14;

/** A shell call whose failure the strip has nothing to add to: the shell says it elsewhere. */
const quietly = (call: Promise<unknown> | undefined) => {
  call?.catch(() => undefined);
};

const TAB =
  "window-no-drag group/tab flex h-8 cursor-pointer shrink-0 items-center gap-2 rounded-lg px-2.5 font-body-medium outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/25";

/**
 * What a tab says past its name: the dot while an agent there waits on the person, the spinner
 * while it opens or an agent works, else nothing.
 */
const TabMark = ({ tab }: { tab: ShellTab }) => {
  if (tab.state === "idle") {
    return null;
  }
  if (tab.state === "waiting") {
    return (
      <span
        aria-label="An agent waits on you"
        className="flex size-3.5 shrink-0 items-center justify-center"
        role="img"
      >
        <span className="size-2 rounded-full bg-warning" />
      </span>
    );
  }
  return (
    <LoaderCircle
      aria-label={tab.state === "working" ? "An agent is working" : "Opening"}
      className={cn(
        "size-3.5 shrink-0 animate-spin",
        tab.state === "working" ? "text-agent" : "text-muted-foreground"
      )}
      role="img"
    />
  );
};

const ProjectTab = ({ tab }: { tab: ShellTab }) => {
  const { projects } = platform();
  return (
    <div
      aria-selected={tab.shown}
      className={cn(
        TAB,
        "w-48 min-w-24 shrink pr-1.5",
        tab.shown
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
      onClick={() => quietly(projects?.show(tab.id))}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          quietly(projects?.show(tab.id));
        }
      }}
      role="tab"
      tabIndex={0}
      title={tab.name}
    >
      <ProjectIcon
        icon={tab.icon}
        imageFrom={tab.server ?? null}
        name={tab.name}
        size={16}
      />
      <span className="min-w-0 flex-1 truncate">{tab.name}</span>
      {tab.shown ? <TabMark tab={tab} /> : null}
      {/* The shown tab's ×; another's under the pointer, in place of its spinner. */}
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        {tab.shown ? null : (
          <span className="flex items-center group-hover/tab:invisible">
            <TabMark tab={tab} />
          </span>
        )}
        <button
          aria-label={`Close ${tab.name}`}
          className={cn(
            "absolute inset-0 flex cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:visible focus-visible:ring-2 focus-visible:ring-ring/25",
            !tab.shown && "invisible group-hover/tab:visible"
          )}
          onClick={(event) => {
            event.stopPropagation();
            quietly(projects?.close(tab.id));
          }}
          type="button"
        >
          <X className="size-3.5" />
        </button>
      </span>
    </div>
  );
};

/** A project of Recent: the row opens it, its × takes it off the list. */
const RecentItem = ({
  onRemove,
  project,
}: {
  onRemove: () => void;
  project: PlatformProject;
}) => {
  const { projects } = platform();
  return (
    <DropdownMenuItem
      className="group/recent gap-2 py-1.5"
      onClick={() => quietly(projects?.open(project.id))}
    >
      <ProjectIcon
        icon={project.icon}
        imageFrom={null}
        name={project.name}
        size={16}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{project.name}</span>
        {project.detail ? (
          <CutPath
            className="font-body-small text-muted-foreground"
            path={project.detail}
          />
        ) : null}
      </span>
      <button
        aria-label={`Remove ${project.name} from the list`}
        className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 group-hover/recent:opacity-100 group-data-highlighted/recent:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </DropdownMenuItem>
  );
};

/** The +, and its menu of what to open in a new tab. */
const NewTab = ({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => {
  const { projects } = platform();
  const tabs = useShellTabs();
  const [listed, setListed] = useState<readonly PlatformProject[]>([]);
  // Why a project stayed on the list, until the menu opens again.
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    projects
      ?.list()
      .then(setListed)
      // Unread, Recent shows none: the rest of the menu still opens a project.
      .catch(() => setListed([]));
  }, [open, projects]);
  const openIds = new Set(tabs.map((t) => t.id));
  const recent = listed.filter((p) => !openIds.has(p.id));
  const remove = (project: PlatformProject) => {
    if (!projects) {
      return;
    }
    removeFromList(projects, project)
      .then((gone) => {
        if (gone) {
          setListed((now) => now.filter((p) => p.id !== project.id));
        }
      })
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : String(error))
      );
  };
  return (
    <DropdownMenu
      onOpenChange={(next) => {
        if (next) {
          setProblem(null);
        }
        onOpenChange(next);
      }}
      open={open}
    >
      <DropdownMenuTrigger
        aria-label="Open a project"
        className="window-no-drag flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25 data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <Plus className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {recent.length > 0 ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Recent</DropdownMenuLabel>
              {recent.map((project) => (
                <RecentItem
                  key={project.id}
                  onRemove={() => remove(project)}
                  project={project}
                />
              ))}
              {problem ? (
                <p
                  className="max-w-full px-2 py-1 font-body-small text-destructive"
                  role="alert"
                >
                  {problem}
                </p>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => quietly(projects?.add())}>
            Open folder…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openRemoteProject}>
            Open over SSH…
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* The start page is where a project is made: Home shows it. */}
        <DropdownMenuItem onClick={() => quietly(projects?.show(null))}>
          New project…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const TabStrip = () => {
  const { projects } = platform();
  const tabs = useShellTabs();
  const { inset } = useWindowChrome();
  const [menu, setMenu] = useState(false);
  const remote = useRemoteProjectShown();
  const dialog = useDialogOpen();
  // While a menu or a dialog of the strip's is open, it covers the window to draw over the page.
  const cover = menu || remote || dialog;
  useEffect(() => {
    quietly(projects?.coverWindow(cover));
  }, [cover, projects]);
  const dev = devCheckout() !== null;
  const home = !tabs.some((t) => t.shown);
  const shown = tabs.find((t) => t.shown)?.id;
  const scroller = useRef<HTMLDivElement>(null);
  // The shown tab scrolled into view when it changes, as when a new one opens past the edge.
  useEffect(() => {
    if (shown === undefined) {
      return;
    }
    scroller.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [shown]);
  return (
    <div
      aria-label="Open projects"
      className="window-drag relative isolate flex h-11 shrink-0 items-center gap-1 bg-canvas pr-2.5"
      role="tablist"
      style={{ paddingLeft: inset > 0 ? inset : START }}
    >
      {dev ? <DevBlueprint /> : null}
      <button
        aria-label="Home"
        aria-selected={home}
        className={cn(
          TAB,
          "mr-1 w-8 justify-center px-0",
          home
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        )}
        onClick={() => quietly(projects?.show(null))}
        role="tab"
        type="button"
      >
        <House className="size-4" />
      </button>
      {/* A mouse's wheel scrolls the tabs sideways; a trackpad does it by itself. */}
      <div
        className="window-no-drag flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
        onWheel={(event) => {
          if (event.deltaX === 0) {
            event.currentTarget.scrollLeft += event.deltaY;
          }
        }}
        ref={scroller}
      >
        {tabs.map((tab) => (
          <ProjectTab key={tab.id} tab={tab} />
        ))}
      </div>
      <NewTab onOpenChange={setMenu} open={menu} />
      {dev ? <DevBlueprintDrawing /> : null}
    </div>
  );
};

/** The whole page, as the window's entry draws it (`tabs-main.tsx`) and the tests do. */
export const TabStripPage = () => (
  <TooltipProvider delay={300}>
    <TabStrip />
    <RemoteProjectDialog />
    <DialogHost />
  </TooltipProvider>
);
