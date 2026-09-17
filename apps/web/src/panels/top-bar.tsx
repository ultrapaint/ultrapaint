import { cn } from "cn";
import {
  ChevronDown,
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
import type * as React from "react";
import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IconButton } from "../components/icon-button.tsx";
import { viewportSize, zoomBy } from "../lib/shortcuts.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

type Mode = ReturnType<typeof useEditor.getState>["mode"];

const modes: {
  value: Mode;
  icon: React.ReactNode;
  tooltip: React.ReactNode;
}[] = [
  {
    icon: <MousePointer2 />,
    tooltip: (
      <>
        Select <Kbd>V</Kbd>
      </>
    ),
    value: "select",
  },
  {
    icon: <Pointer />,
    tooltip: (
      <>
        Interact with the UI <Kbd>I</Kbd>
      </>
    ),
    value: "interact",
  },
  {
    icon: <Hand />,
    tooltip: (
      <>
        Pan <Kbd>H</Kbd> or hold <Kbd>Space</Kbd>
      </>
    ),
    value: "pan",
  },
];

const undoRedo = async (redo: boolean) => {
  try {
    const r = await api().request(redo ? "edit.redo" : "edit.undo", undefined);
    const s = useEditor.getState();
    if (r?.location && s.selection) {
      s.select({ ...s.selection, source: r.location });
    }
  } catch (error) {
    reportError(error);
  }
};

const undoEdit = () => undoRedo(false);
const redoEdit = () => undoRedo(true);

const onModeChange = (next: readonly unknown[]) => {
  const v = next[0] as Mode | undefined;
  if (v) {
    useEditor.getState().setMode(v);
  }
};

const startPreview = () =>
  api().request("host.start", undefined).catch(reportError);

const zoomOut = () => zoomBy(0.8);
const zoomIn = () => zoomBy(1.25);
const zoomToFit = () => useEditor.getState().zoomToFit(viewportSize());
const zoomToSelection = () =>
  useEditor.getState().zoomToSelection(viewportSize());
const openSettings = () => useProject.getState().openSettings(true);

type HostInfo = ReturnType<typeof useProject.getState>["info"]["host"];

const previewLabel = (host: HostInfo) => {
  if (host.state === "running") {
    return `preview :${host.port}`;
  }
  return host.state === "error" ? "preview failed" : `preview ${host.state}`;
};

const ZoomPresetItem = ({ pct }: { pct: number }) => {
  const onClick = useCallback(
    () => zoomBy(pct / 100 / useEditor.getState().view.zoom),
    [pct]
  );
  return <DropdownMenuItem onClick={onClick}>{pct}%</DropdownMenuItem>;
};

export const TopBar = () => {
  const info = useProject((s) => s.info);
  const undo = useProject((s) => s.undo);
  const mode = useEditor((s) => s.mode);
  const zoom = useEditor((s) => s.view.zoom);
  const { host } = info;

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-sidebar px-2 text-sidebar-foreground">
      <span className="px-1 font-semibold">ultrapaint</span>
      <Separator className="my-2" orientation="vertical" />
      <ToggleGroup onValueChange={onModeChange} spacing={0.5} value={[mode]}>
        {modes.map((m) => (
          <Tooltip key={m.value}>
            <TooltipTrigger
              render={
                <ToggleGroupItem aria-label={m.value} value={m.value}>
                  {m.icon}
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="bottom">{m.tooltip}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <Separator className="my-2" orientation="vertical" />
      <div className="flex items-center gap-0.5">
        <IconButton
          disabled={!undo.canUndo}
          onClick={undoEdit}
          tooltip={
            <>
              Undo{undo.undoLabel ? ` · ${undo.undoLabel}` : ""} <Kbd>⌘Z</Kbd>
            </>
          }
        >
          <Undo2 />
        </IconButton>
        <IconButton
          disabled={!undo.canRedo}
          onClick={redoEdit}
          tooltip={
            <>
              Redo <Kbd>⇧⌘Z</Kbd>
            </>
          }
        >
          <Redo2 />
        </IconButton>
      </div>
      <div className="flex-1" />
      {info.configured ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="font-medium text-foreground">{info.name}</span>
          <span className="flex items-center gap-1">
            <GitBranch className="size-3" />
            {info.branch}
          </span>
          <Badge title={host.error} variant="outline">
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                host.state === "running" && "bg-success",
                host.state === "starting" && "animate-pulse bg-brand",
                host.state === "error" && "bg-destructive",
                host.state === "stopped" && "bg-muted-foreground"
              )}
            />
            {previewLabel(host)}
          </Badge>
          {host.state !== "running" && host.state !== "starting" && (
            <Button onClick={startPreview} size="sm" variant="outline">
              Start preview
            </Button>
          )}
        </div>
      ) : (
        <span className="text-muted-foreground">No repository configured</span>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        <IconButton onClick={zoomOut} tooltip="Zoom out">
          <ZoomOut />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className="w-16 justify-between tabular-nums"
                variant="ghost"
              />
            }
          >
            {Math.round(zoom * 100)}%
            <ChevronDown
              className="text-muted-foreground"
              data-icon="inline-end"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              {[50, 100, 200].map((pct) => (
                <ZoomPresetItem key={pct} pct={pct} />
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={zoomToFit}>
                Zoom to fit
                <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={zoomToSelection}>
                Zoom to selection
                <DropdownMenuShortcut>⇧2</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton onClick={zoomIn} tooltip="Zoom in">
          <ZoomIn />
        </IconButton>
      </div>
      <Separator className="my-2" orientation="vertical" />
      <IconButton onClick={openSettings} tooltip="Settings">
        <Settings />
      </IconButton>
    </header>
  );
};
