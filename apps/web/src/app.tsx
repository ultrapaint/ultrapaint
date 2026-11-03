import { cn } from "cn";
import {
  type ComponentType,
  type CSSProperties,
  Suspense,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Canvas } from "./canvas/canvas.tsx";
import { placedFramesDrawn } from "./canvas/editor-frame.ts";
import { IsolationBanner } from "./canvas/isolation-banner.tsx";
import { thePreview } from "./canvas/preview-module.ts";
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
import { preloadMarkdown } from "./components/markdown.tsx";
import { NewDesignDialog } from "./components/new-design-dialog.tsx";
import { Rail, railItems } from "./components/rail.tsx";
import { RemoteProjectDialog } from "./components/remote-project-dialog.tsx";
import { ResizeHandle, usePanelWidth } from "./components/resize-handle.tsx";
import { SetupDialog } from "./components/setup-dialog.tsx";
import { ShellNotices } from "./components/shell-notices.tsx";
import { ShortcutSheet } from "./components/shortcut-sheet.tsx";
import { PanelLoading, Splash } from "./components/splash.tsx";
import {
  EDGE,
  RightPanelBar,
  TitleCard,
  TopActions,
} from "./components/title-bar.tsx";
import { deferred } from "./lib/deferred.ts";
import { useKeymap } from "./lib/keymap.ts";
import { openNewDesignOnSync } from "./lib/new-design.ts";
import { useOpenNodeLink } from "./lib/open-node-link.ts";
import { CanvasCard } from "./panels/canvases.tsx";
import { CodePanel } from "./panels/code.tsx";
import { Inspector } from "./panels/inspector.tsx";
import { SaveConfigDialog } from "./panels/save-config.tsx";
import { Threads } from "./panels/threads.tsx";
import {
  followBoardHistory,
  openBoardInUrl,
  startBoardView,
  useBoard,
} from "./state/board.ts";
import { setView } from "./state/camera.ts";
import { startCanvasPicks } from "./state/canvas-picks.ts";
import { useComments } from "./state/comments.ts";
import { useComponents } from "./state/components.ts";
import { useDesignSystem } from "./state/design-system.ts";
import { useDocuments } from "./state/documents.ts";
import {
  type LeftTab,
  type RightTab,
  useEditor,
  type Workspace,
} from "./state/editor.ts";
import { useImplementation } from "./state/implementation.ts";
import { startIsolation } from "./state/isolation.ts";
import {
  followHistory,
  openStartCanvas,
  pagesChanged,
} from "./state/location.ts";
import { followLook } from "./state/look.ts";
import { canvasDefaults } from "./state/page-layout.ts";
import { startRightPanel, usePanels } from "./state/panels.ts";
import { reportError, useProject } from "./state/project.ts";
import { bindScreenshots } from "./state/screenshots.ts";
import { followServer } from "./state/server-data.ts";
import { useSurface } from "./state/surface.ts";
import { useSync } from "./state/sync.ts";
import { useWindowChrome } from "./state/window-controls.ts";

/*
 * Each in a file of its own, apart from the editor's first bundle, and all fetched while the
 * splash is up (`preloadPanels`): the editor shows itself once they are in, and a panel then opens
 * at once.
 */
const boardCanvasPanel = deferred(() =>
  import("./canvas/board-canvas.tsx").then((m) => m.BoardCanvas)
);
const boardInspectorPanel = deferred(() =>
  import("./panels/board-inspector.tsx").then((m) => m.BoardInspector)
);
const changesPanel = deferred(() =>
  import("./panels/changes.tsx").then((m) => m.Changes)
);
const commentsPanel = deferred(() =>
  import("./panels/comments.tsx").then((m) => m.Comments)
);
const designSystemListPanel = deferred(() =>
  import("./panels/design-system-list.tsx").then((m) => m.DesignSystemList)
);
const layersPanel = deferred(() =>
  import("./panels/layers.tsx").then((m) => m.Layers)
);
const libraryPanel = deferred(() =>
  import("./panels/library.tsx").then((m) => m.Library)
);
const pagesPanel = deferred(() =>
  import("./panels/pages.tsx").then((m) => m.Pages)
);
const settingsPanel = deferred(() =>
  import("./panels/settings.tsx").then((m) => m.SettingsPage)
);

/** Fetches every panel's code; done when all are in, or failed (a panel then loads when opened). */
const preloadPanels = () =>
  Promise.allSettled([
    ...[
      boardCanvasPanel,
      boardInspectorPanel,
      changesPanel,
      commentsPanel,
      designSystemListPanel,
      layersPanel,
      libraryPanel,
      pagesPanel,
      settingsPanel,
    ].map((panel) => panel.preload()),
    preloadMarkdown(),
  ]);

const BoardCanvas = boardCanvasPanel.Component;
const BoardInspector = boardInspectorPanel.Component;
const Changes = changesPanel.Component;
const Comments = commentsPanel.Component;
const DesignSystemList = designSystemListPanel.Component;
const Layers = layersPanel.Component;
const Library = libraryPanel.Component;
const Pages = pagesPanel.Component;
const SettingsPage = settingsPanel.Component;

/** How long the splash waits at most: a server that does not answer leaves the editor to say so. */
const SPLASH_LIMIT_MS = 10_000;

/** How long the splash waits for the frames on screen, once everything else is in. */
const FRAMES_LIMIT_MS = 2000;

/** Whether the project is read and the designs of the canvas it opens on are in. */
const designsIn = () => {
  const { canvases, info, loaded } = useProject.getState();
  const { canvas } = useEditor.getState();
  return (
    loaded &&
    (!info.configured ||
      canvases.length === 0 ||
      (canvas !== null && useDocuments.getState().loaded))
  );
};

/**
 * Whether the frames on screen have drawn their designs. Only the page canvas has frames to wait
 * for: the prototype, a board view and the settings draw their own.
 */
const framesIn = () => {
  const { pages, settingsOpen } = useProject.getState();
  const { canvas, workspace } = useEditor.getState();
  if (
    settingsOpen ||
    workspace === "prototype" ||
    useBoard.getState().open !== null ||
    !pages.some((page) => page.canvas === canvas)
  ) {
    return true;
  }
  const frames = placedFramesDrawn();
  return frames.placed > 0 && frames.drawn;
};

/**
 * The splash, until the editor is ready to be shown whole: every panel's code fetched, the designs
 * in and the frames on screen drawn. Once gone it stays gone: a canvas opened later reads its
 * designs under the editor.
 */
const StartSplash = () => {
  const name = useProject((s) =>
    s.info.configured ? (s.info.name ?? null) : null
  );
  const [started, setStarted] = useState(false);
  useEffect(() => {
    let panels = false;
    // When the rest was in: a canvas whose frames are all off screen does not hold the splash.
    let inSince: number | null = null;
    // Looked at once a frame while the splash is up: the frames say when they draw, not to whom.
    let frame = requestAnimationFrame(function check(now) {
      if (panels && designsIn()) {
        inSince ??= now;
        if (framesIn() || now - inSince > FRAMES_LIMIT_MS) {
          setStarted(true);
          return;
        }
      }
      frame = requestAnimationFrame(check);
    });
    preloadPanels().then(() => {
      panels = true;
    });
    const limit = setTimeout(() => setStarted(true), SPLASH_LIMIT_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(limit);
    };
  }, []);
  return started ? null : <Splash name={name} />;
};

/** What each left panel of the canvas shows; its title and icon are the rail's. */
const leftPanels: Record<LeftTab, ComponentType> = {
  changes: Changes,
  chat: Threads,
  designSystem: DesignSystemList,
  layers: Layers,
  library: Library,
};

/** The left panels with a heading of their own. */
const headsItself: readonly LeftTab[] = [
  "chat",
  "layers",
  "designSystem",
  "library",
];

const leftBounds = { defaultWidth: 288, max: 480, min: 200 };
/** A conversation reads better wide; switching to any other panel caps the width again. */
const chatBounds = { ...leftBounds, defaultWidth: 340, max: 960 };
const rightBounds = { defaultWidth: 320, max: 560, min: 240 };

/** The rail's width with the card's borders, which the cards above span with the left panel. */
const RAIL_WIDTH = 70;

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
        {/* The chat heads itself, its list and each thread; the pages, the layers, Design system
          and the Library have their own actions in their heading. */}
        {prototype || headsItself.includes(leftTab) ? null : (
          <div className="flex h-9 shrink-0 items-center px-3 font-heading-xsmall">
            {railItems[leftTab].label}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={<PanelLoading />}>
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
  const surface = useSurface();
  const board = useBoard((s) => s.open);
  const handle = (
    <ResizeHandle
      defaultWidth={rightBounds.defaultWidth}
      onWidthChange={onWidthChange}
      side="right"
      width={width}
    />
  );
  // On a board view, the inspector of what it shows (ADR 0045), in the tabs' place.
  if (surface.rightPanel === "inspector" && board) {
    return (
      <aside
        className="floating pointer-events-auto relative flex min-h-0 flex-1 flex-col"
        data-canvas-cover="right"
        style={{ width }}
      >
        <Suspense fallback={<PanelLoading />}>
          <BoardInspector open={board} />
        </Suspense>
        {handle}
      </aside>
    );
  }
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
        </div>
        {/* Only the open tab is mounted: the code is written out only while it is read. */}
        <TabsContent className="min-h-0 overflow-auto" value="design">
          <Inspector />
        </TabsContent>
        <TabsContent className="min-h-0 overflow-auto" value="code">
          <CodePanel />
        </TabsContent>
        <TabsContent className="min-h-0 overflow-auto" value="comments">
          <Suspense fallback={<PanelLoading />}>
            <Comments />
          </Suspense>
        </TabsContent>
      </Tabs>
      {handle}
    </aside>
  );
};

/**
 * The window's right column, floating over the canvas: the top actions, the right panel's row
 * (its layer and its toggle) and the panel when it is out.
 */
const RightColumn = ({
  hasRight,
  onWidthChange,
  shown,
  width,
}: {
  hasRight: boolean;
  onWidthChange: (width: number) => void;
  /** Whether the workspace has a right panel at all: the prototype has none. */
  shown: boolean;
  width: number;
}) => (
  <div
    className="pointer-events-none absolute z-30 flex flex-col items-end gap-2"
    style={{ bottom: EDGE, right: EDGE, top: EDGE }}
  >
    <TopActions />
    {shown ? <RightPanelBar width={hasRight ? width : null} /> : null}
    {hasRight ? (
      <RightPanel onWidthChange={onWidthChange} width={width} />
    ) : null}
  </div>
);

/**
 * The settings, a dialog over the editor with their sections down its side (as T3 Code has
 * them): the editor stays as it was under it. Escape, the close button or Cancel close it.
 */
const SettingsDialog = () => {
  const open = useProject((s) => s.settingsOpen);
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          useProject.getState().openSettings(false);
        }
      }}
      open={open}
    >
      <DialogContent
        className="flex h-[min(100%-4rem,60rem)] w-[min(100%-4rem,84rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <Suspense fallback={<PanelLoading />}>
          <SettingsPage />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
};

export const App = () => {
  const error = useProject((s) => s.error);
  const configured = useProject((s) => s.info.configured);
  const projectName = useProject((s) => s.info.name);
  const pages = useProject((s) => s.pages);
  const canvases = useProject((s) => s.canvases);
  const canvas = useEditor((s) => s.canvas);
  const workspace = useEditor((s) => s.workspace);
  const leftTab = useEditor((s) => s.leftTab);
  const board = useBoard((s) => s.open);
  const surface = useSurface();
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
  useKeymap();
  useOpenNodeLink();

  // The server's data, read at every connection open and followed in between.
  useEffect(() => followServer({ report: reportError }), []);
  useEffect(() => bindScreenshots(), []);

  // The tab reads the project first, so several open projects stay apart in the tab strip.
  useEffect(() => {
    document.title =
      configured && projectName ? `${projectName} · Ultrapaint` : "Ultrapaint";
  }, [configured, projectName]);

  // Index the design system in the background so prop controls are typed.
  useEffect(() => {
    if (configured) {
      useDesignSystem.getState().load();
      useComponents.getState().load();
      useImplementation.getState().load();
      provideCanvasDefaults(canvasDefaults);
      // The rail's Design system button says when the sync has something waiting.
      useSync.getState().load();
      // A design the desktop app has just written opens on Sync's define step.
      openNewDesignOnSync();
    }
  }, [configured]);

  // The design's look, set once on the preview whenever it changes (ADR 0042).
  useEffect(
    () => (configured ? followLook(thePreview()) : undefined),
    [configured]
  );

  // Comments are kept per canvas: opening another canvas reads its own.
  useEffect(() => {
    if (configured && canvas !== null) {
      useComments.getState().load(canvas);
    }
  }, [configured, canvas]);

  // The canvas the URL names, or the last one, or the first; the first view opens a margin past
  // the panel's edge, as the canvas starts behind it. A board view the URL names opens over it,
  // the page's camera put aside as it was set.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the canvases known and the one open decide.
  useEffect(() => {
    if (configured && openStartCanvas()) {
      setView({ x: leftCover + 80 });
      openBoardInUrl();
    }
  }, [configured, canvases, canvas, leftCover]);

  // The page list changed: the editor stays where it was, or gives way when that is gone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list and the canvas are the news.
  useEffect(() => pagesChanged(), [pages, canvases, canvas]);

  // The browser's back and forward buttons are the prototype's, and the board views'.
  useEffect(() => followHistory(), []);
  useEffect(() => followBoardHistory(), []);
  // What follows the editor's other stores: a board view gives way to the prototype, an app
  // component edited in place to another canvas.
  useEffect(() => startBoardView(), []);
  useEffect(() => startRightPanel(), []);
  useEffect(() => startCanvasPicks(), []);
  useEffect(() => startIsolation(), []);

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
      <StartSplash />
      <div className="flex h-full flex-col">
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
            {workspace !== "prototype" && surface.kind === "page" && <Canvas />}
            {workspace !== "prototype" && board !== null && (
              <Suspense
                fallback={<div className="absolute inset-0 bg-board" />}
              >
                <BoardCanvas open={board} />
              </Suspense>
            )}
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
              {workspace === "prototype" ? null : <IsolationBanner />}
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
          <RightColumn
            hasRight={hasRight}
            onWidthChange={setRightWidth}
            shown={workspace === "design"}
            width={rightWidth}
          />
        </div>
        <SettingsDialog />
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
