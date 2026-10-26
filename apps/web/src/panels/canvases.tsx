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
 * The canvas on screen, in a card of its own between the project and the left panel, in every
 * workspace: canvases hold pages, so the switch between them sits above whatever panel is open.
 * Expanded, the card lists the canvases and grows down, and the panel under it gets shorter.
 */
export const CanvasCard = ({ width }: { width: number | null }) => {
  const configured = useProject((s) => s.info.configured);
  const canvases = useProject((s) => s.canvases);
  const current = useEditor((s) => s.canvas);
  const [open, setOpen] = useState(false);
  if (!configured || canvases.length === 0) {
    return null;
  }
  const name = canvases.find((c) => c.id === current)?.name ?? "No canvas";
  return (
    <section
      aria-label="Canvases"
      className="floating pointer-events-auto flex max-h-[50%] shrink-0 flex-col"
      style={width === null ? undefined : { width }}
    >
      <button
        aria-expanded={open}
        className="flex h-9 shrink-0 items-center gap-2 rounded-[inherit] px-3 text-left font-body outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
        onClick={() => setOpen(!open)}
        title={open ? "Hide the canvases" : "Show the canvases"}
        type="button"
      >
        <Frame className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <div className="flex min-h-0 flex-col gap-1 overflow-auto border-t p-1">
          <div className="px-2 pt-1 pb-0.5 font-heading-xsmall text-muted-foreground">
            Canvases
          </div>
          <CanvasList canvases={canvases} current={current} />
          <div className="my-0.5 h-px bg-border" />
          <button
            className="flex h-7 shrink-0 items-center gap-2 rounded-md px-1.5 text-left font-body text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={newCanvas}
            type="button"
          >
            <Plus className="size-3.5" />
            New canvas
          </button>
          <button
            className="flex h-7 shrink-0 items-center gap-2 rounded-md px-1.5 text-left font-body text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={pickFigmaFile}
            title="An agent turns the frames of a .fig file into pages of this canvas"
            type="button"
          >
            <FileUp className="size-3.5" />
            Import a Figma file…
          </button>
        </div>
      ) : null}
    </section>
  );
};
