import { cn } from "cn";
import {
  GitBranch,
  GitCompareArrows,
  Layers as LayersIcon,
  type LucideIcon,
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
import { installBridgeRouter } from "./canvas/bridge.ts";
import { Canvas } from "./canvas/canvas.tsx";
import { CanvasStatus } from "./canvas/status.tsx";
import { Toolbar } from "./canvas/toolbar.tsx";
import { DialogHost } from "./components/dialogs.tsx";
import { IconButton } from "./components/icon-button.tsx";
import { ResizeHandle, usePanelWidth } from "./components/resize-handle.tsx";
import { useShortcuts } from "./lib/shortcuts.ts";
import { Changes } from "./panels/changes.tsx";
import { Inspector } from "./panels/inspector.tsx";
import { Layers } from "./panels/layers.tsx";
import { Palette } from "./panels/palette.tsx";
import { SaveConfigDialog } from "./panels/save-config.tsx";
import { Screens } from "./panels/screens.tsx";
import { SettingsDialog } from "./panels/settings.tsx";
import { Threads } from "./panels/threads.tsx";
import { useCatalogue } from "./state/catalogue.ts";
import { useConnection } from "./state/connection.ts";
import { useEditor } from "./state/editor.ts";
import { bindProjectEvents, useProject } from "./state/project.ts";

installBridgeRouter();

type EditorState = ReturnType<typeof useEditor.getState>;
type LeftTab = EditorState["leftTab"];

const leftTabs: {
  value: LeftTab;
  label: string;
  icon: LucideIcon;
  panel: ComponentType;
}[] = [
  { icon: MessageSquare, label: "Chat", panel: Threads, value: "chat" },
  { icon: LayersIcon, label: "Layers", panel: Layers, value: "layers" },
  { icon: Shapes, label: "Components", panel: Palette, value: "palette" },
  {
    icon: MonitorSmartphone,
    label: "Screens",
    panel: Screens,
    value: "screens",
  },
  {
    icon: GitCompareArrows,
    label: "Changes",
    panel: Changes,
    value: "changes",
  },
];

const leftBounds = { defaultWidth: 256, max: 480, min: 200 };
const rightBounds = { defaultWidth: 288, max: 560, min: 240 };

const RailButton = ({ tab }: { tab: (typeof leftTabs)[number] }) => {
  const active = useEditor((s) => s.leftTab === tab.value);
  const onClick = () => useEditor.getState().setLeftTab(tab.value);
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

/** Icon navigation between the left panels, Figma-style. */
const Rail = () => (
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
    {leftTabs.map((t) => (
      <RailButton key={t.value} tab={t} />
    ))}
  </nav>
);

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

const LeftPanel = () => {
  const leftTab = useEditor((s) => s.leftTab);
  const [width, setWidth] = usePanelWidth("left", leftBounds);
  const tab = leftTabs.find((t) => t.value === leftTab);
  // Only the active panel is mounted: panels subscribe to server events while visible.
  const Active = tab?.panel;
  return (
    <aside
      className="relative flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
      style={{ width }}
    >
      <ProjectHeader />
      <div className="flex h-9 shrink-0 items-center px-3 font-medium text-[11px]">
        {tab?.label}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {Active ? <Active /> : null}
      </div>
      <ResizeHandle
        defaultWidth={leftBounds.defaultWidth}
        onWidthChange={setWidth}
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
  const screens = useProject((s) => s.screens);
  const flow = useEditor((s) => s.flow);
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
    }
  }, [configured]);

  // Open the last flow (or the first) once screens are known.
  useEffect(() => {
    if (!configured || screens.length === 0 || flow !== null) {
      return;
    }
    const saved = localStorage.getItem("ultrapaint:flow");
    const flows = Array.from(new Set(screens.map((s) => s.flow)));
    const target =
      saved !== null && flows.includes(saved) ? saved : (flows[0] ?? "");
    useEditor.getState().openFlow(target);
  }, [configured, screens, flow]);

  // Recompute frames when the screen list changes for the open flow.
  useEffect(() => {
    if (flow === null) {
      return;
    }
    const inFlow = screens.filter((s) => s.flow === flow);
    const { frames } = useEditor.getState();
    const missing = inFlow.some((s) => !frames[s.id]);
    const extra = Object.keys(frames).some(
      (id) => !inFlow.find((s) => s.id === id)
    );
    if (missing || extra) {
      useEditor.getState().openFlow(flow);
    }
  }, [screens, flow]);

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
        <div className="flex min-h-0 flex-1">
          <Rail />
          <LeftPanel />
          <main className="relative min-w-0 flex-1">
            <Canvas />
            <CanvasStatus />
            <Toolbar />
          </main>
          <RightPanel />
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
