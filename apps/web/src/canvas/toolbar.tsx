import {
  ChevronDown,
  Hand,
  MessageCircle,
  MousePointer2,
  Pointer,
  Redo2,
  SquareDashed,
  Type,
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
import { CommandKeys } from "../components/shortcut-sheet.tsx";
import { keysOf } from "../lib/commands.ts";
import { undoOrRedo, zoomBy } from "../lib/shortcuts.ts";
import { nextView, zoomToFit, zoomToSelection } from "../state/camera.ts";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useComments } from "../state/comments.ts";
import { type Mode, useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

/** `label` names the tool for a screen reader, as the tooltip names it on screen. */
const modes: {
  value: Mode;
  icon: React.ReactNode;
  label: string;
  tooltip: React.ReactNode;
}[] = [
  {
    icon: <MousePointer2 />,
    label: "Select",
    tooltip: (
      <>
        Select <CommandKeys id="tool:select" />
      </>
    ),
    value: "select",
  },
  {
    icon: <SquareDashed />,
    label: "Group",
    tooltip: (
      <>
        Group <CommandKeys id="tool:group" /> · draw one, or click for the
        default size
      </>
    ),
    value: "group",
  },
  {
    icon: <Type />,
    label: "Text",
    tooltip: (
      <>
        Text <CommandKeys id="tool:text" />
      </>
    ),
    value: "text",
  },
  {
    icon: <Pointer />,
    label: "Use components",
    tooltip: (
      <>
        Use components <CommandKeys id="tool:interact" /> · press their buttons,
        open their menus. Links are followed in Prototype.
      </>
    ),
    value: "interact",
  },
  {
    icon: <Hand />,
    label: "Pan",
    tooltip: (
      <>
        Pan <CommandKeys id="tool:pan" /> or hold <Kbd>Space</Kbd>
      </>
    ),
    value: "pan",
  },
  {
    icon: <MessageCircle />,
    label: "Comment",
    tooltip: (
      <>
        Comment <CommandKeys id="tool:comment" /> · show or hide comments{" "}
        <CommandKeys id="toggleComments" />
      </>
    ),
    value: "comment",
  },
];

const undoEdit = () => undoOrRedo(false);
const redoEdit = () => undoOrRedo(true);

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
const toggleGrid = () => useCanvasGrid.getState().toggle();

const ZoomPresetItem = ({ pct }: { pct: number }) => {
  const onClick = () => zoomBy(pct / 100 / nextView().zoom);
  return <DropdownMenuItem onClick={onClick}>{pct}%</DropdownMenuItem>;
};

/** The zoom, floating at the canvas's bottom right: out, the level and its menu, in. */
export const ZoomControl = () => {
  const zoom = useEditor((s) => s.view.zoom);
  const grid = useCanvasGrid((s) => s.visible);
  return (
    <div className="floating pointer-events-auto flex items-center gap-0.5 p-1">
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
        <DropdownMenuContent align="end" className="w-48" side="top">
          <DropdownMenuGroup>
            {[50, 100, 200].map((pct) => (
              <ZoomPresetItem key={pct} pct={pct} />
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={zoomToFit}>
              Zoom to fit
              <DropdownMenuShortcut>{keysOf("zoomFit")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={zoomToSelection}>
              Zoom to selection
              <DropdownMenuShortcut>
                {keysOf("zoomSelection")}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={toggleGrid}>
              {grid ? "Hide grid" : "Show grid"}
              <DropdownMenuShortcut>{keysOf("grid")}</DropdownMenuShortcut>
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

/**
 * The canvas's tools, floating in a column at the top, beside the left panel: the tools, then
 * undo and redo. The app positions it.
 */
export const Toolbar = () => {
  const undo = useProject((s) => s.undo);
  // Holding Space pans for as long as it is held; the strip shows the tool in effect.
  const effective = useEditor((s) => (s.spacePan ? "pan" : s.mode));

  return (
    <div className="floating pointer-events-auto flex flex-col items-center gap-1 p-1">
      <ToggleGroup
        onValueChange={onModeChange}
        orientation="vertical"
        spacing={0.5}
        value={[effective]}
      >
        {modes.map((m) => (
          <Tooltip key={m.value}>
            <TooltipTrigger
              render={
                <ToggleGroupItem
                  aria-label={m.label}
                  className="size-8 rounded-lg aria-pressed:bg-brand aria-pressed:text-brand-foreground data-pressed:bg-brand data-pressed:text-brand-foreground"
                  value={m.value}
                >
                  {m.icon}
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="right">{m.tooltip}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <Separator className="my-0.5 w-5" />
      <IconButton
        className="size-8 rounded-lg"
        disabled={!undo.canUndo}
        label={undo.undoLabel ? `Undo ${undo.undoLabel}` : "Undo"}
        onClick={undoEdit}
        side="right"
        tooltip={
          <>
            Undo{undo.undoLabel ? ` · ${undo.undoLabel}` : ""}{" "}
            <CommandKeys id="undo" />
          </>
        }
      >
        <Undo2 />
      </IconButton>
      <IconButton
        className="size-8 rounded-lg"
        disabled={!undo.canRedo}
        label="Redo"
        onClick={redoEdit}
        side="right"
        tooltip={
          <>
            Redo <CommandKeys id="redo" />
          </>
        }
      >
        <Redo2 />
      </IconButton>
    </div>
  );
};
