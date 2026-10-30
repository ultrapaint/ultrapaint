import type { ElementId } from "@ultrapaint/design-document/factories";
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  Hand,
  Image,
  MessageCircle,
  Moon,
  MousePointer2,
  Plus,
  Pointer,
  Redo2,
  SquareDashed,
  Sun,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type * as React from "react";
import { useShallow } from "zustand/react/shallow";
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
import {
  INSERTED_ELEMENTS,
  insertElement,
  insertTarget,
} from "../lib/node-actions.ts";
import { undoOrRedo, zoomBy } from "../lib/shortcuts.ts";
import { BOARD_MODES, setBoardTheme, useBoard } from "../state/board.ts";
import { nextView, zoomToFit, zoomToSelection } from "../state/camera.ts";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useComments } from "../state/comments.ts";
import { useDesignSystem } from "../state/design-system.ts";
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

const ELEMENT_ICONS: Partial<Record<ElementId, React.ReactNode>> = {
  column: <ArrowDown />,
  image: <Image />,
  paragraph: <Type />,
  row: <ArrowRight />,
};

/** The elements, inserted into the selection as the Library inserts a component. */
const InsertItems = () => {
  // Read as the menu opens: where they go is the selection's at that moment.
  const target = insertTarget();
  return (
    <DropdownMenuGroup>
      {INSERTED_ELEMENTS.map((element) => (
        <DropdownMenuItem
          disabled={target === null}
          key={element.id}
          onClick={() => insertElement(element.id)}
        >
          {ELEMENT_ICONS[element.id]}
          {element.name}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );
};

/** The first of the tools (ADR 0045): the elements a design is built of, in a plain menu. */
const InsertMenu = () => (
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger
        render={
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="Insert"
                className="size-8 rounded-lg data-popup-open:bg-muted"
                size="icon"
                variant="ghost"
              />
            }
          />
        }
      >
        <Plus />
      </TooltipTrigger>
      <TooltipContent side="right">
        Insert a row, a column, text or an image
      </TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="start" className="w-40" side="right">
      <InsertItems />
    </DropdownMenuContent>
  </DropdownMenu>
);

/**
 * The theme a board view's boards are drawn in, its first two (light and dark): not on Color,
 * which draws them side by side, nor for a design with one theme.
 */
const ThemeSwitch = () => {
  const themes = useDesignSystem(
    useShallow((s) => s.designSystem?.themes ?? ["light", "dark"])
  );
  const color = useBoard(
    (s) => s.open?.view === "system" && s.open.item === "color"
  );
  const theme = useBoard((s) => s.theme);
  const [light, dark] = themes;
  if (color || light === undefined || dark === undefined) {
    return null;
  }
  // The first theme is the design's own: drawn in it, a board names none.
  const onChange = (next: readonly unknown[]) => {
    const picked = next[0] as string | undefined;
    if (picked !== undefined) {
      setBoardTheme(picked === light ? null : picked);
    }
  };
  return (
    <>
      <Separator className="my-0.5 w-5" />
      <ToggleGroup
        onValueChange={onChange}
        orientation="vertical"
        spacing={0.5}
        value={[theme ?? light]}
      >
        {[
          { icon: <Sun />, label: `Draw in ${light}`, value: light },
          { icon: <Moon />, label: `Draw in ${dark}`, value: dark },
        ].map((t) => (
          <Tooltip key={t.value}>
            <TooltipTrigger
              render={
                <ToggleGroupItem
                  aria-label={t.label}
                  className="size-8 rounded-lg aria-pressed:bg-muted data-pressed:bg-muted"
                  value={t.value}
                >
                  {t.icon}
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="right">{t.label}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
    </>
  );
};

/**
 * The canvas's tools, floating in a column at the top, beside the left panel: Insert, the tools,
 * then undo and redo. On a board view, its few tools and the theme it draws in.
 */
export const Toolbar = () => {
  const undo = useProject((s) => s.undo);
  // Holding Space pans for as long as it is held; the strip shows the tool in effect.
  const effective = useEditor((s) => (s.spacePan ? "pan" : s.mode));
  // A board view has no elements to insert and a few tools (ADR 0045), and draws in a theme.
  const onBoard = useBoard((s) => s.open !== null);
  const shown = onBoard
    ? modes.filter((m) => BOARD_MODES.includes(m.value))
    : modes;

  return (
    <div className="floating pointer-events-auto flex flex-col items-center gap-1 p-1">
      {onBoard ? null : (
        <>
          <InsertMenu />
          <Separator className="my-0.5 w-5" />
        </>
      )}
      <ToggleGroup
        onValueChange={onModeChange}
        orientation="vertical"
        spacing={0.5}
        value={[effective]}
      >
        {shown.map((m) => (
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
      {onBoard ? <ThemeSwitch /> : null}
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
