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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IconButton } from "../components/icon-button.tsx";
import { viewportSize, zoomBy } from "../lib/shortcuts.ts";
import { cn } from "../lib/utils.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

type Mode = ReturnType<typeof useEditor.getState>["mode"];

const modes: { value: Mode; icon: React.ReactNode; tooltip: React.ReactNode }[] = [
  {
    value: "select",
    icon: <MousePointer2 />,
    tooltip: (
      <>
        Select <Kbd>V</Kbd>
      </>
    ),
  },
  {
    value: "interact",
    icon: <Pointer />,
    tooltip: (
      <>
        Interact with the UI <Kbd>I</Kbd>
      </>
    ),
  },
  {
    value: "pan",
    icon: <Hand />,
    tooltip: (
      <>
        Pan <Kbd>H</Kbd> or hold <Kbd>Space</Kbd>
      </>
    ),
  },
];

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
    <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-sidebar px-2 text-sidebar-foreground">
      <span className="px-1 font-semibold">ultrapaint</span>
      <Separator orientation="vertical" className="my-2" />
      <ToggleGroup
        value={[mode]}
        onValueChange={(next) => {
          const v = next[0] as Mode | undefined;
          if (v) useEditor.getState().setMode(v);
        }}
        spacing={0.5}
      >
        {modes.map((m) => (
          <Tooltip key={m.value}>
            <TooltipTrigger
              render={
                <ToggleGroupItem value={m.value} aria-label={m.value}>
                  {m.icon}
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="bottom">{m.tooltip}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <Separator orientation="vertical" className="my-2" />
      <div className="flex items-center gap-0.5">
        <IconButton
          disabled={!undo.canUndo}
          onClick={() => undoRedo(false)}
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
          onClick={() => undoRedo(true)}
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
          <Badge variant="outline" title={host.error}>
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                host.state === "running" && "bg-success",
                host.state === "starting" && "animate-pulse bg-brand",
                host.state === "error" && "bg-destructive",
                host.state === "stopped" && "bg-muted-foreground",
              )}
            />
            {host.state === "running"
              ? `preview :${host.port}`
              : host.state === "error"
                ? "preview failed"
                : `preview ${host.state}`}
          </Badge>
          {host.state !== "running" && host.state !== "starting" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => api().request("host.start", undefined).catch(reportError)}
            >
              Start preview
            </Button>
          )}
        </div>
      ) : (
        <span className="text-muted-foreground">No repository configured</span>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        <IconButton tooltip="Zoom out" onClick={() => zoomBy(0.8)}>
          <ZoomOut />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" className="w-16 justify-between tabular-nums" />}
          >
            {Math.round(zoom * 100)}%
            <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              {[50, 100, 200].map((pct) => (
                <DropdownMenuItem
                  key={pct}
                  onClick={() => zoomBy(pct / 100 / useEditor.getState().view.zoom)}
                >
                  {pct}%
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => useEditor.getState().zoomToFit(viewportSize())}>
                Zoom to fit
                <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => useEditor.getState().zoomToSelection(viewportSize())}
              >
                Zoom to selection
                <DropdownMenuShortcut>⇧2</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton tooltip="Zoom in" onClick={() => zoomBy(1.25)}>
          <ZoomIn />
        </IconButton>
      </div>
      <Separator orientation="vertical" className="my-2" />
      <IconButton tooltip="Settings" onClick={() => useProject.getState().openSettings(true)}>
        <Settings />
      </IconButton>
    </header>
  );
};
