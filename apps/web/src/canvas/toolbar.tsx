import { APP_FROM } from "@ultrapaint/contracts/component-names";
import {
  type ElementId,
  newInstance,
} from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  Component,
  Grid3x3,
  Hand,
  Image,
  Maximize,
  MessageCircle,
  Moon,
  MousePointer2,
  Plus,
  Pointer,
  Scan,
  SquareDashed,
  Sun,
  Type,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CommandKeys } from "../components/shortcut-sheet.tsx";
import { keysOf } from "../lib/commands.ts";
import {
  INSERTED_ELEMENTS,
  insertElement,
  insertNode,
  insertTarget,
} from "../lib/node-actions.ts";
import { zoomBy } from "../lib/shortcuts.ts";
import { setBoardTheme, useBoard } from "../state/board.ts";
import { nextView, zoomToFit, zoomToSelection } from "../state/camera.ts";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useComments } from "../state/comments.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { type Mode, useEditor } from "../state/editor.ts";
import { frameRefOf } from "../state/frame-ref.ts";
import { useIsolation } from "../state/isolation.ts";
import { useKeybindings } from "../state/keybindings.ts";
import { useSurface } from "../state/surface.ts";
import { UndoRedo } from "./undo-redo.tsx";

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
        Group <CommandKeys id="tool:group" />
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
    label: "Interact",
    tooltip: (
      <>
        Interact <CommandKeys id="tool:interact" />
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
        Comment <CommandKeys id="tool:comment" />
      </>
    ),
    value: "comment",
  },
];

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
  return (
    <DropdownMenuItem className="pl-8" onClick={onClick}>
      {pct}%
    </DropdownMenuItem>
  );
};

/**
 * The zoom level as a whole percentage: drawn on its own, so a zoom redraws this text alone and not
 * the menu around it, once a frame.
 */
const ZoomLevel = () => {
  const pct = useEditor((s) => Math.round(s.view.zoom * 100));
  return <>{pct}%</>;
};

/** The zoom level and its menu, at the end of the tools. */
const ZoomMenu = () => {
  const grid = useCanvasGrid((s) => s.visible);
  // The items show the keys now: the person's, when they change them.
  useKeybindings((s) => s.overrides);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label="Zoom"
                  className="h-8 w-[4.25rem] justify-between gap-0.5 rounded-lg px-2 tabular-nums data-popup-open:bg-accent"
                  variant="ghost"
                />
              }
            />
          }
        >
          <ZoomLevel />
          <ChevronDown className="size-3.5! text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent side="top">Zoom</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52" side="top">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={zoomIn}>
            <ZoomIn />
            Zoom in
            <DropdownMenuShortcut>{keysOf("zoomIn")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={zoomOut}>
            <ZoomOut />
            Zoom out
            <DropdownMenuShortcut>{keysOf("zoomOut")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={zoomToFit}>
            <Maximize />
            Zoom to fit
            <DropdownMenuShortcut>{keysOf("zoomFit")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={zoomToSelection}>
            <Scan />
            Zoom to selection
            <DropdownMenuShortcut>
              {keysOf("zoomSelection")}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {[50, 100, 200].map((pct) => (
            <ZoomPresetItem key={pct} pct={pct} />
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={toggleGrid}>
            <Grid3x3 />
            {grid ? "Hide grid" : "Show grid"}
            <DropdownMenuShortcut>{keysOf("grid")}</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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

/**
 * The components, inserted into the selection: on an app component's board, where the Library is
 * the navigation, what its tree edited in place is built with besides the elements. The one
 * edited is not among them.
 */
const InsertComponents = () => {
  const catalogue = useComponents((s) => s.catalogue);
  const editing = useIsolation((s) => s.isolated?.component);
  const target = insertTarget();
  const listed = catalogue
    .filter((c) => c.name !== editing)
    .toSorted(
      (a, b) =>
        Number(b.importFrom === APP_FROM) - Number(a.importFrom === APP_FROM) ||
        a.name.localeCompare(b.name)
    );
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={target === null}>
        <Component />
        Component
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-44 overflow-y-auto">
        {listed.map((c) => (
          <DropdownMenuItem
            key={`${c.importFrom}:${c.name}`}
            onClick={() => insertNode(newInstance(c, makeIdGenerator()))}
          >
            {c.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

/** The first of the tools (ADR 0045): the elements a design is built of, in a plain menu. */
const InsertMenu = ({ components = false }: { components?: boolean }) => (
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger
        render={
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="Insert"
                className="size-8 rounded-lg data-popup-open:bg-accent"
                size="icon"
                variant="ghost"
              />
            }
          />
        }
      >
        <Plus />
      </TooltipTrigger>
      <TooltipContent side="top">Insert</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="start" className="w-48" side="top">
      <InsertItems />
      {components ? <InsertComponents /> : null}
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
      <ToolbarDivider />
      <ToggleGroup
        onValueChange={onChange}
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
                  className="size-8 rounded-lg aria-pressed:bg-accent data-pressed:bg-accent"
                  value={t.value}
                >
                  {t.icon}
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="top">{t.label}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
    </>
  );
};

/** A short rule between the tools' groups, centred on their line. */
const ToolbarDivider = () => (
  <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-foreground/15" />
);

/**
 * The canvas's tools, floating in one row at the bottom of the canvas, as Figma's are: Insert,
 * the tools, undo and redo, then the zoom. On a board view, its few tools and the theme it draws in.
 */
export const Toolbar = () => {
  // Holding Space pans for as long as it is held; the strip shows the tool in effect.
  const effective = useEditor((s) => (s.spacePan ? "pan" : s.mode));
  // A board view has no elements to insert and a few tools (ADR 0045), and draws in a theme;
  // but an app component's tree edited in place on its board is built as on a page.
  const surface = useSurface();
  const onBoard = surface.kind === "board";
  const building = useIsolation(
    (s) => s.isolated !== null && frameRefOf(s.isolated.frame).kind === "board"
  );
  const shown = modes.filter((m) => surface.modes.includes(m.value));

  return (
    <div
      aria-label="Tools"
      className="floating pointer-events-auto flex items-center gap-0.5 p-1"
      role="toolbar"
    >
      {onBoard && !building ? null : (
        <>
          <InsertMenu components={building} />
          <ToolbarDivider />
        </>
      )}
      <ToggleGroup
        onValueChange={onModeChange}
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
            <TooltipContent side="top">{m.tooltip}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      {onBoard ? <ThemeSwitch /> : null}
      <ToolbarDivider />
      <UndoRedo />
      <ToolbarDivider />
      <ZoomMenu />
    </div>
  );
};
