import {
  GitBranch,
  Hand,
  MousePointer2,
  Pointer,
  Redo2,
  Settings,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button, IconButton, Kbd, Select, Tooltip } from "../components/ui.tsx";
import { cn } from "../lib/cn.ts";
import { viewportSize, zoomBy } from "../lib/shortcuts.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

export const TopBar = () => {
  const info = useProject((s) => s.info);
  const undo = useProject((s) => s.undo);
  const mode = useEditor((s) => s.mode);
  const zoom = useEditor((s) => s.view.zoom);
  const host = info.host;

  const undoRedo = async (redo: boolean) => {
    try {
      const r = await api().request(redo ? "edit.redo" : "edit.undo", undefined);
      const s = useEditor.getState();
      if (r?.location && s.selection) s.select({ ...s.selection, source: r.location });
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-line border-b bg-panel px-2">
      <div className="flex items-center gap-1 pr-2">
        <span className="font-semibold text-ink">ultrapaint</span>
      </div>
      <div className="flex items-center gap-0.5 rounded-md border border-line p-0.5">
        <Tooltip
          content={
            <span>
              Select <Kbd>V</Kbd>
            </span>
          }
        >
          <IconButton
            active={mode === "select"}
            onClick={() => useEditor.getState().setMode("select")}
          >
            <MousePointer2 className="size-3.5" />
          </IconButton>
        </Tooltip>
        <Tooltip
          content={
            <span>
              Interact with the UI <Kbd>I</Kbd>
            </span>
          }
        >
          <IconButton
            active={mode === "interact"}
            onClick={() => useEditor.getState().setMode("interact")}
          >
            <Pointer className="size-3.5" />
          </IconButton>
        </Tooltip>
        <Tooltip
          content={
            <span>
              Pan <Kbd>H</Kbd> or hold <Kbd>Space</Kbd>
            </span>
          }
        >
          <IconButton active={mode === "pan"} onClick={() => useEditor.getState().setMode("pan")}>
            <Hand className="size-3.5" />
          </IconButton>
        </Tooltip>
      </div>
      <div className="flex items-center gap-0.5">
        <Tooltip
          content={
            <span>
              Undo <Kbd>⌘Z</Kbd>
              {undo.undoLabel ? ` · ${undo.undoLabel}` : ""}
            </span>
          }
        >
          <IconButton disabled={!undo.canUndo} onClick={() => undoRedo(false)}>
            <Undo2 className="size-3.5" />
          </IconButton>
        </Tooltip>
        <Tooltip
          content={
            <span>
              Redo <Kbd>⇧⌘Z</Kbd>
            </span>
          }
        >
          <IconButton disabled={!undo.canRedo} onClick={() => undoRedo(true)}>
            <Redo2 className="size-3.5" />
          </IconButton>
        </Tooltip>
      </div>
      <div className="flex-1" />
      {info.configured ? (
        <div className="flex items-center gap-2 text-ink-2">
          <span className="text-ink">{info.name}</span>
          <span className="flex items-center gap-1">
            <GitBranch className="size-3" />
            {info.branch}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block size-2 rounded-full",
                host.state === "running" && "bg-ok",
                host.state === "starting" && "animate-pulse bg-accent",
                host.state === "error" && "bg-danger",
                host.state === "stopped" && "bg-ink-3",
              )}
            />
            <span title={host.error}>
              {host.state === "running"
                ? `preview :${host.port}`
                : host.state === "error"
                  ? "preview failed"
                  : `preview ${host.state}`}
            </span>
          </span>
          {host.state !== "running" && host.state !== "starting" && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => api().request("host.start", undefined).catch(reportError)}
            >
              Start preview
            </Button>
          )}
        </div>
      ) : (
        <span className="text-ink-3">No repository configured</span>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        <IconButton onClick={() => zoomBy(0.8)}>
          <ZoomOut className="size-3.5" />
        </IconButton>
        <div className="w-20">
          <Select
            value={String(Math.round(zoom * 100))}
            onChange={(v) => {
              const s = useEditor.getState();
              if (v === "fit") s.zoomToFit(viewportSize());
              else if (v === "sel") s.zoomToSelection(viewportSize());
              else zoomBy(Number(v) / 100 / s.view.zoom);
            }}
            options={[
              { value: String(Math.round(zoom * 100)), label: `${Math.round(zoom * 100)}%` },
              { value: "50", label: "50%" },
              { value: "100", label: "100%" },
              { value: "200", label: "200%" },
              { value: "fit", label: "Zoom to fit  ⇧1" },
              { value: "sel", label: "Zoom to selection  ⇧2" },
            ].filter((o, i, a) => a.findIndex((x) => x.value === o.value) === i)}
            className="h-7 border-transparent bg-transparent"
          />
        </div>
        <IconButton onClick={() => zoomBy(1.25)}>
          <ZoomIn className="size-3.5" />
        </IconButton>
      </div>
      <IconButton onClick={() => useProject.getState().openSettings(true)} title="Settings">
        <Settings className="size-3.5" />
      </IconButton>
    </header>
  );
};
