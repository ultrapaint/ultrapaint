import type { Canvas } from "@ultrapaint/contracts/pages";
import { cn } from "cn";
import {
  Check,
  ChevronsUpDown,
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
import { useProject } from "../state/project.ts";

const CANVAS_DRAG_TYPE = "application/x-ultrapaint-canvas";

/** A name typed in place: Enter keeps it, Escape or leaving the field drops it. */
export const InlineInput = ({
  className,
  mono = false,
  onCancel,
  onSubmit,
  placeholder,
  value,
}: {
  className?: string;
  mono?: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  value: string;
}) => {
  const [draft, setDraft] = useState(value);
  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    setDraft(e.target.value);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // The popover and the canvas have keys of their own; typing is the field's.
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
      className={cn("h-5", mono && "font-mono", className)}
      onBlur={onCancel}
      onChange={onChange}
      onClick={(e: MouseEvent) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
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
  onOpened,
}: {
  canvases: readonly Canvas[];
  current: string | null;
  onOpened: () => void;
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
          onOpened={onOpened}
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
  onOpened,
}: {
  canvas: Canvas;
  current: boolean;
  /** Where a dragged canvas would go: above this one, or below the last. */
  dropAbove: boolean;
  dropBelow: boolean;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onOpened: () => void;
}) => {
  const [renaming, setRenaming] = useState(false);
  const count = useProject(
    (s) =>
      s.pages.filter((p) => p.canvas === canvas.id && p.variant === undefined)
        .length
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
  const open = () => {
    openCanvas(canvas.id);
    onOpened();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the row's buttons raise the menu from the keyboard, and it bubbles here.
    <div
      className={cn(
        "group relative flex h-7 items-center gap-1.5 rounded-md pr-1 pl-1.5 font-body",
        current ? "text-foreground" : "text-muted-foreground hover:bg-muted/50"
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
        {current ? <Check className="size-3" /> : null}
      </span>
      {renaming ? (
        <InlineInput
          onCancel={() => setRenaming(false)}
          onSubmit={rename}
          value={canvas.name}
        />
      ) : (
        <button
          className={cn(
            "flex h-full min-w-0 flex-1 items-center truncate text-left",
            current && "font-medium"
          )}
          onClick={open}
          onDoubleClick={() => setRenaming(true)}
          title={canvas.id === "" ? "The designs directory" : canvas.id}
          type="button"
        >
          <span className="truncate">{canvas.name}</span>
        </button>
      )}
      {renaming ? null : (
        <>
          <span className="shrink-0 font-body text-muted-foreground group-hover:hidden">
            {count} {count === 1 ? "page" : "pages"}
          </span>
          <IconButton
            className="hidden group-hover:flex"
            onClick={menu}
            size="icon-xs"
            tooltip="Canvas actions"
          >
            <EllipsisVertical className="size-3" />
          </IconButton>
        </>
      )}
    </div>
  );
};

/**
 * The canvas on screen, under the project, in every workspace: canvases hold pages, so the
 * switch between them sits above whatever panel is open. It opens the list of canvases.
 */
export const CanvasSwitcher = () => {
  const configured = useProject((s) => s.info.configured);
  const canvases = useProject((s) => s.canvases);
  const current = useEditor((s) => s.canvas);
  const [open, setOpen] = useState(false);
  if (!configured || canvases.length === 0) {
    return null;
  }
  const name = canvases.find((c) => c.id === current)?.name ?? "No canvas";
  const close = () => setOpen(false);
  const create = () => {
    close();
    newCanvas();
  };
  const importFile = () => {
    close();
    pickFigmaFile();
  };
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-left font-body outline-none hover:bg-muted/40 focus-visible:bg-muted/40 data-popup-open:bg-muted/40"
        title="Canvases"
      >
        <Frame className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--anchor-width) min-w-60 gap-1 p-1"
        sideOffset={2}
      >
        <div className="px-2 pt-1 pb-0.5 font-heading-xsmall text-muted-foreground">
          Canvases
        </div>
        <CanvasList canvases={canvases} current={current} onOpened={close} />
        <div className="my-0.5 h-px bg-border" />
        <button
          className="flex h-7 items-center gap-2 rounded-md px-1.5 text-left font-body text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          onClick={create}
          type="button"
        >
          <Plus className="size-3.5" />
          New canvas
        </button>
        <button
          className="flex h-7 items-center gap-2 rounded-md px-1.5 text-left font-body text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          onClick={importFile}
          title="An agent turns the frames of a .fig file into pages of this canvas"
          type="button"
        >
          <FileUp className="size-3.5" />
          Import a Figma file…
        </button>
      </PopoverContent>
    </Popover>
  );
};
