import { cn } from "cn";
import {
  GitBranch,
  GitCompareArrows,
  Layers as LayersIcon,
  type LucideIcon,
  MessageCircle,
  MessageSquare,
  MonitorSmartphone,
  Settings,
  Shapes,
  TriangleAlert,
} from "lucide-react";
import { type ComponentType, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentChanges } from "./canvas/agent-changes.tsx";
import { installBridgeRouter } from "./canvas/bridge.ts";
import { Canvas } from "./canvas/canvas.tsx";
import { Prototype, PrototypeBar } from "./canvas/prototype.tsx";
import { CanvasStatus } from "./canvas/status.tsx";
import { Toolbar } from "./canvas/toolbar.tsx";
import { WorkspaceSwitcher } from "./canvas/workspace-switcher.tsx";
import { DialogHost } from "./components/dialogs.tsx";
import { IconButton } from "./components/icon-button.tsx";
import { ResizeHandle, usePanelWidth } from "./components/resize-handle.tsx";
import { useShortcuts } from "./lib/shortcuts.ts";
import { Changes } from "./panels/changes.tsx";
import { Comments } from "./panels/comments.tsx";
import { Inspector } from "./panels/inspector.tsx";
import { Layers } from "./panels/layers.tsx";
import { Pages } from "./panels/pages.tsx";
import { Palette } from "./panels/palette.tsx";
import { SaveConfigDialog } from "./panels/save-config.tsx";
import { SettingsDialog } from "./panels/settings.tsx";
import { Threads } from "./panels/threads.tsx";
import { useAgents } from "./state/agents.ts";
import { useCatalogue } from "./state/catalogue.ts";
import { useComments } from "./state/comments.ts";
import { useConnection } from "./state/connection.ts";
import { type LeftTab, useEditor, workspaceTabs } from "./state/editor.ts";
import { bindProjectEvents, useProject } from "./state/project.ts";
import { onUrlChange, readUrl } from "./state/url.ts";

installBridgeRouter();

const leftTabs: Record<
  LeftTab,
  { label: string; icon: LucideIcon; panel: ComponentType }
> = {
  changes: { icon: GitCompareArrows, label: "Changes", panel: Changes },
  chat: { icon: MessageSquare, label: "Chat", panel: Threads },
  comments: { icon: MessageCircle, label: "Comments", panel: Comments },
  layers: { icon: LayersIcon, label: "Layers", panel: Layers },
  pages: { icon: MonitorSmartphone, label: "Pages", panel: Pages },
  palette: { icon: Shapes, label: "Components", panel: Palette },
};

const leftBounds = { defaultWidth: 256, max: 480, min: 200 };
/** A conversation reads better wide; switching to any other panel caps the width again. */
const chatBounds = { ...leftBounds, max: 960 };
const rightBounds = { defaultWidth: 288, max: 560, min: 240 };

const RailButton = ({ value }: { value: LeftTab }) => {
  const active = useEditor((s) => s.leftTab === value);
  const onClick = () => useEditor.getState().setLeftTab(value);
  const tab = leftTabs[value];
  const Icon = tab.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={tab.label}
            aria-pressed={active}
            className={cn(
              "flex size-10 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              active && "bg-muted text-foreground"
            )}
            onClick={onClick}
            type="button"
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="right">{tab.label}</TooltipContent>
    </Tooltip>
  );
};

/** Icon navigation between the left panels the workspace offers, Figma-style. */
const Rail = () => {
  const workspace = useEditor((s) => s.workspace);
  return (
    <nav
      aria-label="Panels"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2"
    >
      <span
        aria-label="ultrapaint"
        className="mb-2 flex size-8 items-center justify-center rounded-lg bg-brand font-bold text-[11px] text-brand-foreground tracking-tight"
        role="img"
      >
        UP
      </span>
      {workspaceTabs[workspace].map((value) => (
        <RailButton key={value} value={value} />
      ))}
    </nav>
  );
};

const openSettings = () => useProject.getState().openSettings(true);
// Saving needs settings to save; before the first ones exist the setup dialog is the way in.
const openSaveConfig = () => {
  const { openSaveConfig: open, settings } = useProject.getState();
  if (settings) {
    open(true);
  } else {
    openSettings();
  }
};

const ProjectHeader = () => {
  const info = useProject((s) => s.info);
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
      {info.configured ? (
        <div className="flex min-w-0 flex-1 flex-col" title={info.repoPath}>
          <span className="truncate font-semibold">{info.name}</span>
          {info.branch ? (
            <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{info.branch}</span>
            </span>
          ) : null}
        </div>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          No repository configured
        </span>
      )}
      {info.storage.mode === "ephemeral" && (
        <IconButton
          className="text-warning hover:text-warning"
          onClick={openSaveConfig}
          tooltip={
            <span className="block max-w-64">
              Not saved. Started without a configuration file, so settings and
              agent threads are lost when the tool stops. Click to save a
              configuration.
            </span>
          }
        >
          <TriangleAlert />
        </IconButton>
      )}
      <IconButton onClick={openSettings} tooltip="Settings">
        <Settings />
      </IconButton>
    </div>
  );
};

/**
 * The panel floats over the canvas instead of pushing it: the canvas keeps its left edge against
 * the rail, so widening the panel covers more of it and never moves what is drawn on it.
 * `left-14` is the rail's own width.
 */
const LeftPanel = ({
  defaultWidth,
  width,
  onWidthChange,
}: {
  defaultWidth: number;
  width: number;
  onWidthChange: (width: number) => void;
}) => {
  const leftTab = useEditor((s) => s.leftTab);
  const tab = leftTabs[leftTab];
  // Only the active panel is mounted: panels subscribe to server events while visible.
  const Active = tab.panel;
  return (
    <aside
      className="absolute inset-y-0 left-14 z-30 flex flex-col border-r bg-sidebar text-sidebar-foreground"
      data-canvas-cover
      style={{ width }}
    >
      <ProjectHeader />
      <div className="flex h-9 shrink-0 items-center px-3 font-medium text-[11px]">
        {tab.label}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Active />
      </div>
      <ResizeHandle
        defaultWidth={defaultWidth}
        onWidthChange={onWidthChange}
        side="left"
        width={width}
      />
    </aside>
  );
};

const RightPanel = () => {
  const [width, setWidth] = usePanelWidth("right", rightBounds);
  return (
    <aside
      className="relative flex shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground"
      style={{ width }}
    >
      <div className="flex h-10 shrink-0 items-center border-b px-3 font-medium text-[11px]">
        Design
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Inspector />
      </div>
      <ResizeHandle
        defaultWidth={rightBounds.defaultWidth}
        onWidthChange={setWidth}
        side="right"
        width={width}
      />
    </aside>
  );
};

export const App = () => {
  const connState = useConnection((s) => s.state);
  const error = useProject((s) => s.error);
  const configured = useProject((s) => s.info.configured);
  const pages = useProject((s) => s.pages);
  const spaces = useProject((s) => s.spaces);
  const space = useEditor((s) => s.space);
  const workspace = useEditor((s) => s.workspace);
  const leftTab = useEditor((s) => s.leftTab);
  const leftPanel = leftTab === "chat" ? chatBounds : leftBounds;
  const [leftWidth, setLeftWidth] = usePanelWidth("left", leftPanel);
  const bound = useRef<boolean>(false);
  useShortcuts();

  useEffect(() => {
    if (connState !== "open") {
      return;
    }
    if (!bound.current) {
      bindProjectEvents();
      bound.current = true;
    }
    useProject.getState().load();
  }, [connState]);

  // Index the design system in the background so prop controls are typed.
  useEffect(() => {
    if (configured) {
      useCatalogue.getState().load();
      // Agent events are followed from the start, not only while the chat is open: the badge
      // over the tool strip reports turns that changed files.
      useAgents.getState().bind();
      useComments.getState().bind();
    }
  }, [configured]);

  // Comments are kept per space: opening another space reads its own.
  useEffect(() => {
    if (configured && space !== null) {
      useComments.getState().load(space);
    }
  }, [configured, space]);

  // Open the space and route the URL asks for, or the last one, or the first.
  useEffect(() => {
    if (!configured || spaces.length === 0 || space !== null) {
      return;
    }
    const url = readUrl();
    const saved = localStorage.getItem("ultrapaint:space");
    const ids = spaces.map((s) => s.id);
    let target = ids[0] ?? "";
    if (url.space !== null && ids.includes(url.space)) {
      target = url.space;
    } else if (saved !== null && ids.includes(saved)) {
      target = saved;
    }
    useEditor
      .getState()
      .openSpace(target, url.space === target ? url.route : undefined);
    // The canvas starts behind the panel, so the first view opens a margin past the panel's edge.
    useEditor.getState().setView({ x: leftWidth + 80 });
  }, [configured, spaces, space, leftWidth]);

  // Recompute frames when the page list changes for the open space.
  useEffect(() => {
    if (space === null) {
      return;
    }
    const inSpace = pages.filter((p) => p.space === space);
    const { frames, route } = useEditor.getState();
    const missing = inSpace.some((p) => !frames[p.id]);
    const extra = Object.keys(frames).some(
      (id) => !inSpace.find((p) => p.id === id)
    );
    if (missing || extra) {
      useEditor.getState().openSpace(space, route);
    } else {
      useEditor.getState().syncActivePage();
    }
  }, [pages, space]);

  // The browser's back and forward buttons are the prototype's.
  useEffect(
    () =>
      onUrlChange((url) => {
        const editor = useEditor.getState();
        if (url.space !== null && url.space !== editor.space) {
          editor.openSpace(url.space, url.route);
        } else {
          editor.navigate(url.route, { push: false });
        }
      }),
    []
  );

  // Errors surface as toasts; the store slot is only a hand-off from non-React code.
  useEffect(() => {
    if (!error) {
      return;
    }
    toast.error("Something went wrong", {
      description: error,
      duration: 10_000,
    });
    useProject.getState().setError(null);
  }, [error]);

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full flex-col">
        <div className="relative flex min-h-0 flex-1">
          <Rail />
          <LeftPanel
            defaultWidth={leftPanel.defaultWidth}
            onWidthChange={setLeftWidth}
            width={leftWidth}
          />
          <main className="relative min-w-0 flex-1">
            {workspace !== "prototype" && <Canvas />}
            {/* What floats over the canvas belongs in the part the panel leaves to be seen, and
                so does the prototype, which is centred rather than panned. */}
            <div
              className="pointer-events-none absolute inset-y-0 right-0"
              style={{ left: leftWidth }}
            >
              {workspace === "prototype" && <Prototype />}
              <WorkspaceSwitcher />
              <CanvasStatus />
              <div className="absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2">
                <AgentChanges />
                {workspace === "prototype" ? <PrototypeBar /> : <Toolbar />}
              </div>
            </div>
          </main>
          {workspace === "design" && <RightPanel />}
        </div>
        <SettingsDialog />
        <SaveConfigDialog />
        <DialogHost />
        <Toaster
          closeButton
          position="bottom-right"
          theme="dark"
          toastOptions={{ classNames: { description: "whitespace-pre-wrap" } }}
        />
      </div>
    </TooltipProvider>
  );
};
