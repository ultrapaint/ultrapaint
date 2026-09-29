import {
  GitBranch,
  GitCompareArrows,
  Layers as LayersIcon,
  type LucideIcon,
  MessageCircle,
  MonitorSmartphone,
  Palette as PaletteIcon,
  Settings,
  Shapes,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { type ComponentType, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installBridgeRouter } from "./canvas/bridge.ts";
import { Canvas } from "./canvas/canvas.tsx";
import { Prototype, PrototypeBar } from "./canvas/prototype.tsx";
import { CanvasStatus } from "./canvas/status.tsx";
import { Toolbar } from "./canvas/toolbar.tsx";
import { WorkspaceSwitcher } from "./canvas/workspace-switcher.tsx";
import { ContextMenuHost } from "./components/context-menu-host.tsx";
import { DialogHost } from "./components/dialogs.tsx";
import { GitUserButton } from "./components/git-user.tsx";
import { IconButton } from "./components/icon-button.tsx";
import { ResizeHandle, usePanelWidth } from "./components/resize-handle.tsx";
import { openSetup, SetupDialog } from "./components/setup-dialog.tsx";
import { useOpenNodeLink } from "./lib/open-node-link.ts";
import { useShortcuts } from "./lib/shortcuts.ts";
import { Changes } from "./panels/changes.tsx";
import { CodePanel } from "./panels/code.tsx";
import { Comments } from "./panels/comments.tsx";
import { DesignSystemPanel } from "./panels/design-system.tsx";
import { Inspector } from "./panels/inspector.tsx";
import { Layers } from "./panels/layers.tsx";
import { Pages } from "./panels/pages.tsx";
import { Palette } from "./panels/palette.tsx";
import { SaveConfigDialog } from "./panels/save-config.tsx";
import { SettingsPage } from "./panels/settings.tsx";
import { Threads } from "./panels/threads.tsx";
import { useAgents } from "./state/agents.ts";
import { useCatalogue } from "./state/catalogue.ts";
import { useComments } from "./state/comments.ts";
import { useConnection } from "./state/connection.ts";
import { useDesignSystem } from "./state/design-system.ts";
import { bindDocuments } from "./state/documents.ts";
import {
  type LeftTab,
  type RightTab,
  sharedTabs,
  useEditor,
  workspaceTabs,
} from "./state/editor.ts";
import { bindProjectEvents, useProject } from "./state/project.ts";
import { bindScreenshots } from "./state/screenshots.ts";
import { onUrlChange, readUrl, tidyUrl, writeMode } from "./state/url.ts";

installBridgeRouter();

/** `rail` is the word under the icon, `label` the panel's title and the button's name. */
const leftTabs: Record<
  LeftTab,
  { label: string; rail: string; icon: LucideIcon; panel: ComponentType }
> = {
  changes: {
    icon: GitCompareArrows,
    label: "Changes",
    panel: Changes,
    rail: "Changes",
  },
  chat: { icon: Sparkles, label: "Chats", panel: Threads, rail: "Chats" },
  comments: {
    icon: MessageCircle,
    label: "Comments",
    panel: Comments,
    rail: "Comments",
  },
  designSystem: {
    icon: PaletteIcon,
    label: "Design system",
    panel: DesignSystemPanel,
    rail: "System",
  },
  layers: { icon: LayersIcon, label: "Layers", panel: Layers, rail: "Layers" },
  pages: {
    icon: MonitorSmartphone,
    label: "Pages",
    panel: Pages,
    rail: "Pages",
  },
  palette: {
    icon: Shapes,
    label: "Components",
    panel: Palette,
    rail: "Assets",
  },
};

const leftBounds = { defaultWidth: 256, max: 480, min: 200 };
/** A conversation reads better wide; switching to any other panel caps the width again. */
const chatBounds = { ...leftBounds, defaultWidth: 340, max: 960 };
const rightBounds = { defaultWidth: 288, max: 560, min: 240 };

const openSettings = () => useProject.getState().openSettings(true);

/**
 * One place on the rail: the icon in its tile, the word under it. `dot` says an agent is working;
 * it sits in the icon's own top-right corner, over it, so nothing moves when it comes and goes.
 */
const RailItem = ({
  active = false,
  dot = false,
  icon: Icon,
  label,
  name,
  onClick,
}: {
  active?: boolean;
  dot?: boolean;
  icon: LucideIcon;
  label: string;
  name: string;
  onClick: () => void;
}) => (
  <button
    aria-label={name}
    aria-pressed={active}
    className="group flex w-15 flex-col items-center gap-0.5 rounded-lg py-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:text-foreground"
    onClick={onClick}
    title={name === label ? undefined : name}
    type="button"
  >
    <span className="flex h-7.5 w-9 items-center justify-center rounded-lg transition-colors group-hover:bg-muted group-aria-pressed:bg-muted">
      <span className="relative flex">
        <Icon className="size-4.5" />
        {dot ? (
          <span
            aria-label="An agent is working"
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-agent ring-2 ring-sidebar group-hover:ring-muted group-aria-pressed:ring-muted"
            role="status"
          />
        ) : null}
      </span>
    </span>
    <span className="font-medium text-[10px] leading-tight">{label}</span>
  </button>
);

const RailButton = ({ value }: { value: LeftTab }) => {
  const active = useEditor((s) => s.leftTab === value);
  // Chats: an agent is working. Changes: an agent's turn changed files nobody looked at yet.
  const dot = useAgents((s) => {
    if (value === "chat") {
      return s.threads.some((t) => t.status === "running");
    }
    return value === "changes" && s.changed.length > 0;
  });
  const tab = leftTabs[value];
  return (
    <RailItem
      active={active}
      dot={dot}
      icon={tab.icon}
      label={tab.rail}
      name={tab.label}
      onClick={() => useEditor.getState().setLeftTab(value)}
    />
  );
};

/** Navigation between the left panels the workspace offers, each named under its icon. */
const Rail = () => {
  const workspace = useEditor((s) => s.workspace);
  return (
    <nav
      aria-label="Panels"
      className="flex w-16 shrink-0 flex-col items-center gap-0.5 border-r bg-sidebar pt-2.5 pb-3"
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
      {workspaceTabs[workspace].length > 0 && (
        <Separator className="my-1.5 w-7" />
      )}
      {sharedTabs.map((value) => (
        <RailButton key={value} value={value} />
      ))}
      <div className="flex-1" />
      <RailItem
        icon={Settings}
        label="Settings"
        name="Settings"
        onClick={openSettings}
      />
      <Separator className="mt-2.5 mb-3 w-7" />
      <GitUserButton />
    </nav>
  );
};

// Saving needs settings to save; before the first ones exist the setup dialog is the way in.
const openSaveConfig = () => {
  const { openSaveConfig: open, settings } = useProject.getState();
  if (settings) {
    open(true);
  } else {
    openSetup();
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
        <button
          className="min-w-0 flex-1 truncate text-left text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
          onClick={openSetup}
          type="button"
        >
          No repository set up
        </button>
      )}
      {info.storage.mode === "ephemeral" && (
        <IconButton
          className="text-warning hover:text-warning"
          onClick={openSaveConfig}
          tooltip={
            <span className="block max-w-64">
              {info.setup === "detected"
                ? "Not saved. The settings were detected in the repository, and agent threads are lost when the tool stops. Click to save a configuration."
                : "Not saved. Started without a configuration file, so settings and agent threads are lost when the tool stops. Click to save a configuration."}
            </span>
          }
        >
          <TriangleAlert />
        </IconButton>
      )}
    </div>
  );
};

/**
 * The panel floats over the canvas instead of pushing it: the canvas keeps its left edge against
 * the rail, so widening the panel covers more of it and never moves what is drawn on it.
 * `left-16` is the rail's own width.
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
      className="absolute inset-y-0 left-16 z-30 flex flex-col border-r bg-sidebar text-sidebar-foreground"
      data-canvas-cover
      style={{ width }}
    >
      <ProjectHeader />
      {/* The chat heads itself: its list and each thread have their own header. */}
      {leftTab === "chat" ? null : (
        <div className="flex h-9 shrink-0 items-center px-3 font-medium text-[11px]">
          {tab.label}
        </div>
      )}
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

const onRightTabChange = (value: unknown) =>
  useEditor.getState().setRightTab(value as RightTab);

const RightPanel = () => {
  const [width, setWidth] = usePanelWidth("right", rightBounds);
  const rightTab = useEditor((s) => s.rightTab);
  return (
    <aside
      className="relative flex shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground"
      style={{ width }}
    >
      <Tabs
        className="min-h-0 flex-1 gap-0"
        onValueChange={onRightTabChange}
        value={rightTab}
      >
        <div className="flex h-10 shrink-0 items-center border-b px-2">
          <TabsList variant="line">
            <TabsTrigger className="text-[11px]" value="design">
              Design
            </TabsTrigger>
            <TabsTrigger className="text-[11px]" value="code">
              Code
            </TabsTrigger>
          </TabsList>
        </div>
        {/* Only the open tab is mounted: the code is written out only while it is read. */}
        <TabsContent className="min-h-0 overflow-auto" value="design">
          <Inspector />
        </TabsContent>
        <TabsContent className="min-h-0 overflow-auto" value="code">
          <CodePanel />
        </TabsContent>
      </Tabs>
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
  const settingsOpen = useProject((s) => s.settingsOpen);
  const leftPanel = leftTab === "chat" ? chatBounds : leftBounds;
  const [leftWidth, setLeftWidth] = usePanelWidth("left", leftPanel);
  const bound = useRef<boolean>(false);
  useShortcuts();
  useOpenNodeLink();

  useEffect(() => {
    if (connState !== "open") {
      return;
    }
    if (!bound.current) {
      bindProjectEvents();
      bindScreenshots();
      bound.current = true;
    }
    useProject.getState().load();
  }, [connState]);

  // Index the design system in the background so prop controls are typed.
  useEffect(() => {
    if (configured) {
      bindDocuments();
      useDesignSystem.getState().load();
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
    // The designs directory's own space is named "", which the URL leaves out: a link with a
    // route and no space is a route of that space.
    const urlSpace =
      url.space ?? (ids.includes("") && url.route !== "/" ? "" : null);
    let target = ids[0] ?? "";
    if (urlSpace !== null && ids.includes(urlSpace)) {
      target = urlSpace;
    } else if (saved !== null && ids.includes(saved)) {
      target = saved;
    }
    useEditor
      .getState()
      .openSpace(target, urlSpace === target ? url.route : undefined);
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
  useEffect(() => {
    tidyUrl();
    return onUrlChange((url) => {
      const editor = useEditor.getState();
      if (url.space !== null && url.space !== editor.space) {
        editor.openSpace(url.space, url.route);
      } else {
        editor.navigate(url.route, { push: false });
      }
      // Back and forward walk the routes, not the workspace: an older entry may name another.
      writeMode(editor.workspace);
    });
  }, []);

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
        {settingsOpen ? (
          <SettingsPage />
        ) : (
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
                  {workspace === "prototype" ? <PrototypeBar /> : <Toolbar />}
                </div>
              </div>
            </main>
            {workspace === "design" && <RightPanel />}
          </div>
        )}
        <SaveConfigDialog />
        <SetupDialog />
        <DialogHost />
        <ContextMenuHost />
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
