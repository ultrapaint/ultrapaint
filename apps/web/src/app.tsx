import { cn } from "cn";
import {
  GitBranch,
  GitCompareArrows,
  Layers as LayersIcon,
  type LucideIcon,
  MessageCircle,
  MonitorSmartphone,
  Palette as PaletteIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shapes,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  type ComponentType,
  type CSSProperties,
  lazy,
  Suspense,
  useEffect,
  useRef,
} from "react";
import { toast } from "sonner";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { installBridgeRouter, provideDesignLook } from "./canvas/bridge.ts";
import { Canvas } from "./canvas/canvas.tsx";
import { Prototype, PrototypeBar } from "./canvas/prototype.tsx";
import { SnapshotBanner } from "./canvas/snapshot-banner.tsx";
import { CanvasStatus } from "./canvas/status.tsx";
import { Toolbar } from "./canvas/toolbar.tsx";
import { WorkspaceSwitcher } from "./canvas/workspace-switcher.tsx";
import { ContextMenuHost } from "./components/context-menu-host.tsx";
import { DialogHost } from "./components/dialogs.tsx";
import { GitUserButton } from "./components/git-user.tsx";
import { IconButton } from "./components/icon-button.tsx";
import { ResizeHandle, usePanelWidth } from "./components/resize-handle.tsx";
import { openSetup, SetupDialog } from "./components/setup-dialog.tsx";
import { ShortcutSheet } from "./components/shortcut-sheet.tsx";
import { useOpenNodeLink } from "./lib/open-node-link.ts";
import { useShortcuts } from "./lib/shortcuts.ts";
import { CanvasSwitcher } from "./panels/canvases.tsx";
import { CodePanel } from "./panels/code.tsx";
import { Inspector } from "./panels/inspector.tsx";
import { SaveConfigDialog } from "./panels/save-config.tsx";
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
import { useImplementation } from "./state/implementation.ts";
import { designLook } from "./state/look.ts";
import { openLeftPanel, usePanels } from "./state/panels.ts";
import { bindProjectEvents, useProject } from "./state/project.ts";
import { bindScreenshots } from "./state/screenshots.ts";
import { useSpecs } from "./state/specs.ts";
import { syncWaiting, useSync } from "./state/sync.ts";
import { onUrlChange, readUrl, tidyUrl, writeMode } from "./state/url.ts";

installBridgeRouter();

/*
 * Loaded when first opened: the chat is the panel the editor opens on, and the others, the
 * settings above all, bring code nobody needs until they are looked at.
 */
const Assets = lazy(() =>
  import("./panels/assets.tsx").then((m) => ({ default: m.Assets }))
);
const Changes = lazy(() =>
  import("./panels/changes.tsx").then((m) => ({ default: m.Changes }))
);
const Comments = lazy(() =>
  import("./panels/comments.tsx").then((m) => ({ default: m.Comments }))
);
const DesignSystemPanel = lazy(() =>
  import("./panels/design-system.tsx").then((m) => ({
    default: m.DesignSystemPanel,
  }))
);
const Layers = lazy(() =>
  import("./panels/layers.tsx").then((m) => ({ default: m.Layers }))
);
const Pages = lazy(() =>
  import("./panels/pages.tsx").then((m) => ({ default: m.Pages }))
);
const SettingsPage = lazy(() =>
  import("./panels/settings.tsx").then((m) => ({ default: m.SettingsPage }))
);

/** `rail` is the word under the icon, `label` the panel's title and the button's name. */
const leftTabs: Record<
  LeftTab,
  { label: string; rail: string; icon: LucideIcon; panel: ComponentType }
> = {
  assets: {
    icon: Shapes,
    label: "Assets",
    panel: Assets,
    rail: "Assets",
  },
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
    rail: "Design system",
  },
  layers: { icon: LayersIcon, label: "Layers", panel: Layers, rail: "Layers" },
  pages: {
    icon: MonitorSmartphone,
    label: "Pages",
    panel: Pages,
    rail: "Pages",
  },
};

const leftBounds = { defaultWidth: 288, max: 480, min: 200 };
/** A conversation reads better wide; switching to any other panel caps the width again. */
const chatBounds = { ...leftBounds, defaultWidth: 340, max: 960 };
const rightBounds = { defaultWidth: 320, max: 560, min: 240 };

const openSettings = () => useProject.getState().openSettings(true);

/**
 * One place on the rail: the icon in its tile, the word under it. `dot` says what is going on
 * there (an agent is working, the sync has something waiting); it sits in the icon's own
 * top-right corner, over it, so nothing moves when it comes and goes.
 */
const RailItem = ({
  active = false,
  dot = null,
  icon: Icon,
  label,
  name,
  onClick,
}: {
  active?: boolean;
  /** What the dot says, for a screen reader; no dot when null. */
  dot?: string | null;
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
            aria-label={dot}
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-agent ring-2 ring-sidebar group-hover:ring-muted group-aria-pressed:ring-muted"
            role="status"
          />
        ) : null}
      </span>
    </span>
    <span className="line-clamp-2 w-full text-center font-rail">{label}</span>
  </button>
);

const RailButton = ({ value }: { value: LeftTab }) => {
  // A panel put away is not the one open: nothing on the rail says it is.
  const hidden = usePanels((s) => s.left);
  const active = useEditor((s) => s.leftTab === value) && !hidden;
  // Chats: an agent is working. Changes: an agent's turn changed files nobody looked at yet.
  const agentDot = useAgents((s) => {
    if (value === "chat") {
      return s.threads.some((t) => t.status === "running");
    }
    return value === "changes" && s.changed.length > 0;
  });
  // Design system: the sync has something waiting, a drift or settings to fix (ADR 0025).
  const syncDot = useSync(
    (s) => value === "designSystem" && syncWaiting(s.plan)
  );
  let dot: string | null = null;
  if (agentDot) {
    dot = value === "chat" ? "An agent is working" : "Changes to look at";
  } else if (syncDot) {
    dot = "The design system and the code need syncing";
  }
  const tab = leftTabs[value];
  return (
    <RailItem
      active={active}
      dot={dot}
      icon={tab.icon}
      label={tab.rail}
      name={tab.label}
      onClick={() => openLeftPanel(value)}
    />
  );
};

const toggleLeft = () => usePanels.getState().toggleLeft();

/** Puts the left panel away for a clear canvas, or brings it back; the rail itself stays. */
const PanelToggle = () => {
  const hidden = usePanels((s) => s.left);
  const Icon = hidden ? PanelLeftOpen : PanelLeftClose;
  const name = hidden ? "Show the panel" : "Hide the panel";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={name}
            aria-pressed={hidden}
            className="mb-1 flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={toggleLeft}
            type="button"
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="right">
        {name}
        <span className="text-background/60">· every panel</span>
        <Kbd>⌘\</Kbd>
      </TooltipContent>
    </Tooltip>
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
        className="mb-2 flex size-8 items-center justify-center rounded-lg bg-brand font-body font-bold text-brand-foreground tracking-tight"
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
      <PanelToggle />
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
            <span className="flex min-w-0 items-center gap-1 font-body text-muted-foreground">
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
          label="Not saved: save a configuration"
          onClick={openSaveConfig}
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
      )}
    </div>
  );
};

/**
 * The panel floats over the canvas instead of pushing it: the canvas keeps its left edge against
 * the rail, so widening the panel covers more of it and never moves what is drawn on it.
 * `left-16` is the rail's own width. Put away, it stays mounted and hidden: the chat it holds
 * keeps its place and what was being written in it.
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
  const hidden = usePanels((s) => s.left);
  const tab = leftTabs[leftTab];
  // Only the active panel is mounted: panels subscribe to server events while visible.
  const Active = tab.panel;
  return (
    <aside
      className={cn(
        "absolute inset-y-0 left-16 z-30 flex-col border-r bg-sidebar text-sidebar-foreground",
        hidden ? "hidden" : "flex"
      )}
      data-canvas-cover="left"
      style={{ width }}
    >
      <ProjectHeader />
      <CanvasSwitcher />
      {/* The chat heads itself, its list and each thread; the pages panel has its own actions in
        its heading. */}
      {leftTab === "chat" || leftTab === "pages" ? null : (
        <div className="flex h-9 shrink-0 items-center px-3 font-heading-xsmall">
          {tab.label}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <Suspense fallback={null}>
          <Active />
        </Suspense>
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

/**
 * Floats over the canvas's right edge, as the left panel does over its left one: the canvas is
 * the same size in every workspace, and switching to Design never moves what is drawn on it.
 */
const RightPanel = ({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
}) => {
  const rightTab = useEditor((s) => s.rightTab);
  return (
    <aside
      className="absolute inset-y-0 right-0 z-30 flex flex-col border-l bg-sidebar text-sidebar-foreground"
      data-canvas-cover="right"
      style={{ width }}
    >
      <Tabs
        className="min-h-0 flex-1 gap-0"
        onValueChange={onRightTabChange}
        value={rightTab}
      >
        <div className="flex h-10 shrink-0 items-center border-b px-2">
          <TabsList variant="line">
            <TabsTrigger className="font-body" value="design">
              Design
            </TabsTrigger>
            <TabsTrigger className="font-body" value="code">
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
        onWidthChange={onWidthChange}
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
  const projectName = useProject((s) => s.info.name);
  const pages = useProject((s) => s.pages);
  const canvases = useProject((s) => s.canvases);
  const canvas = useEditor((s) => s.canvas);
  const workspace = useEditor((s) => s.workspace);
  const leftTab = useEditor((s) => s.leftTab);
  const settingsOpen = useProject((s) => s.settingsOpen);
  const leftPanel = leftTab === "chat" ? chatBounds : leftBounds;
  const [leftWidth, setLeftWidth] = usePanelWidth("left", leftPanel);
  const [rightWidth, setRightWidth] = usePanelWidth("right", rightBounds);
  const leftHidden = usePanels((s) => s.left);
  const rightHidden = usePanels((s) => s.right);
  const hasRight = workspace === "design" && !rightHidden;
  // How much of the canvas each panel covers: what floats over it keeps to the rest.
  const leftCover = leftHidden ? 0 : leftWidth;
  const rightCover = hasRight ? rightWidth : 0;
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

  // The tab reads the project first, so several open projects stay apart in the tab strip.
  useEffect(() => {
    document.title =
      configured && projectName
        ? `${projectName} · ultrapaint`
        : "ultrapaint";
  }, [configured, projectName]);

  // Index the design system in the background so prop controls are typed.
  useEffect(() => {
    if (configured) {
      bindDocuments();
      useDesignSystem.getState().load();
      useCatalogue.getState().load();
      useSpecs.getState().load();
      useImplementation.getState().load();
      provideDesignLook(designLook);
      // Agent events are followed from the start, not only while the chat is open: the badge
      // over the tool strip reports turns that changed files.
      useAgents.getState().bind();
      useComments.getState().bind();
      // The rail's Design system button says when the sync has something waiting.
      useSync.getState().load();
    }
  }, [configured]);

  // Comments are kept per canvas: opening another canvas reads its own.
  useEffect(() => {
    if (configured && canvas !== null) {
      useComments.getState().load(canvas);
    }
  }, [configured, canvas]);

  // Open the canvas and route the URL asks for, or the last one, or the first.
  useEffect(() => {
    if (!configured || canvases.length === 0 || canvas !== null) {
      return;
    }
    const url = readUrl();
    const saved = localStorage.getItem("ultrapaint:canvas");
    const ids = canvases.map((s) => s.id);
    // The designs directory's own canvas is named "", which the URL leaves out: a link with a
    // route and no canvas is a route of that canvas.
    const urlCanvas =
      url.canvas ??
      (ids.includes("") && (url.route !== "/" || url.page !== null)
        ? ""
        : null);
    let target = ids[0] ?? "";
    if (urlCanvas !== null && ids.includes(urlCanvas)) {
      target = urlCanvas;
    } else if (saved !== null && ids.includes(saved)) {
      target = saved;
    }
    useEditor
      .getState()
      .openCanvas(
        target,
        urlCanvas === target
          ? { page: url.page, route: url.route, variant: url.variant }
          : {}
      );
    // The canvas starts behind the panel, so the first view opens a margin past the panel's edge.
    useEditor.getState().setView({ x: leftCover + 80 });
  }, [configured, canvases, canvas, leftCover]);

  // Recompute frames when the page list changes for the open canvas; a canvas deleted while
  // open gives way to the first one left.
  useEffect(() => {
    if (canvas === null) {
      return;
    }
    const { activePage, frames, route, variant } = useEditor.getState();
    if (canvases.length > 0 && !canvases.some((c) => c.id === canvas)) {
      useEditor.getState().openCanvas(canvases[0]?.id ?? "");
      return;
    }
    const inCanvas = pages.filter((p) => p.canvas === canvas);
    const missing = inCanvas.some((p) => !frames[p.id]);
    const extra = Object.keys(frames).some(
      (id) => !inCanvas.find((p) => p.id === id)
    );
    if (missing || extra) {
      useEditor
        .getState()
        .openCanvas(canvas, { page: activePage, route, variant });
    } else {
      useEditor.getState().syncActivePage();
    }
  }, [pages, canvases, canvas]);

  // The browser's back and forward buttons are the prototype's.
  useEffect(() => {
    tidyUrl();
    return onUrlChange((url) => {
      const editor = useEditor.getState();
      if (url.canvas !== null && url.canvas !== editor.canvas) {
        editor.openCanvas(url.canvas, {
          page: url.page,
          route: url.route,
          variant: url.variant,
        });
      } else {
        if (url.variant !== editor.variant) {
          useEditor.setState({ variant: url.variant });
        }
        if (url.route === null) {
          if (url.page !== null) {
            editor.openPage(url.page, { push: false });
          }
        } else {
          editor.navigate(url.route, { push: false });
        }
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
          <Suspense fallback={null}>
            <SettingsPage />
          </Suspense>
        ) : (
          <div className="relative flex min-h-0 flex-1">
            <Rail />
            <LeftPanel
              defaultWidth={leftPanel.defaultWidth}
              onWidthChange={setLeftWidth}
              width={leftWidth}
            />
            {/* The covers are handed down as variables, for what centres itself on the canvas. */}
            <main
              className="relative min-w-0 flex-1"
              style={
                {
                  "--cover-left": `${leftCover}px`,
                  "--cover-right": `${rightCover}px`,
                } as CSSProperties
              }
            >
              {workspace !== "prototype" && <Canvas />}
              {/* What floats over the canvas belongs in the part the panels leave to be seen, and
                so does the prototype, which is centred rather than panned. */}
              <div
                className="pointer-events-none absolute inset-y-0"
                style={{ left: leftCover, right: rightCover }}
              >
                {workspace === "prototype" && <Prototype />}
                <WorkspaceSwitcher />
                <CanvasStatus />
                <SnapshotBanner />
                <div className="absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2">
                  {workspace === "prototype" ? <PrototypeBar /> : <Toolbar />}
                </div>
              </div>
            </main>
            {hasRight ? (
              <RightPanel onWidthChange={setRightWidth} width={rightWidth} />
            ) : null}
          </div>
        )}
        <SaveConfigDialog />
        <SetupDialog />
        <DialogHost />
        <ShortcutSheet />
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
