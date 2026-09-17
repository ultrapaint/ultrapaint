import { cn } from "cn";
import { type ComponentType, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installBridgeRouter } from "./canvas/bridge.ts";
import { Canvas } from "./canvas/canvas.tsx";
import { DialogHost } from "./components/dialogs.tsx";
import { useShortcuts } from "./lib/shortcuts.ts";
import { Changes } from "./panels/changes.tsx";
import { Inspector } from "./panels/inspector.tsx";
import { Layers } from "./panels/layers.tsx";
import { Palette } from "./panels/palette.tsx";
import { Screens } from "./panels/screens.tsx";
import { SettingsDialog } from "./panels/settings.tsx";
import { Threads } from "./panels/threads.tsx";
import { TopBar } from "./panels/top-bar.tsx";
import { useCatalogue } from "./state/catalogue.ts";
import { useConnection } from "./state/connection.ts";
import { useEditor } from "./state/editor.ts";
import { bindProjectEvents, useProject } from "./state/project.ts";

installBridgeRouter();

type EditorState = ReturnType<typeof useEditor.getState>;
type LeftTab = EditorState["leftTab"];
type RightTab = EditorState["rightTab"];

const setLeftTab = (v: LeftTab) => useEditor.getState().setLeftTab(v);
const setRightTab = (v: RightTab) => useEditor.getState().setRightTab(v);

const leftTabs: {
  value: LeftTab;
  label: string;
  panel: ComponentType;
}[] = [
  { label: "Layers", panel: Layers, value: "layers" },
  { label: "Screens", panel: Screens, value: "screens" },
  { label: "Insert", panel: Palette, value: "palette" },
  { label: "Changes", panel: Changes, value: "changes" },
];

const rightTabs: {
  value: RightTab;
  label: string;
  panel: ComponentType;
}[] = [
  { label: "Design", panel: Inspector, value: "design" },
  { label: "Agents", panel: Threads, value: "agents" },
];

const SidePanel = <T extends string>({
  side,
  value,
  onChange,
  tabs,
}: {
  side: "left" | "right";
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string; panel: ComponentType }[];
}) => {
  // Only the active panel is mounted: panels subscribe to server events while visible.
  const Active = tabs.find((t) => t.value === value)?.panel;
  const handleValueChange = useCallback(
    (v: unknown) => onChange(v as T),
    [onChange]
  );
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col bg-sidebar text-sidebar-foreground",
        side === "left" ? "w-64 border-r" : "w-72 border-l"
      )}
    >
      <Tabs
        className="min-h-0 flex-1 gap-0"
        onValueChange={handleValueChange}
        value={value}
      >
        <div className="flex h-10 shrink-0 items-center border-b px-2">
          <TabsList className="w-full">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent className="min-h-0 overflow-auto" value={value}>
          {Active ? <Active /> : null}
        </TabsContent>
      </Tabs>
    </aside>
  );
};

export const App = () => {
  const connState = useConnection((s) => s.state);
  const error = useProject((s) => s.error);
  const configured = useProject((s) => s.info.configured);
  const screens = useProject((s) => s.screens);
  const flow = useEditor((s) => s.flow);
  const leftTab = useEditor((s) => s.leftTab);
  const rightTab = useEditor((s) => s.rightTab);
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
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <SidePanel
            onChange={setLeftTab}
            side="left"
            tabs={leftTabs}
            value={leftTab}
          />
          <main className="min-w-0 flex-1">
            <Canvas />
          </main>
          <SidePanel
            onChange={setRightTab}
            side="right"
            tabs={rightTabs}
            value={rightTab}
          />
        </div>
        {connState !== "open" && (
          <div className="pointer-events-none absolute inset-x-0 top-12 z-40 flex justify-center">
            <Badge className="h-6 px-2.5 shadow-lg" variant="secondary">
              <Spinner /> Connecting to the local backend…
            </Badge>
          </div>
        )}
        <SettingsDialog />
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
