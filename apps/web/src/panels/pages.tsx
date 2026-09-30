import type { Canvas, Page } from "@ultrapaint/contracts/pages";
import { routeSegments } from "@ultrapaint/shared/route";
import { cn } from "cn";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  EllipsisVertical,
  FilePlus2,
  FileUp,
  House,
  List,
  ListTree,
  Pencil,
  Plus,
  Split,
  SquareDashed,
  Trash2,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
import {
  newCanvas,
  openCanvas,
  renameCanvas,
  reorderCanvases,
} from "../lib/canvas-actions.ts";
import { importFigma } from "../lib/import-figma.ts";
import {
  deletePage,
  duplicatePage,
  implementPage,
  moveRoute,
} from "../lib/page-actions.ts";
import { api } from "../state/connection.ts";
import { openMenuAt, showMenu } from "../state/context-menu.ts";
import { useEditor } from "../state/editor.ts";
import { usePagePicks } from "../state/page-picks.ts";
import { reportError, useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";

/** A row's own indent, and where its chevron sits inside it, as in the layers tree. */
const ROW_PAD = 8;
const INDENT = 12;
const CHEVRON_CENTER = 8;

interface RouteNode {
  children: RouteNode[];
  /** The page serving this route, or null for a segment only its children have pages under. */
  page: Page | null;
  route: string;
  segment: string;
  /** The route's pages drawn for a variant, in the canvas's order of variants. */
  variants: Page[];
}

const emptyNode = (route: string, segment: string): RouteNode => ({
  children: [],
  page: null,
  route,
  segment,
  variants: [],
});

const byVariant = (order: readonly string[]) => (a: Page, b: Page) =>
  order.indexOf(a.variant ?? "") - order.indexOf(b.variant ?? "");

/** The routes of a canvas as a tree, one level per segment, the way the paths nest. */
const routeTree = (
  pages: readonly Page[],
  variants: readonly string[]
): RouteNode => {
  const root = emptyNode("/", "/");
  for (const page of [...pages].sort((a, b) =>
    a.route.localeCompare(b.route)
  )) {
    let node = root;
    let route = "";
    for (const segment of routeSegments(page.route)) {
      route += `/${segment}`;
      const existing = node.children.find((c) => c.segment === segment);
      if (existing) {
        node = existing;
      } else {
        const child = emptyNode(route, segment);
        node.children.push(child);
        node = child;
      }
    }
    if (page.variant === undefined) {
      node.page = page;
    } else {
      node.variants.push(page);
      node.variants.sort(byVariant(variants));
    }
  }
  return root;
};

const countPages = (node: RouteNode): number =>
  (node.page ? 1 : 0) +
  node.children.reduce((sum, child) => sum + countPages(child), 0);

type View = "grouped" | "flat";

const VIEW_KEY = "ultrapaint:pages-view";

const readView = (): View =>
  localStorage.getItem(VIEW_KEY) === "flat" ? "flat" : "grouped";

/** Every route that has a page, one row each, in route order, its variants under it. */
const flatRows = (
  pages: readonly Page[],
  variants: readonly string[]
): RouteNode[] =>
  [...pages]
    .filter((page) => page.variant === undefined)
    .sort((a, b) => a.route.localeCompare(b.route))
    .map((page) => ({
      ...emptyNode(page.route, page.route),
      page,
      variants: pages
        .filter((p) => p.variant !== undefined && p.route === page.route)
        .sort(byVariant(variants)),
    }));

export const Pages = () => {
  const configured = useProject((s) => s.info.configured);
  const canvases = useProject((s) => s.canvases);
  const pages = useProject((s) => s.pages);
  const canvas = useEditor((s) => s.canvas);
  const inCanvas = pages.filter((p) => p.canvas === canvas);
  const variants = canvases.find((c) => c.id === canvas)?.variants ?? [];
  const [creating, setCreating] = useState(false);
  const figmaInput = useRef<HTMLInputElement>(null);
  const onFigmaPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const [file] = e.target.files ?? [];
    e.target.value = "";
    if (file) {
      importFigma(file);
    }
  };
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>(readView);
  const activeRoute = useEditor((s) =>
    s.activePage === null
      ? null
      : (pages.find((p) => p.id === s.activePage)?.route ?? null)
  );

  // Arriving on a page opens the groups it sits in; collapsing one afterwards still works.
  const [revealed, setRevealed] = useState<string | null>(null);
  if (activeRoute !== revealed) {
    setRevealed(activeRoute);
    if (activeRoute !== null) {
      const hidden = [...collapsed].filter((route) =>
        activeRoute.startsWith(`${route}/`)
      );
      if (hidden.length > 0) {
        setCollapsed(
          new Set([...collapsed].filter((r) => !hidden.includes(r)))
        );
      }
    }
  }

  const toggleCreating = () => setCreating((c) => !c);
  const toggleView = () => {
    const next: View = view === "flat" ? "grouped" : "flat";
    localStorage.setItem(VIEW_KEY, next);
    setView(next);
  };
  const toggle = (route: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(route)) {
        next.delete(route);
      } else {
        next.add(route);
      }
      return next;
    });

  if (!configured) {
    return <SetupEmpty />;
  }

  const tree = routeTree(inCanvas, variants);
  // The root row only exists when a page serves `/`; the routes under it sit beside it.
  const rows =
    view === "flat"
      ? flatRows(inCanvas, variants)
      : [
          ...(tree.page || tree.variants.length > 0
            ? [{ ...tree, children: [] }]
            : []),
          ...tree.children,
        ];

  return (
    <div className="flex flex-col">
      <CanvasList canvases={canvases} current={canvas} />
      <div className="flex items-center gap-1 border-y px-2 py-1.5">
        <span className="flex-1 truncate font-medium text-[11px] text-muted-foreground">
          Pages
        </span>
        <IconButton
          onClick={toggleView}
          tooltip={view === "flat" ? "Group by route" : "Show as a flat list"}
        >
          {view === "flat" ? <ListTree /> : <List />}
        </IconButton>
        <IconButton
          onClick={() => figmaInput.current?.click()}
          tooltip="Import a Figma file (.fig): an agent turns its frames into pages"
        >
          <FileUp />
        </IconButton>
        <input
          accept=".fig"
          className="hidden"
          onChange={onFigmaPicked}
          ref={figmaInput}
          type="file"
        />
        <IconButton onClick={toggleCreating} tooltip="New page">
          <FilePlus2 />
        </IconButton>
      </div>
      {creating ? <NewPage onDone={() => setCreating(false)} /> : null}
      {inCanvas.length === 0 ? (
        <PanelEmpty>No pages yet. Create one to start.</PanelEmpty>
      ) : (
        <div className="py-1">
          {rows.map((node) => (
            <Row
              collapsed={collapsed}
              depth={0}
              flat={view === "flat"}
              key={node.route}
              node={node}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** A page's row: the one the router is on, one picked with others, or neither. */
const rowClass = (active: boolean, picked: boolean) =>
  cn(
    "group flex h-6 items-center gap-1 pr-1 text-[11px]",
    active && "bg-brand/20 text-foreground",
    !active && picked && "bg-muted text-foreground",
    !(active || picked) && "text-muted-foreground hover:bg-muted/50"
  );

/**
 * A page opened from the list, or picked with ⌘ or Shift for a menu that acts on several; the
 * router then stays where it is. Opening a variant's page puts the router in its variant.
 */
const openPage = (page: Page, e: MouseEvent) => {
  const picks = usePagePicks.getState();
  if (e.metaKey || e.ctrlKey || e.shiftKey) {
    picks.toggle(page.id);
    return;
  }
  picks.clear();
  const editor = useEditor.getState();
  const variant = page.variant ?? null;
  if (editor.variant !== variant) {
    editor.setVariant(variant);
  }
  // Already there: stay on the route, and on the parameters it was reached with.
  if (editor.activePage !== page.id) {
    editor.navigate(page.route);
  }
};

const Row = ({
  node,
  depth,
  collapsed,
  flat = false,
  onToggle,
}: {
  collapsed: Set<string>;
  depth: number;
  /** A row of the flat list: the whole route as its label, no chevron. */
  flat?: boolean;
  node: RouteNode;
  onToggle: (route: string) => void;
}) => {
  const { page } = node;
  // The page serving the router's route, so `/invoices/42` selects `/invoices/:id`.
  const active = useEditor((s) => page !== null && s.activePage === page.id);
  const picked = usePagePicks((s) => page !== null && s.ids.includes(page.id));
  const [renaming, setRenaming] = useState<string | null>(null);
  const open = !collapsed.has(node.route);
  const hasChildren = node.children.length > 0 || node.variants.length > 0;

  const go = (e: MouseEvent) => {
    if (page) {
      openPage(page, e);
    } else {
      onToggle(node.route);
    }
  };
  const chevron = (e: MouseEvent) => {
    e.stopPropagation();
    onToggle(node.route);
  };
  const startRenaming = (e: MouseEvent) => {
    e.stopPropagation();
    setRenaming(node.route);
  };
  const duplicate = (e: MouseEvent) => {
    e.stopPropagation();
    if (page) {
      duplicatePage(page);
    }
  };
  const remove = (e: MouseEvent) => {
    e.stopPropagation();
    if (page) {
      deletePage(page);
    }
  };
  const rename = (to: string) => {
    setRenaming(null);
    if (page) {
      moveRoute(page, to);
    }
  };
  const onContextMenu = (e: MouseEvent) =>
    openMenuAt(
      e,
      page
        ? { kind: "page", pageId: page.id }
        : { kind: "route", route: node.route }
    );

  const Icon = node.route === "/" ? House : SquareDashed;

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the row's buttons raise the menu from the keyboard, and it bubbles here. */}
      <div
        className={cn(rowClass(active, picked), !page && "italic")}
        onContextMenu={onContextMenu}
        style={{ paddingLeft: ROW_PAD + depth * INDENT }}
      >
        {!flat && hasChildren ? (
          <button
            aria-label={open ? "Collapse" : "Expand"}
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
            onClick={chevron}
            type="button"
          >
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </button>
        ) : null}
        {flat || hasChildren ? null : (
          <span style={{ width: CHEVRON_CENTER * 2 }} />
        )}
        {renaming === null ? (
          <button
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 truncate text-left"
            onClick={go}
            title={node.route}
            type="button"
          >
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {flat || node.route === "/" ? node.route : node.segment}
            </span>
            {page ? null : (
              <span className="shrink-0 text-[10px]">
                {countPages(node)} pages
              </span>
            )}
          </button>
        ) : (
          <RouteInput
            onCancel={() => setRenaming(null)}
            onSubmit={rename}
            value={renaming}
          />
        )}
        {page && renaming === null ? (
          <span className="hidden items-center group-hover:flex">
            <IconButton
              onClick={startRenaming}
              size="icon-xs"
              tooltip="Change route"
            >
              <Pencil className="size-3" />
            </IconButton>
            <IconButton onClick={duplicate} size="icon-xs" tooltip="Duplicate">
              <Copy className="size-3" />
            </IconButton>
            <IconButton
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                implementPage(page);
              }}
              size="icon-xs"
              tooltip="Implement in the application with an agent"
            >
              <Code className="size-3" />
            </IconButton>
            <IconButton onClick={remove} size="icon-xs" tooltip="Delete">
              <Trash2 className="size-3" />
            </IconButton>
          </span>
        ) : null}
      </div>
      {open ? (
        <>
          {node.variants.map((variant) => (
            <VariantRow depth={depth + 1} key={variant.id} page={variant} />
          ))}
          {node.children.map((child) => (
            <Row
              collapsed={collapsed}
              depth={depth + 1}
              key={child.route}
              node={child}
              onToggle={onToggle}
            />
          ))}
        </>
      ) : null}
    </>
  );
};

/** A route's page drawn for a variant: opening it puts the router in that variant. */
const VariantRow = ({ depth, page }: { depth: number; page: Page }) => {
  const active = useEditor((s) => s.activePage === page.id);
  const picked = usePagePicks((s) => s.ids.includes(page.id));
  const go = (e: MouseEvent) => openPage(page, e);
  const onContextMenu = (e: MouseEvent) =>
    openMenuAt(e, { kind: "page", pageId: page.id });
  const stop = (f: () => unknown) => (e: MouseEvent) => {
    e.stopPropagation();
    f();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the row's buttons raise the menu from the keyboard, and it bubbles here.
    <div
      className={rowClass(active, picked)}
      onContextMenu={onContextMenu}
      style={{ paddingLeft: ROW_PAD + depth * INDENT + CHEVRON_CENTER * 2 }}
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 truncate text-left"
        onClick={go}
        title={`${page.route} in the ${page.variant} variant`}
        type="button"
      >
        <Split className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{page.variant}</span>
      </button>
      <span className="hidden items-center group-hover:flex">
        <IconButton
          onClick={stop(() => duplicatePage(page))}
          size="icon-xs"
          tooltip="Duplicate"
        >
          <Copy className="size-3" />
        </IconButton>
        <IconButton
          onClick={stop(() => deletePage(page))}
          size="icon-xs"
          tooltip="Delete"
        >
          <Trash2 className="size-3" />
        </IconButton>
      </span>
    </div>
  );
};

const CANVASES_OPEN_KEY = "ultrapaint:canvases-open";
const CANVAS_DRAG_TYPE = "application/x-ultrapaint-canvas";

/**
 * The canvases of the project, as Figma lists the pages of a file: one opens at a time, and each
 * has its own pages, routes and loose nodes. Dragged to reorder; double-clicked to rename.
 */
const CanvasList = ({
  canvases,
  current,
}: {
  canvases: readonly Canvas[];
  current: string | null;
}) => {
  const [open, setOpen] = useState(
    () => localStorage.getItem(CANVASES_OPEN_KEY) !== "false"
  );
  const [dropAt, setDropAt] = useState<number | null>(null);
  const toggle = () => {
    localStorage.setItem(CANVASES_OPEN_KEY, String(!open));
    setOpen(!open);
  };
  const name = canvases.find((c) => c.id === current)?.name;
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
    <div
      className="flex flex-col pb-1"
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex h-7 items-center gap-1 pr-1 pl-2">
        <button
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium text-[11px] text-muted-foreground hover:text-foreground"
          onClick={toggle}
          type="button"
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          <span className="shrink-0">Canvases</span>
          {open || name === undefined ? null : (
            <span className="truncate font-normal">· {name}</span>
          )}
        </button>
        <IconButton onClick={newCanvas} size="icon-xs" tooltip="New canvas">
          <Plus className="size-3" />
        </IconButton>
      </div>
      {open
        ? canvases.map((canvas, index) => (
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
          ))
        : null}
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
  const onContextMenu = (e: MouseEvent) =>
    openMenuAt(e, { canvasId: canvas.id, kind: "canvasEntry" });
  const onMore = (e: MouseEvent) => {
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
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the row's buttons raise the menu from the keyboard, and it bubbles here.
    <div
      className={cn(
        "group relative flex h-6 items-center gap-1.5 pr-1 pl-2 text-[11px]",
        current ? "text-foreground" : "text-muted-foreground hover:bg-muted/50"
      )}
      draggable={!renaming}
      onContextMenu={onContextMenu}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
    >
      {dropAbove ? (
        <span className="absolute inset-x-2 top-0 h-px bg-brand" />
      ) : null}
      {dropBelow ? (
        <span className="absolute inset-x-2 bottom-0 h-px bg-brand" />
      ) : null}
      <span className="flex size-4 shrink-0 items-center justify-center">
        {current ? <Check className="size-3" /> : null}
      </span>
      {renaming ? (
        <RouteInput
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
          onClick={() => openCanvas(canvas.id)}
          onDoubleClick={() => setRenaming(true)}
          title={canvas.id === "" ? "The designs directory" : canvas.id}
          type="button"
        >
          <span className="truncate">{canvas.name}</span>
        </button>
      )}
      {renaming ? null : (
        <>
          <span className="shrink-0 text-[10px] text-muted-foreground group-hover:hidden">
            {count}
          </span>
          <IconButton
            className="hidden group-hover:flex"
            onClick={onMore}
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

const RouteInput = ({
  value,
  onSubmit,
  onCancel,
}: {
  onCancel: () => void;
  onSubmit: (value: string) => void;
  value: string;
}) => {
  const [draft, setDraft] = useState(value);
  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    setDraft(e.target.value);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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
      className="h-5"
      onBlur={onCancel}
      onChange={onChange}
      onKeyDown={onKeyDown}
      value={draft}
    />
  );
};

/** New page: a route to serve and the template to start from. */
const NewPage = ({ onDone }: { onDone: () => void }) => {
  const configured = useProject((s) => s.info.configured);
  const canvas = useEditor((s) => s.canvas);
  const route = useEditor((s) => s.route);
  const [value, setValue] = useState(route === "/" ? "/" : `${route}/`);
  const [template, setTemplate] = useState("centered");
  const [templates, setTemplates] = useState<
    readonly { id: string; name: string }[]
  >([]);

  useEffect(() => {
    if (!configured) {
      return;
    }
    api()
      .request("pages.templates", undefined)
      .then(setTemplates)
      .catch(() => undefined);
  }, [configured]);

  const create = async () => {
    if (!ensureEditable()) {
      return;
    }
    try {
      const page = await api().request("pages.create", {
        canvas: canvas ?? "",
        route: value,
        template,
      });
      onDone();
      useEditor.getState().navigate(page.route);
    } catch (error) {
      reportError(error);
    }
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    setValue(e.target.value);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      create();
    }
  };

  return (
    <div className="flex flex-col gap-1.5 border-b bg-muted/30 p-2">
      <Input
        autoFocus
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Route, e.g. /settings/billing"
        value={value}
      />
      <OptionSelect
        onChange={setTemplate}
        options={templates.map((t) => ({ label: t.name, value: t.id }))}
        value={template}
      />
      <div className="flex justify-end gap-1">
        <Button onClick={onDone} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button onClick={create} size="sm">
          Create
        </Button>
      </div>
    </div>
  );
};
