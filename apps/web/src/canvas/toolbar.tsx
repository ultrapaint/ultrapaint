import {
  ChevronDown,
  Hand,
  MessageCircle,
  MousePointer2,
  Pointer,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type * as React from "react";
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
import { useComments } from "../state/comments.ts";
import { api } from "../state/connection.ts";
import { type Mode, useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";

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
  {
    icon: <MessageCircle />,
    tooltip: (
      <>
        Comment <Kbd>C</Kbd> · show or hide comments <Kbd>⇧C</Kbd>
      </>
    ),
    value: "comment",
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
  // Picking the comment tool is asking to see the comments.
  if (v === "comment" && !useComments.getState().visible) {
    useComments.getState().toggleVisible();
  }
};

const zoomOut = () => zoomBy(0.8);
const zoomIn = () => zoomBy(1.25);
const zoomToFit = () => useEditor.getState().zoomToFit(viewportSize());
const zoomToSelection = () =>
  useEditor.getState().zoomToSelection(viewportSize());

const ZoomPresetItem = ({ pct }: { pct: number }) => {
  const onClick = () => zoomBy(pct / 100 / useEditor.getState().view.zoom);
  return <DropdownMenuItem onClick={onClick}>{pct}%</DropdownMenuItem>;
};

const Zoom = () => {
  const zoom = useEditor((s) => s.view.zoom);
  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        className="size-8 rounded-lg"
        onClick={zoomOut}
        tooltip="Zoom out"
      >
        <ZoomOut />
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className="h-8 w-16 justify-between rounded-lg tabular-nums"
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
        <DropdownMenuContent align="center" className="w-48" side="top">
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
      <IconButton
        className="size-8 rounded-lg"
        onClick={zoomIn}
        tooltip="Zoom in"
      >
        <ZoomIn />
      </IconButton>
    </div>
  );
};

/** Floating tool strip at the bottom centre of the canvas; the app positions it. */
export const Toolbar = () => {
  const undo = useProject((s) => s.undo);
  // Holding Space pans for as long as it is held; the strip shows the tool in effect.
  const effective = useEditor((s) => (s.spacePan ? "pan" : s.mode));

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-sidebar p-1 text-sidebar-foreground shadow-black/30 shadow-lg">
      <ToggleGroup
        onValueChange={onModeChange}
        spacing={0.5}
        value={[effective]}
      >
        {modes.map((m) => (
          <Tooltip key={m.value}>
            <TooltipTrigger
              render={
                <ToggleGroupItem
                  aria-label={m.value}
                  className="size-8 rounded-lg aria-pressed:bg-brand aria-pressed:text-brand-foreground data-pressed:bg-brand data-pressed:text-brand-foreground"
                  value={m.value}
                >
                  {m.icon}
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="top">{m.tooltip}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <Separator className="mx-0.5 h-5" orientation="vertical" />
      <IconButton
        className="size-8 rounded-lg"
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
        className="size-8 rounded-lg"
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
      <Separator className="mx-0.5 h-5" orientation="vertical" />
      <Zoom />
    </div>
  );
};
