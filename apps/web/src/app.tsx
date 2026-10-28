import { cn } from "cn";
import {
  type ComponentType,
  type CSSProperties,
  lazy,
  Suspense,
  useEffect,
  useRef,
} from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Canvas } from "./canvas/canvas.tsx";
import { provideDesignLook } from "./canvas/editor-frame.ts";
import {
  NoUrlWarning,
  Prototype,
  PrototypeBar,
  PrototypeTools,
} from "./canvas/prototype.tsx";
import { SnapshotBanner } from "./canvas/snapshot-banner.tsx";
import { provideCanvasDefaults } from "./canvas/specimens.ts";
import { CanvasStatus } from "./canvas/status.tsx";
import { Toolbar, ZoomControl } from "./canvas/toolbar.tsx";
import { CommandPalette } from "./components/command-palette.tsx";
import { ContextMenuHost } from "./components/context-menu-host.tsx";
import { DialogHost } from "./components/dialogs.tsx";
import { NewDesignDialog } from "./components/new-design-dialog.tsx";
import { Rail, railItems } from "./components/rail.tsx";
import { RemoteProjectDialog } from "./components/remote-project-dialog.tsx";
import { ResizeHandle, usePanelWidth } from "./components/resize-handle.tsx";
import { SetupDialog } from "./components/setup-dialog.tsx";
import { ShellNotices } from "./components/shell-notices.tsx";
import { ShortcutSheet } from "./components/shortcut-sheet.tsx";
import {
  EDGE,
  HideRightPanel,
  TitleCard,
  TopActions,
} from "./components/title-bar.tsx";
import { openNewDesignOnSync } from "./lib/new-design.ts";
import { useOpenNodeLink } from "./lib/open-node-link.ts";
import { useShortcuts } from "./lib/shortcuts.ts";
import { CanvasCard } from "./panels/canvases.tsx";
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
  canvasDefaults,
  type LeftTab,
  type RightTab,
  useEditor,
  type Workspace,
} from "./state/editor.ts";
import { useImplementation } from "./state/implementation.ts";
import { designLook } from "./state/look.ts";
import { usePanels } from "./state/panels.ts";
import { bindProjectEvents, useProject } from "./state/project.ts";
import { bindScreenshots } from "./state/screenshots.ts";
import { useSpecs } from "./state/specs.ts";
import { useSync } from "./state/sync.ts";
import { onUrlChange, readUrl, tidyUrl, writeMode } from "./state/url.ts";
import { useWindowChrome } from "./state/window-controls.ts";

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

/** What each left panel of the canvas shows; its title and icon are the rail's. */
const leftPanels: Record<LeftTab, ComponentType> = {
  assets: Assets,
  changes: Changes,
  chat: Threads,
  designSystem: DesignSystemPanel,
  layers: Layers,
};

const leftBounds = { defaultWidth: 288, max: 480, min: 200 };
/** A conversation reads better wide; switching to any other panel caps the width again. */
const chatBounds = { ...leftBounds, defaultWidth: 340, max: 960 };
const rightBounds = { defaultWidth: 320, max: 560, min: 240 };

/** The rail's width with the card's borders, which the cards above span with the left panel. */
const RAIL_WIDTH = 64;

/**
 * The rest of the rail's card, beside the rail, floating over the canvas instead of pushing it: widening it
 * covers more of the canvas and never moves what is drawn on it. Put away, it stays mounted and
 * hidden: the chat it holds keeps its place and what was being written in it.
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
  const prototype = useEditor((s) => s.workspace === "prototype");
  const hidden = usePanels((s) => s.left);
  // Only the active panel is mounted: panels subscribe to server events while visible. The
  // prototype has no rail and one panel, its pages.
  const Active = prototype ? Pages : leftPanels[leftTab];
  return (
    <aside
      className={cn(
        "relative shrink-0",
        prototype ? "rounded-[inherit]" : "rounded-r-[inherit] border-l",
        hidden ? "hidden" : "flex"
      )}
      style={{ width }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
        {/* The chat heads itself, its list and each thread; the pages and the layers have their
          own actions in their heading. */}
        {prototype || leftTab === "chat" || leftTab === "layers" ? null : (
          <div className="flex h-9 shrink-0 items-center px-3 font-heading-xsmall">
            {railItems[leftTab].label}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={null}>
            <Active />
          </Suspense>
        </div>
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

/** The left card's width: the rail, on the canvas only, and the panel when it is out. */
const leftCardWidth = (
  workspace: Workspace,
  hidden: boolean,
  panelWidth: number
) => (workspace === "design" ? RAIL_WIDTH : 0) + (hidden ? 0 : panelWidth);

/** The width of the prototype's column of tools, which the page it shows keeps clear of. */
const PROTOTYPE_TOOLS = 42;

/**
 * How much of the canvas the left column covers, for what floats over it to keep to the rest: its
 * card, and in the prototype the tools beside it, each with the gap after it.
 */
const leftCoverOf = (workspace: Workspace, card: number) => {
  const parts = [card, workspace === "prototype" ? PROTOTYPE_TOOLS : 0].filter(
    (w) => w > 0
  );
  return parts.reduce((sum, w) => sum + w + EDGE, EDGE);
};

/**
 * The rail and the left panel, one card, the rail at its left edge. The prototype has no rail:
 * with its panel put away, there is no card.
 */
const LeftCard = (props: {
  defaultWidth: number;
  width: number;
  onWidthChange: (width: number) => void;
}) => {
  const workspace = useEditor((s) => s.workspace);
  const hidden = usePanels((s) => s.left);
  if (workspace === "prototype" && hidden) {
    return null;
  }
  return (
    <div className="floating pointer-events-auto flex shrink-0">
      {workspace === "design" ? <Rail /> : null}
      <LeftPanel {...props} />
    </div>
  );
};

const onRightTabChange = (value: unknown) =>
  useEditor.getState().setRightTab(value as RightTab);

/**
 * Floats over the canvas's right edge, under the actions, as the left panel does over its left
 * one: the canvas is the same size whichever panels are out, and opening this one never moves
 * what is drawn on it.
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
      className="floating pointer-events-auto relative flex min-h-0 flex-1 flex-col"
      data-canvas-cover="right"
      style={{ width }}
    >
      <Tabs
        className="min-h-0 flex-1 gap-0 overflow-hidden rounded-[inherit]"
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
            <TabsTrigger className="font-body" value="comments">
              Comments
            </TabsTrigger>
          </TabsList>
          <div className="ml-auto">
            <HideRightPanel />
          </div>
        </div>
        {/* Only the open tab is mounted: the code is written out only while it is read. */}
        <TabsContent className="min-h-0 overflow-auto" value="design">
          <Inspector />
        </TabsContent>
        <TabsContent className="min-h-0 overflow-auto" value="code">
          <CodePanel />
        </TabsContent>
        <TabsContent className="min-h-0 overflow-auto" value="comments">
          <Suspense fallback={null}>
            <Comments />
          </Suspense>
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
  const leftPanel =
    workspace === "design" && leftTab === "chat" ? chatBounds : leftBounds;
  const [leftWidth, setLeftWidth] = usePanelWidth("left", leftPanel);
  const [rightWidth, setRightWidth] = usePanelWidth("right", rightBounds);
  const leftHidden = usePanels((s) => s.left);
  const rightHidden = usePanels((s) => s.right);
  const hasRight = workspace === "design" && !rightHidden;
  const chrome = useWindowChrome();
  const leftCard = leftCardWidth(workspace, leftHidden, leftWidth);
  // How much of the canvas the cards at each side cover: what floats over it keeps to the rest.
  const leftCover = leftCoverOf(workspace, leftCard);
  // The title and canvas cards span the left card when its panel is out.
  const titleWidth = leftHidden ? null : leftCard;
  const rightCover = hasRight ? EDGE + rightWidth + EDGE : 0;
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
      provideCanvasDefaults(canvasDefaults);
      // Agent events are followed from the start, not only while the chat is open: the badge
      // over the tool strip reports turns that changed files.
      useAgents.getState().bind();
      useComments.getState().bind();
      // The rail's Design system button says when the sync has something waiting.
      useSync.getState().load();
      // A design the desktop app has just written opens on Sync's define step.
      openNewDesignOnSync();
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
          <div className="relative min-h-0 flex-1">
            {/* The covers are handed down as variables, for what centres itself on the canvas. */}
            <main
              className="absolute inset-0"
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
                <ShellNotices />
                <CanvasStatus />
                <SnapshotBanner />
                {workspace === "prototype" ? (
                  <div className="absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2">
                    <NoUrlWarning />
                  </div>
                ) : (
                  <div className="absolute right-2 bottom-2 z-10">
                    <ZoomControl />
                  </div>
                )}
              </div>
            </main>
            {/* The top of a desktop window with no title bar of its own moves it, between the cards. */}
            {chrome.drag ? (
              <div
                className="window-drag absolute inset-x-0 top-0 z-20"
                style={{ height: EDGE }}
              />
            ) : null}
            {/* The left column: the project over the rail and the left panel, and the tools beside
              them. Only the cards take the pointer; between them is the canvas. */}
            <div
              className="pointer-events-none absolute z-30 flex flex-col gap-2"
              data-canvas-cover="left"
              style={{ bottom: EDGE, left: EDGE, top: EDGE }}
            >
              <TitleCard width={titleWidth} />
              <CanvasCard width={titleWidth} />
              <div className="flex min-h-0 flex-1 gap-2">
                <LeftCard
                  defaultWidth={leftPanel.defaultWidth}
                  onWidthChange={setLeftWidth}
                  width={leftWidth}
                />
                {workspace === "design" ? (
                  <div className="self-start">
                    <Toolbar />
                  </div>
                ) : (
                  // The prototype's bar sits at the bottom of its tools, wider than their column.
                  <div className="flex flex-col items-start justify-between">
                    <PrototypeTools />
                    <PrototypeBar />
                  </div>
                )}
              </div>
            </div>
            <div
              className="pointer-events-none absolute z-30 flex flex-col items-end gap-2"
              style={{ bottom: EDGE, right: EDGE, top: EDGE }}
            >
              <TopActions />
              {hasRight ? (
                <RightPanel onWidthChange={setRightWidth} width={rightWidth} />
              ) : null}
            </div>
          </div>
        )}
        <SaveConfigDialog />
        <SetupDialog />
        <NewDesignDialog />
        <RemoteProjectDialog />
        <DialogHost />
        <ShortcutSheet />
        <CommandPalette />
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
