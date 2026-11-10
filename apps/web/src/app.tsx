import {
  type ComponentType,
  type CSSProperties,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { Canvas } from "./canvas/canvas.tsx";
import { placedFramesDrawn } from "./canvas/editor-frame.ts";
import { IsolationBanner } from "./canvas/isolation-banner.tsx";
import { thePreview } from "./canvas/preview-module.ts";
import { Prototype } from "./canvas/prototype.tsx";
import { SelectionDockSlot } from "./canvas/selection-dock.tsx";
import { SnapshotBanner } from "./canvas/snapshot-banner.tsx";
import { provideCanvasDefaults } from "./canvas/specimens.ts";
import { CanvasStatus } from "./canvas/status.tsx";
import { Toolbar } from "./canvas/toolbar.tsx";
import { CommandPalette } from "./components/command-palette.tsx";
import { ContextMenuHost } from "./components/context-menu-host.tsx";
import { DialogHost } from "./components/dialogs.tsx";
import { preloadMarkdown } from "./components/markdown.tsx";
import { PlaceSwitch } from "./components/place-switch.tsx";
import { Rail } from "./components/rail.tsx";
import { RemoteProjectDialog } from "./components/remote-project-dialog.tsx";
import { ResizeHandle, usePanelWidth } from "./components/resize-handle.tsx";
import { ShellNotices } from "./components/shell-notices.tsx";
import { ShortcutSheet } from "./components/shortcut-sheet.tsx";
import { PanelLoading, Splash } from "./components/splash.tsx";
import {
  EDGE,
  HideRightPanel,
  RightPanelBar,
  TitleRow,
} from "./components/title-bar.tsx";
import { deferred } from "./lib/deferred.ts";
import { sendFirstPrompt, takeFirstPrompt } from "./lib/first-prompt.ts";
import { useKeymap } from "./lib/keymap.ts";
import { openLookPage, startLookPage } from "./lib/look-page.ts";
import { useOpenNodeLink } from "./lib/open-node-link.ts";
import { CanvasPicker } from "./panels/canvases.tsx";
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
import { usePanels, useRightSubject } from "./state/panels.ts";
import { reportError, useProject } from "./state/project.ts";
import { bindScreenshots } from "./state/screenshots.ts";
import { followServer } from "./state/server-data.ts";
import { useSurface } from "./state/surface.ts";
import { useSync } from "./state/sync.ts";
import { useTheme } from "./state/theme.ts";
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
const routesPanel = deferred(() =>
  import("./panels/routes.tsx").then((m) => m.Routes)
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
      routesPanel,
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
const Routes = routesPanel.Component;
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
  comments: Comments,
  designSystem: DesignSystemList,
  layers: Layers,
  library: Library,
};

const leftBounds = { defaultWidth: 288, max: 480, min: 200 };
/** A conversation reads better wide; switching to any other panel caps the width again. */
const chatBounds = { ...leftBounds, defaultWidth: 340, max: 960 };
const rightBounds = { defaultWidth: 320, max: 560, min: 240 };

/** The rail's width with its hairline. */
const RAIL_WIDTH = 44;

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
  // prototype has no rail and one panel, its routes (ADR 0075).
  const Active = prototype ? Routes : leftPanels[leftTab];
  return (
    <aside
      className={cn("relative min-w-0 shrink-0", hidden ? "hidden" : "flex")}
      style={{ width }}
    >
      {/* The panel is raised inside the card's frame, flush with the card's own edges: a hairline
          only where it meets the frame, so no edge is drawn twice. */}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t bg-sidebar",
          prototype ? null : "rounded-tl-lg border-l"
        )}
      >
        {/* The chat heads itself, its list and each thread; the pages, the layers, Design system
          and the Library have their own actions in their heading. */}
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

/** How much of the canvas the left card covers, with the gaps on either side of it. */
const leftCoverOf = (card: number) => (card > 0 ? EDGE + card + EDGE : EDGE);

/**
 * The left card: the project at its top, the canvas shown, then the rail and the left panel side
 * by side. Put away, the panel takes the rail and the canvas with it, and the card is the project's
 * row alone. The prototype has no rail.
 */
const LeftCard = (props: {
  defaultWidth: number;
  width: number;
  onWidthChange: (width: number) => void;
}) => {
  const workspace = useEditor((s) => s.workspace);
  const hidden = usePanels((s) => s.left);
  const width = leftCardWidth(workspace, hidden, props.width);
  return (
    <div
      className={cn(
        "floating pointer-events-auto flex flex-col overflow-hidden bg-rail",
        hidden ? "self-start" : "min-h-0 flex-1"
      )}
      style={hidden ? undefined : { width }}
    >
      <TitleRow />
      {hidden ? null : (
        <>
          <CanvasPicker />
          <div className="flex min-h-0 flex-1">
            {workspace === "design" ? <Rail /> : null}
            <LeftPanel {...props} />
          </div>
        </>
      )}
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
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b pr-1.5 pl-1.5">
          <TabsList className="h-8!" variant="default">
            <TabsTrigger className="px-2.5" value="design">
              Design
            </TabsTrigger>
            <TabsTrigger className="px-2.5" value="code">
              Code
            </TabsTrigger>
          </TabsList>
          <HideRightPanel />
        </div>
        {/* Only the open tab is mounted: the code is written out only while it is read. */}
        <TabsContent className="min-h-0 overflow-auto" value="design">
          <Inspector />
        </TabsContent>
        <TabsContent className="min-h-0 overflow-auto" value="code">
          <CodePanel />
        </TabsContent>
      </Tabs>
      {handle}
    </aside>
  );
};

const RIGHT_TAB_NAMES: Record<RightTab, string> = {
  code: "Code",
  design: "Design",
};

/** The right panel's name while it is put away: its open tab, or a board view's inspector. */
const useRightPanelName = () => {
  const rightTab = useEditor((s) => s.rightTab);
  const surface = useSurface();
  const board = useBoard((s) => s.open);
  return surface.rightPanel === "inspector" && board
    ? "Inspector"
    : RIGHT_TAB_NAMES[rightTab];
};

const RightPanelPutAway = () => <RightPanelBar name={useRightPanelName()} />;

/**
 * The window's right column, floating over the canvas: the top actions, the right panel's row
 * (its layer and its toggle) and the panel when it is out.
 */
const RightColumn = ({
  hasRight,
  onWidthChange,
  putAway,
  width,
}: {
  hasRight: boolean;
  onWidthChange: (width: number) => void;
  /** Put away by the user while there is something to show in it: its bar alone. */
  putAway: boolean;
  width: number;
}) => (
  <div
    className="pointer-events-none absolute z-30 flex flex-col items-end gap-2"
    style={{ bottom: EDGE, right: EDGE, top: EDGE }}
  >
    {putAway ? <RightPanelPutAway /> : null}
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
  // The focus starts on the dialog itself, so nothing is ringed at rest; Tab then lands on the
  // section shown, the one section the sidebar lets Tab reach.
  const popup = useRef<HTMLDivElement>(null);
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
        className="flex h-[min(100%-4rem,46rem)] w-[min(100%-4rem,60rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
        initialFocus={popup}
        ref={popup}
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
  const theme = useTheme((s) => s.resolved);
  const error = useProject((s) => s.error);
  const configured = useProject((s) => s.info.configured);
  const loaded = useProject((s) => s.loaded);
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
  // With nothing selected there is no right panel at all (ADR 0058); `subject` says the canvas.
  const subject = useRightSubject();
  const hasRight = subject && !rightHidden;
  const chrome = useWindowChrome();
  const leftCard = leftCardWidth(workspace, leftHidden, leftWidth);
  // How much of the canvas the cards at each side cover: what floats over it keeps to the rest.
  const leftCover = leftCoverOf(leftCard);
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
    }
  }, [configured]);

  // Once the project's info is read (ADR 0062): the start screen's prompt in a chat. A folder
  // opened for the first time is not set up on its own; a new chat suggests it (ADR 0073).
  useEffect(() => {
    if (loaded) {
      const start = takeFirstPrompt();
      sendFirstPrompt(start, openLookPage);
    }
  }, [loaded]);

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
  // component edited in place to another canvas, the look page's trial to another board.
  useEffect(() => startBoardView(), []);
  useEffect(() => startCanvasPicks(), []);
  useEffect(() => startIsolation(), []);
  useEffect(() => startLookPage(), []);

  // Errors surface as toasts; the store slot is only a hand-off from non-React code.
  useEffect(() => {
    if (!error) {
      return;
    }
    // The error says what happened, in the title; the rest of a long one below it.
    const [first = error, ...rest] = error.split("\n");
    toast.error(first, {
      ...(rest.length > 0 ? { description: rest.join("\n") } : {}),
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
            </div>
            {/* Centred on the window, as the place switch is: the right panel comes and goes
                with the selection, and the tools stay where they are. */}
            {workspace === "prototype" ? null : (
              <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex flex-col items-center gap-2">
                <SelectionDockSlot />
                <Toolbar />
              </div>
            )}
          </main>
          {/* The top of a desktop window with no title bar of its own moves it, between the cards. */}
          {chrome.drag ? (
            <div
              className="window-drag absolute inset-x-0 top-0 z-20"
              style={{ height: EDGE }}
            />
          ) : null}
          {/* Where the user is, centred on the window so it never moves from place to place. */}
          <div
            className="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
            style={{ top: EDGE }}
          >
            <PlaceSwitch />
          </div>
          {/* The left column: the left card, and in the prototype its tools beside it. Only the
              cards take the pointer; between them is the canvas. */}
          <div
            className="pointer-events-none absolute z-30 flex flex-col"
            data-canvas-cover="left"
            style={{ bottom: EDGE, left: EDGE, top: EDGE }}
          >
            <div className="flex min-h-0 flex-1 gap-2">
              <LeftCard
                defaultWidth={leftPanel.defaultWidth}
                onWidthChange={setLeftWidth}
                width={leftWidth}
              />
            </div>
          </div>
          <RightColumn
            hasRight={hasRight}
            onWidthChange={setRightWidth}
            putAway={subject && rightHidden}
            width={rightWidth}
          />
        </div>
        <SettingsDialog />
        <SaveConfigDialog />
        <RemoteProjectDialog />
        <DialogHost />
        <ShortcutSheet />
        <CommandPalette />
        <ContextMenuHost />
        <Toaster
          closeButton
          position="bottom-right"
          theme={theme}
          toastOptions={{
            classNames: {
              description:
                "whitespace-pre-wrap font-body-small text-muted-foreground!",
              title: "font-body-medium",
              toast: "font-body shadow-overlay!",
            },
          }}
        />
      </div>
    </TooltipProvider>
  );
};
