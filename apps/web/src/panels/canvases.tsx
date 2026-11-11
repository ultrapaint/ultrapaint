import type { Canvas } from "@ultrapaint/contracts/pages";
import {
  Check,
  ChevronDown,
  EllipsisVertical,
  FileUp,
  Frame,
  Plus,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useState,
} from "react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
import {
  newCanvas,
  openCanvas,
  renameCanvas,
  reorderCanvases,
} from "../lib/canvas-actions.ts";
import { pickFigmaFile } from "../lib/import-figma.ts";
import { showMenu } from "../state/context-menu.ts";
import { useEditor } from "../state/editor.ts";
import { useEditorMode } from "../state/panels.ts";
import { useProject } from "../state/project.ts";

const CANVAS_DRAG_TYPE = "application/x-ultrapaint-canvas";

/** A name typed in place: Enter keeps it, Escape or leaving the field drops it. */
export const InlineInput = ({
  className,
  onCancel,
  onSubmit,
  value,
}: {
  className?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  value: string;
}) => {
  const [draft, setDraft] = useState(value);
  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    setDraft(e.target.value);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // The canvas has keys of its own; typing is the field's.
    e.stopPropagation();
    if (e.key === "Escape") {
      onCancel();
    }
    if (e.key === "Enter") {
      onSubmit(draft);
    }
  };
  return (
    <Input
      autoFocus
      className={cn("h-5", className)}
      onBlur={onCancel}
      onChange={onChange}
      onClick={(e: MouseEvent) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      value={draft}
    />
  );
};

/**
 * The canvases of the project, as Figma lists the pages of a file: one opens at a time, and each
 * has its own pages, their URLs and its loose nodes. Dragged to reorder; double-clicked to rename.
 */
const CanvasList = ({
  canvases,
  current,
  onOpen,
}: {
  canvases: readonly Canvas[];
  current: string | null;
  /** After a click opens another canvas: the list it was picked from closes. */
  onOpen: () => void;
}) => {
  const [dropAt, setDropAt] = useState<number | null>(null);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const at = dropAt;
    setDropAt(null);
    const id = e.dataTransfer.getData(CANVAS_DRAG_TYPE);
    const ids = canvases.map((c) => c.id);
    const from = ids.indexOf(id);
    if (at === null || from === -1 || at === from || at === from + 1) {
      return;
    }
    const order = ids.filter((c) => c !== id);
    order.splice(at > from ? at - 1 : at, 0, id);
    reorderCanvases(order);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropAt(null);
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: a drop target; the rows are the controls.
    <div className="flex flex-col" onDragLeave={onDragLeave} onDrop={onDrop}>
      {canvases.map((canvas, index) => (
        <CanvasRow
          canvas={canvas}
          current={canvas.id === current}
          dropAbove={dropAt === index}
          dropBelow={dropAt === index + 1 && index === canvases.length - 1}
          key={canvas.id}
          onDragEnd={() => setDropAt(null)}
          onDragOver={(e: DragEvent) => {
            if (e.dataTransfer.types.includes(CANVAS_DRAG_TYPE)) {
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              setDropAt(
                e.clientY < box.top + box.height / 2 ? index : index + 1
              );
            }
          }}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
};

const CanvasRow = ({
  canvas,
  current,
  dropAbove,
  dropBelow,
  onDragEnd,
  onDragOver,
  onOpen,
}: {
  canvas: Canvas;
  current: boolean;
  /** Where a dragged canvas would go: above this one, or below the last. */
  dropAbove: boolean;
  dropBelow: boolean;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onOpen: () => void;
}) => {
  const [renaming, setRenaming] = useState(false);
  // Its pages as the Pages panel lists them: a page's variants and states are not pages.
  const count = useProject(
    (s) =>
      s.pages.filter(
        (p) =>
          p.canvas === canvas.id &&
          p.variant === undefined &&
          p.state === undefined
      ).length
  );
  const menu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showMenu({ canvasId: canvas.id, kind: "canvasEntry" }, e.currentTarget);
  };
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(CANVAS_DRAG_TYPE, canvas.id);
    e.dataTransfer.effectAllowed = "move";
  };
  const rename = (name: string) => {
    setRenaming(false);
    renameCanvas(canvas, name);
  };
  // The canvas shown stays open on a click, so a double click on it still renames it in place.
  const open = () => {
    if (!current) {
      openCanvas(canvas.id);
      onOpen();
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the row's buttons raise the menu from the keyboard, and it bubbles here.
    <div
      className={cn(
        "group relative flex h-7 items-center gap-2 rounded-md pr-1 pl-2 font-body has-focus-visible:bg-accent",
        current ? "bg-accent text-foreground" : "hover:bg-accent"
      )}
      draggable={!renaming}
      onContextMenu={menu}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
    >
      {dropAbove ? (
        <span className="absolute inset-x-1.5 top-0 h-px bg-brand" />
      ) : null}
      {dropBelow ? (
        <span className="absolute inset-x-1.5 bottom-0 h-px bg-brand" />
      ) : null}
      <span className="flex size-4 shrink-0 items-center justify-center">
        {current ? <Check className="size-4" /> : null}
      </span>
      {renaming ? (
        <InlineInput
          onCancel={() => setRenaming(false)}
          onSubmit={rename}
          value={canvas.name}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className={cn(
                  "flex h-full min-w-0 flex-1 items-center truncate text-left outline-none",
                  current && "font-body-medium"
                )}
                onClick={open}
                onDoubleClick={() => setRenaming(true)}
                type="button"
              />
            }
          >
            <span className="truncate">{canvas.name}</span>
          </TooltipTrigger>
          <TooltipContent>
            {canvas.id === "" ? "The designs directory" : canvas.id}
          </TooltipContent>
        </Tooltip>
      )}
      {renaming ? null : (
        <>
          <span className="shrink-0 font-body-small text-muted-foreground tabular-nums group-hover:hidden">
            {count} {count === 1 ? "page" : "pages"}
          </span>
          <IconButton
            className="hidden group-hover:flex"
            onClick={menu}
            size="icon-xs"
            tooltip="Canvas actions"
          >
            <EllipsisVertical className="size-3.5" />
          </IconButton>
        </>
      )}
    </div>
  );
};

/**
 * Under the project, in its card: the canvas shown, in Canvas mode and the prototype; its list
 * opens over the left panel rather than growing the card. The mode itself is the place switch's.
 */
export const CanvasPicker = () => {
  const configured = useProject((s) => s.info.configured);
  const canvases = useProject((s) => s.canvases);
  const current = useEditor((s) => s.canvas);
  const mode = useEditorMode();
  if (!configured || canvases.length === 0 || mode !== "canvas") {
    return null;
  }
  return <CanvasPickerPopover canvases={canvases} current={current} />;
};

const MENU_ROW =
  "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-left font-body outline-none hover:bg-accent focus-visible:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground";

/** The canvas shown, which opens the list of canvases and what makes a new one, over the panel. */
const CanvasPickerPopover = ({
  canvases,
  current,
}: {
  canvases: readonly Canvas[];
  current: string | null;
}) => {
  const [open, setOpen] = useState(false);
  // What a row of the list starts, a canvas opened or a dialog, closes the list behind it.
  const close = () => setOpen(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className="group mx-2 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-md bg-foreground/5 px-2 text-left outline-none ring-1 ring-border transition-colors hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring/25 data-popup-open:bg-foreground/8"
        title="Canvases"
      >
        <Frame className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-body-medium">
          {canvases.find((c) => c.id === current)?.name ?? "No canvas"}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-popup-open:rotate-180" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[min(28rem,var(--available-height))] w-(--anchor-width) gap-0.5 overflow-auto p-1"
        sideOffset={4}
      >
        <div className="px-2 pt-1.5 pb-1 font-body-small text-muted-foreground">
          Canvases
        </div>
        <CanvasList canvases={canvases} current={current} onOpen={close} />
        <div className="my-0.5 h-px bg-border" />
        <button
          className={MENU_ROW}
          onClick={() => {
            close();
            newCanvas();
          }}
          type="button"
        >
          <Plus />
          New canvas
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className={MENU_ROW}
                onClick={() => {
                  close();
                  pickFigmaFile();
                }}
                type="button"
              />
            }
          >
            <FileUp />
            Import a Figma file…
          </TooltipTrigger>
          <TooltipContent side="right">
            An agent turns the frames of a .fig file into pages of this canvas
          </TooltipContent>
        </Tooltip>
      </PopoverContent>
    </Popover>
  );
};
