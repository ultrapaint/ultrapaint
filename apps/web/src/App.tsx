import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installBridgeRouter } from "./canvas/bridge.ts";
import { Canvas } from "./canvas/Canvas.tsx";
import { DialogHost } from "./components/dialogs.tsx";
import { useShortcuts } from "./lib/shortcuts.ts";
import { cn } from "./lib/utils.ts";
import { Changes } from "./panels/Changes.tsx";
import { Inspector } from "./panels/Inspector.tsx";
import { Layers } from "./panels/Layers.tsx";
import { Palette } from "./panels/Palette.tsx";
import { Screens } from "./panels/Screens.tsx";
import { SettingsDialog } from "./panels/Settings.tsx";
import { Threads } from "./panels/Threads.tsx";
import { TopBar } from "./panels/TopBar.tsx";
import { useCatalogue } from "./state/catalogue.ts";
import { useConnection } from "./state/connection.ts";
import { useEditor } from "./state/editor.ts";
import { bindProjectEvents, useProject } from "./state/project.ts";

installBridgeRouter();

type EditorState = ReturnType<typeof useEditor.getState>;
type LeftTab = EditorState["leftTab"];
type RightTab = EditorState["rightTab"];

const leftTabs: { value: LeftTab; label: string; panel: React.ComponentType }[] = [
  { value: "layers", label: "Layers", panel: Layers },
  { value: "screens", label: "Screens", panel: Screens },
  { value: "palette", label: "Insert", panel: Palette },
  { value: "changes", label: "Changes", panel: Changes },
];

const rightTabs: { value: RightTab; label: string; panel: React.ComponentType }[] = [
  { value: "design", label: "Design", panel: Inspector },
  { value: "agents", label: "Agents", panel: Threads },
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
  tabs: { value: T; label: string; panel: React.ComponentType }[];
}) => {
  // Only the active panel is mounted: panels subscribe to server events while visible.
  const Active = tabs.find((t) => t.value === value)?.panel;
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col bg-sidebar text-sidebar-foreground",
        side === "left" ? "w-64 border-r" : "w-72 border-l",
      )}
    >
      <Tabs value={value} onValueChange={(v) => onChange(v as T)} className="min-h-0 flex-1 gap-0">
        <div className="flex h-10 shrink-0 items-center border-b px-2">
          <TabsList className="w-full">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value={value} className="min-h-0 overflow-auto">
          {Active && <Active />}
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
  const bound = React.useRef(false);
  useShortcuts();

  React.useEffect(() => {
    if (connState !== "open") return;
    if (!bound.current) {
      bindProjectEvents();
      bound.current = true;
    }
    void useProject.getState().load();
  }, [connState]);

  // Index the design system in the background so prop controls are typed.
  React.useEffect(() => {
    if (configured) void useCatalogue.getState().load();
  }, [configured]);

  // Open the last flow (or the first) once screens are known.
  React.useEffect(() => {
    if (!configured || screens.length === 0 || flow !== null) return;
    const saved = localStorage.getItem("ultrapaint:flow");
    const flows = Array.from(new Set(screens.map((s) => s.flow)));
    const target = saved !== null && flows.includes(saved) ? saved : (flows[0] ?? "");
    void useEditor.getState().openFlow(target);
  }, [configured, screens, flow]);

  // Recompute frames when the screen list changes for the open flow.
  React.useEffect(() => {
    if (flow === null) return;
    const inFlow = screens.filter((s) => s.flow === flow);
    const frames = useEditor.getState().frames;
    const missing = inFlow.some((s) => !frames[s.id]);
    const extra = Object.keys(frames).some((id) => !inFlow.find((s) => s.id === id));
    if (missing || extra) void useEditor.getState().openFlow(flow);
  }, [screens, flow]);

  // Errors surface as toasts; the store slot is only a hand-off from non-React code.
  React.useEffect(() => {
    if (!error) return;
    toast.error("Something went wrong", { description: error, duration: 10000 });
    useProject.getState().setError(null);
  }, [error]);

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <SidePanel
            side="left"
            value={leftTab}
            onChange={(v) => useEditor.getState().setLeftTab(v)}
            tabs={leftTabs}
          />
          <main className="min-w-0 flex-1">
            <Canvas />
          </main>
          <SidePanel
            side="right"
            value={rightTab}
            onChange={(v) => useEditor.getState().setRightTab(v)}
            tabs={rightTabs}
          />
        </div>
        {connState !== "open" && (
          <div className="pointer-events-none absolute inset-x-0 top-12 z-40 flex justify-center">
            <Badge variant="secondary" className="h-6 px-2.5 shadow-lg">
              <Spinner /> Connecting to the local backend…
            </Badge>
          </div>
        )}
        <SettingsDialog />
        <DialogHost />
        <Toaster
          theme="dark"
          position="bottom-right"
          closeButton
          toastOptions={{ classNames: { description: "whitespace-pre-wrap" } }}
        />
      </div>
    </TooltipProvider>
  );
};
