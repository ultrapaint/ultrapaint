import * as React from "react";
import { installBridgeRouter } from "./canvas/bridge.ts";
import { Canvas } from "./canvas/Canvas.tsx";
import { Tabs } from "./components/ui.tsx";
import { useShortcuts } from "./lib/shortcuts.ts";
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

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-line border-r bg-panel">
          <Tabs
            value={leftTab}
            onChange={(v) => useEditor.getState().setLeftTab(v)}
            tabs={[
              { value: "layers", label: "Layers" },
              { value: "screens", label: "Screens" },
              { value: "palette", label: "Insert" },
              { value: "changes", label: "Changes" },
            ]}
          />
          <div className="min-h-0 flex-1 overflow-auto">
            {leftTab === "layers" && <Layers />}
            {leftTab === "screens" && <Screens />}
            {leftTab === "palette" && <Palette />}
            {leftTab === "changes" && <Changes />}
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <Canvas />
        </main>
        <aside className="flex w-72 shrink-0 flex-col border-line border-l bg-panel">
          <Tabs
            value={rightTab}
            onChange={(v) => useEditor.getState().setRightTab(v)}
            tabs={[
              { value: "design", label: "Design" },
              { value: "agents", label: "Agents" },
            ]}
          />
          <div className="min-h-0 flex-1 overflow-auto">
            {rightTab === "design" ? <Inspector /> : <Threads />}
          </div>
        </aside>
      </div>
      {connState !== "open" && (
        <div className="absolute inset-x-0 top-10 z-40 flex justify-center">
          <div className="rounded-md bg-panel-3 px-3 py-1.5 text-ink-2 shadow-lg">
            Connecting to the local backend…
          </div>
        </div>
      )}
      {error && (
        <div className="absolute right-4 bottom-4 z-40 max-w-md rounded-md border border-danger/40 bg-panel-2 p-3 text-ink shadow-xl">
          <div className="mb-1 font-medium text-danger">Something went wrong</div>
          <div className="whitespace-pre-wrap text-ink-2">{error}</div>
          <button
            type="button"
            className="mt-2 text-ink-3 hover:text-ink"
            onClick={() => useProject.getState().setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      <SettingsDialog />
    </div>
  );
};
