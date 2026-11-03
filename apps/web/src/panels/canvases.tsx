import type { Canvas } from "@ultrapaint/contracts/pages";
import { cn } from "cn";
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
}: {
  canvases: readonly Canvas[];
  current: string | null;
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
}: {
  canvas: Canvas;
  current: boolean;
  /** Where a dragged canvas would go: above this one, or below the last. */
  dropAbove: boolean;
  dropBelow: boolean;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
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
  const open = () => openCanvas(canvas.id);
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
        <button
          className={cn(
            "flex h-full min-w-0 flex-1 items-center truncate text-left outline-none",
            current && "font-label"
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
          <span className="shrink-0 font-small text-muted-foreground tabular-nums group-hover:hidden">
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
export const ModeAndCanvases = () => {
  const configured = useProject((s) => s.info.configured);
  const canvases = useProject((s) => s.canvases);
  const current = useEditor((s) => s.canvas);
  const mode = useEditorMode();
  if (!configured || canvases.length === 0 || mode !== "canvas") {
    return null;
  }
  return <CanvasPicker canvases={canvases} current={current} />;
};

const MENU_ROW =
  "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-left font-body outline-none hover:bg-accent focus-visible:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground";

/** The canvas shown, which opens the list of canvases and what makes a new one, over the panel. */
const CanvasPicker = ({
  canvases,
  current,
}: {
  canvases: readonly Canvas[];
  current: string | null;
}) => (
  <Popover>
    <PopoverTrigger
      className="group mx-1.5 mb-1.5 flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent data-popup-open:bg-accent"
      title="Canvases"
    >
      <Frame className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-label">
        {canvases.find((c) => c.id === current)?.name ?? "No canvas"}
      </span>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-popup-open:rotate-180" />
    </PopoverTrigger>
    <PopoverContent
      align="start"
      className="max-h-[min(28rem,var(--available-height))] w-(--anchor-width) gap-0.5 overflow-auto p-1"
      sideOffset={4}
    >
      <div className="px-2 pt-1.5 pb-1 font-small text-muted-foreground">
        Canvases
      </div>
      <CanvasList canvases={canvases} current={current} />
      <div className="my-0.5 h-px bg-border" />
      <button className={MENU_ROW} onClick={newCanvas} type="button">
        <Plus />
        New canvas
      </button>
      <button
        className={MENU_ROW}
        onClick={pickFigmaFile}
        title="An agent turns the frames of a .fig file into pages of this canvas"
        type="button"
      >
        <FileUp />
        Import a Figma file…
      </button>
    </PopoverContent>
  </Popover>
);
