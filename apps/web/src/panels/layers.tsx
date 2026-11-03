/**
 * The layers of the whole canvas, read off its documents: every page with its tree, then the
 * nodes placed on the canvas beside the pages, the way Figma lists the frames of a page. A row
 * selects what it names on the canvas, and rows are dragged to move nodes — inside a page,
 * between pages, onto the canvas and back. A layer is renamed in its row, hidden and locked from
 * it, and found by typing into the filter above the tree. The tree answers the keyboard as the
 * WAI-ARIA tree pattern has it: the arrows walk and fold it, Enter selects, F2 renames. Its keys
 * are the command list's (`focusBindings.layersRow`); the tree hosts their scope.
 */
import { componentDocOf } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import { nodeKind, nodeLabel } from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Layers as LayersIcon,
  Lock,
  LockOpen,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { IconButton } from "../components/icon-button.tsx";
import { NodeIcon } from "../components/node-icon.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { newCanvas } from "../lib/canvas-actions.ts";
import { scopeKeyDown } from "../lib/keymap.ts";
import { describeLink } from "../lib/links.ts";
import {
  moveNode,
  renameNodeTo,
  setHidden,
  setLocked,
} from "../lib/node-actions.ts";
import { newPage, renamePageTo } from "../lib/page-actions.ts";
import { boardTree, useBoard } from "../state/board.ts";
import { openMenuAt, showMenu, useContextMenu } from "../state/context-menu.ts";
import { canvasNodes, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { nodeFrameOf, ownFrameOf } from "../state/frame-ref.ts";
import { useIsolation } from "../state/isolation.ts";
import { useRequest } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import {
  editedFrameOf,
  select,
  selectForMenu,
  selectPage,
  toggleSelected,
  useDrawnIn,
  useIsSelected,
} from "../state/selection.ts";
import { InlineInput } from "./canvases.tsx";
import { type Dragging, rowDrag, rowDrop, useDropHere } from "./layer-drag.ts";
import {
  type DropPosition,
  dropOf,
  type Folds,
  filterLayers,
  findItem,
  flip,
  isOpenIn,
  type LayerItem,
  layerKey,
  layerScope,
  NO_FOLDS,
  oneLevelFolded,
  oneLevelOpen,
  pageKey,
  revealed,
  treeMove,
  type VisibleRow,
  visibleRows,
  withQuery,
} from "./layer-tree.ts";
import { offsetsOf, useListWindow, windowOf } from "./list-window.ts";

/**
 * A row's own indent, and where its chevron sits inside it. A level is the chevron and the gap
 * after it, so a child's chevron sits under its parent's icon.
 */
const ROW_PAD = 4;
const INDENT = 16;
const CHEVRON_CENTER = 8;

/** A node's row: the node, and the frame it is shown in. */
interface Row {
  frame: string;
  node: DesignNode;
}

const clearHover = () => useEditor.getState().setHover(null);

/** The row a key names, once it is drawn. */
const rowElement = (list: HTMLElement | null, key: string) =>
  list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null;

/** The frame a row's node is in: a row names the page, and the view of it the selection is in. */
const rowFrame = (frame: string) =>
  editedFrameOf(useEditor.getState().selection, frame);

/** Selects what a row names: the page as a whole, or the node, Shift adding it to the rest. */
const selectItem = (item: LayerItem, add: boolean) => {
  if (item.page) {
    selectPage(item.page.id);
    return;
  }
  if (!item.node) {
    return;
  }
  const at = { frame: rowFrame(item.frame), nodeId: item.node.id };
  if (add) {
    toggleSelected(at);
  } else {
    select(at);
  }
};

/** The row that stands for what is selected: the node, or the page as a whole. */
const selectedKeyOf = (
  selection: Selection | null,
  selectedPage: string | null
) => {
  // A node selected in a view of a page is the page's row (ADR 0036).
  if (selection) {
    return layerKey(ownFrameOf(selection.frame), selection.nodeId);
  }
  return selectedPage ? pageKey(selectedPage) : null;
};

/**
 * The one row Tab reaches, the tree's focus roving among the others: the first of these that can
 * be seen, else the first row.
 */
const tabStopOf = (
  rows: readonly VisibleRow[],
  wanted: readonly (string | null)[]
) =>
  wanted.find((key) => key !== null && rows.some((r) => r.key === key)) ??
  rows[0]?.key ??
  null;

/** The treeitem a key was pressed on, or the focus went to; null for a field or a button in it. */
const treeItemKey = (target: EventTarget) => {
  const element = target as HTMLElement;
  return element.getAttribute("role") === "treeitem"
    ? (element.dataset.key ?? null)
    : null;
};

/**
 * Opens the way down to the selection whenever it changes (`revealed`). It is adjusted during
 * render rather than in an effect, so the opened tree paints in the same pass; `onReveal` hears of
 * the row, which takes the tree's focus and is scrolled to.
 */
const useRevealSelection = (
  items: readonly LayerItem[],
  setFolds: (next: (folds: Folds) => Folds) => void,
  onReveal: (key: string) => void
) => {
  const selection = useEditor((s) => s.selection);
  const [revealedFor, setRevealedFor] = useState<Selection | null>(null);
  if (selection && selection !== revealedFor) {
    setRevealedFor(selection);
    const key = layerKey(ownFrameOf(selection.frame), selection.nodeId);
    onReveal(key);
    setFolds((folds) => revealed(folds, items, key));
  }
};

/** The field above the tree that narrows it to the layers whose name holds what is typed. */
const LayerFilter = ({
  onDown,
  onQuery,
  query,
}: {
  /** Down from the filter goes into what it found. */
  onDown: () => void;
  onQuery: (query: string) => void;
  query: string;
}) => {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && query !== "") {
      e.stopPropagation();
      onQuery("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onDown();
    }
  };
  return (
    <div className="flex shrink-0 items-center px-2 pb-2">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search layers"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search layers"
          value={query}
        />
        {query === "" ? null : (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label="Clear search"
              onClick={() => onQuery("")}
              size="icon-xs"
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </div>
  );
};

/**
 * The panel's title, with the buttons that open every branch one level more or fold it one level
 * less. Without the tree they do nothing.
 */
const LayersHeading = ({
  onCollapse,
  onExpand,
}: {
  onCollapse?: (() => void) | undefined;
  onExpand?: (() => void) | undefined;
}) => (
  <div className="flex h-11 shrink-0 items-center gap-0.5 pr-2 pl-3">
    <h2 className="flex-1 font-heading-xsmall">Layers</h2>
    <IconButton
      className="text-muted-foreground"
      disabled={!onExpand}
      onClick={onExpand}
      size="icon"
      tooltip="Expand one level"
    >
      <ChevronsUpDown />
    </IconButton>
    <IconButton
      className="text-muted-foreground"
      disabled={!onCollapse}
      onClick={onCollapse}
      size="icon"
      tooltip="Collapse one level"
    >
      <ChevronsDownUp />
    </IconButton>
  </div>
);

/** The heights of the panel's lines, which the window of drawn rows is worked out from. */
const PAGE_ROW = 28;
const PAGE_PROBLEM = 20;
const NODE_ROW = 28;
const HEADING = 36;
/** The room above the first line and below the last. */
const LIST_PAD = 4;
/** Drawn beyond what is seen, either side, so a scroll shows rows already there. */
const OVERSCAN = 300;

/** What the panel shows instead of the tree, or null when there is one to show. */
const emptyOf = (canvas: string | null, loaded: boolean, count: number) => {
  if (canvas === null) {
    return (
      <PanelEmpty
        action={
          <Button onClick={newCanvas} size="sm" variant="secondary">
            New canvas
          </Button>
        }
        icon={<LayersIcon />}
        title="No canvas open"
      >
        Pick a canvas from the menu above to see its pages and their layers.
      </PanelEmpty>
    );
  }
  if (!loaded) {
    return <PanelEmpty>Reading the designs…</PanelEmpty>;
  }
  return count === 0 ? (
    <PanelEmpty
      action={
        <Button onClick={newPage} size="sm" variant="secondary">
          New page
        </Button>
      }
      icon={<LayersIcon />}
      title="No layers yet"
    >
      The pages of this canvas and what is drawn on them are listed here.
    </PanelEmpty>
  ) : null;
};

/**
 * A line of the list: a row, or the heading over the nodes placed on the canvas, or over the app
 * component edited in place.
 */
type Line =
  | { kind: "heading"; text: string }
  | { kind: "row"; row: VisibleRow };

export const Layers = () => {
  const canvas = useEditor((s) => s.canvas);
  const allPages = useProject((s) => s.pages);
  const pages = allPages.filter((p) => p.canvas === canvas);
  const docs = useDocuments((s) => s.docs);
  const loaded = useDocuments((s) => s.loaded);
  const isolated = useIsolation((s) => s.isolated);
  // On an app component's board (ADR 0045), its tree.
  const board = useBoard((s) => s.open);
  const selection = useEditor((s) => s.selection);
  const selectedPage = useEditor((s) => s.selectedPage);
  const [folds, setFolds] = useState<Folds>(NO_FOLDS);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<LayerItem | null>(null);
  /** A row to scroll to once it is drawn, and whether it takes the focus. */
  const [scrollTo, setScrollTo] = useState<{
    focus: boolean;
    key: string;
  } | null>(null);
  const listed = useListWindow(listRef);
  // The tree is built again only when the documents change: a canvas holds thousands of layers,
  // and a selection or a fold changes none of them.
  const { heading, items, nodes } = useMemo(() => {
    const tree = boardTree(board, docs);
    return layerScope({
      canvasNodes: canvasNodes(docs, canvas).map((node) => ({
        frame: nodeFrameOf(node.id),
        node,
      })),
      edited: isolated && {
        component: isolated.component,
        frame: isolated.frame,
        root: docs[componentDocOf(isolated.component)]?.root ?? null,
      },
      pages: allPages.filter((p) => p.canvas === canvas),
      roots: (id) => docs[id]?.root ?? null,
      tree: tree && board && { ...tree, name: board.item },
    });
  }, [allPages, board, canvas, docs, isolated]);

  const { query } = folds;
  const shown = useMemo(() => filterLayers(items, query), [items, query]);
  const rows = useMemo(
    () => visibleRows(shown, isOpenIn(folds)),
    [shown, folds]
  );
  const tabStop = tabStopOf(rows, [
    focusKey,
    selectedKeyOf(selection, selectedPage),
  ]);

  // The lines drawn, with where each starts: the heading goes over the first node on the canvas.
  const lines: Line[] = [];
  const heights: number[] = [];
  let headed = false;
  for (const row of rows) {
    if (!headed && row.level === 1 && !row.item.page) {
      headed = true;
      lines.push({ kind: "heading", text: heading });
      heights.push(HEADING);
    }
    lines.push({ kind: "row", row });
    if (row.item.page) {
      heights.push(
        PAGE_ROW + (docs[row.item.frame]?.problem ? PAGE_PROBLEM : 0)
      );
    } else {
      heights.push(NODE_ROW);
    }
  }
  const tops = offsetsOf(heights);
  const total = tops.at(-1) as number;
  const { end, start } = windowOf(
    tops,
    listed.scrollTop - LIST_PAD,
    listed.height,
    OVERSCAN
  );
  const lineOf = (key: string) =>
    lines.findIndex((l) => l.kind === "row" && l.row.key === key);

  useRevealSelection(items, setFolds, (key) => {
    setFocusKey(key);
    setScrollTo({ focus: false, key });
  });

  /** A row to focus once it is drawn: a row off screen is drawn after the list scrolls to it. */
  const pendingFocus = useRef<string | null>(null);
  /** The last row asked for that was scrolled to: each is scrolled to once. */
  const scrolled = useRef<typeof scrollTo>(null);
  // A row asked for is scrolled to once it is a line of the list, and takes the focus if asked.
  useEffect(() => {
    if (scrollTo && scrollTo !== scrolled.current) {
      const index = lines.findIndex(
        (l) => l.kind === "row" && l.row.key === scrollTo.key
      );
      if (index >= 0) {
        listed.scrollIntoView(
          LIST_PAD + (tops[index] as number),
          LIST_PAD + (tops[index + 1] as number)
        );
        scrolled.current = scrollTo;
        if (scrollTo.focus) {
          pendingFocus.current = scrollTo.key;
        }
      }
    }
    const key = pendingFocus.current;
    const element = key === null ? null : rowElement(listRef.current, key);
    if (element) {
      pendingFocus.current = null;
      element.focus({ preventScroll: true });
    }
  });

  // A row the filter hides is shown again to be renamed.
  // While the panel is on screen, Rename from a menu types the new name into the row.
  useRequest("rename", (target) => {
    const key = layerKey(target.frame, target.nodeId);
    if (findItem(shown, key) === null) {
      setFolds((f) => withQuery(f, ""));
    }
    setRenaming(key);
    setScrollTo({ focus: false, key });
  });

  const flipRows = (keys: readonly string[]) => setFolds((f) => flip(f, keys));
  const toggle = (key: string) => flipRows([key]);
  const toOpen = oneLevelOpen(rows);
  const toFold = oneLevelFolded(rows);

  const focusRow = (key: string) => {
    setFocusKey(key);
    const element = rowElement(listRef.current, key);
    if (element && lineOf(key) >= start && lineOf(key) < end) {
      element.focus();
    }
    setScrollTo({ focus: true, key });
  };

  /** The name is kept or dropped; a row that had the focus while it was typed gets it back. */
  const endRename = (key: string) => {
    const typing = listRef.current?.contains(document.activeElement) ?? false;
    setRenaming(null);
    if (typing) {
      requestAnimationFrame(() => focusRow(key));
    }
  };

  /** Moves the dragged row where it is dropped (`dropOf`). */
  const onDrop = async (over: LayerItem, position: DropPosition) => {
    const place = drag && dropOf(items, drag, over, position, rowFrame);
    if (drag?.node && place) {
      await moveNode({ frame: drag.frame, nodeId: drag.node.id }, place);
    }
  };

  /** Walks the tree from a row: the focus moves, or a row opens or folds. */
  const walkFrom = (key: string, pressed: string) => {
    const move = treeMove(rows, key, pressed);
    if (move && "focus" in move) {
      focusRow(move.focus);
    } else if (move) {
      // A row is opened only when folded, and folded only when open.
      toggle("expand" in move ? move.expand : move.collapse);
    }
  };

  /**
   * The tree's keys, for whichever row has the focus. They are kept from the canvas, whose own
   * arrows walk the selection and whose Enter edits text.
   */
  const onTreeKeyDown = scopeKeyDown("layersRow", (e) => {
    const key = treeItemKey(e.target);
    const item = key === null ? null : findItem(shown, key);
    return item
      ? {
          item,
          rename: () => setRenaming(item.key),
          select: (add) => selectItem(item, add),
          walk: (pressed) => walkFrom(item.key, pressed),
        }
      : null;
  });

  const onTreeFocus = (e: FocusEvent<HTMLDivElement>) => {
    const key = treeItemKey(e.target);
    if (key !== null) {
      setFocusKey(key);
    }
  };

  const onQuery = (next: string) => setFolds((f) => withQuery(f, next));

  const onFilterDown = () => {
    const [first] = rows;
    if (first) {
      focusRow(first.key);
    }
  };

  const empty = emptyOf(canvas, loaded, pages.length + nodes.length);
  if (empty) {
    return (
      <div className="flex h-full flex-col">
        <LayersHeading />
        {empty}
      </div>
    );
  }

  const shared: Shared = {
    drag,
    endRename,
    onDrop,
    renaming,
    setDrag,
    setRenaming,
    tabStop,
    toggle,
  };

  return (
    <div className="flex h-full flex-col">
      <LayersHeading
        onCollapse={toFold.length > 0 ? () => flipRows(toFold) : undefined}
        onExpand={toOpen.length > 0 ? () => flipRows(toOpen) : undefined}
      />
      <LayerFilter onDown={onFilterDown} onQuery={onQuery} query={query} />
      <div
        aria-label="Layers"
        aria-multiselectable="true"
        className="group/tree min-h-0 flex-1 overflow-auto"
        onFocus={onTreeFocus}
        onKeyDown={onTreeKeyDown}
        ref={listRef}
        role="tree"
      >
        {/* Only the lines near what is seen are drawn; the rest is room. */}
        <div
          style={{
            boxSizing: "border-box",
            height: total + LIST_PAD * 2,
            paddingTop: LIST_PAD + (tops[start] ?? 0),
          }}
        >
          {lines.slice(start, end).map((line) => {
            if (line.kind === "heading") {
              return (
                <div
                  className="flex h-9 items-end truncate px-3 pb-1.5 font-small text-muted-foreground"
                  key="heading"
                  role="presentation"
                >
                  {line.text}
                </div>
              );
            }
            const { row } = line;
            return row.item.page ? (
              <PageRow
                expanded={row.expanded}
                item={row.item}
                key={row.key}
                row={row}
                shared={shared}
              />
            ) : (
              <LayerRow
                expanded={row.expanded}
                item={row.item}
                key={row.key}
                row={row}
                shared={shared}
              />
            );
          })}
        </div>
        {shown.length === 0 ? (
          <p className="px-3 py-2 font-small text-muted-foreground">
            No layers match “{query.trim()}”.
          </p>
        ) : null}
      </div>
    </div>
  );
};

interface Shared extends Dragging {
  endRename: (key: string) => void;
  /** The row whose name is being typed. */
  renaming: string | null;
  setRenaming: (key: string | null) => void;
  /** The one row Tab reaches. */
  tabStop: string | null;
  toggle: (key: string) => void;
}

/**
 * A row's name, or the field its new name is typed into. The field opens with the name selected,
 * as a rename does in Figma; Enter keeps what is typed, Escape or a click elsewhere drops it.
 */
const RowName = ({
  className,
  item,
  label,
  onRename,
  shared,
}: {
  className?: string;
  item: LayerItem;
  label: string;
  onRename: (name: string) => void;
  shared: Shared;
}) => {
  if (shared.renaming === item.key) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: it only selects the name the field opens with.
      <span
        className="min-w-0 flex-1"
        onFocus={(e) => (e.target as HTMLInputElement).select()}
      >
        <InlineInput
          className="h-6 px-1.5 font-body"
          onCancel={() => shared.endRename(item.key)}
          onSubmit={(name) => {
            shared.endRename(item.key);
            onRename(name);
          }}
          value={label}
        />
      </span>
    );
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: F2 renames from the keyboard.
    <span
      className={cn("truncate", className)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        shared.setRenaming(item.key);
      }}
    >
      {label}
    </span>
  );
};

/**
 * The element of a row that is its treeitem: what the keyboard focuses. The tree is flat, each
 * row saying its level and its place among its siblings, so only the rows on screen are drawn.
 * What the row shows is its child, so that the focus ring and the selection colour are its alone.
 */
const TreeItem = ({
  children,
  item,
  label,
  onContextMenu,
  row,
  selected,
  shared,
}: {
  children: ReactNode;
  item: LayerItem;
  label: string;
  onContextMenu: (e: MouseEvent) => void;
  row: VisibleRow;
  selected: boolean;
  shared: Shared;
}) => (
  <div
    aria-expanded={row.expandable ? row.expanded : undefined}
    aria-label={label}
    aria-level={row.level}
    aria-posinset={row.position}
    aria-selected={selected}
    aria-setsize={row.siblings}
    className="outline-none"
    data-key={item.key}
    onContextMenu={(e) => {
      // A row under this one has its own menu.
      if (
        (e.target as Element).closest('[role="treeitem"]') === e.currentTarget
      ) {
        onContextMenu(e);
      }
    }}
    role="treeitem"
    tabIndex={shared.tabStop === item.key ? 0 : -1}
  >
    {children}
  </div>
);

/** The focus ring of a row, drawn when its treeitem has the keyboard's focus. */
const FOCUS_RING =
  "[:focus-visible>&]:outline-2 [:focus-visible>&]:outline-ring [:focus-visible>&]:-outline-offset-2";

/**
 * A row's shape: inset from the panel's edges and rounded, filled while it is selected and,
 * lighter, while the pointer is over it or over what it names on the canvas.
 */
const ROW =
  "group relative mx-2 flex h-7 cursor-default items-center gap-1 rounded-md pr-1 transition-colors duration-100";
const rowTone = (selected: boolean, hovered: boolean) => {
  if (selected) {
    return "bg-accent";
  }
  return hovered ? "bg-accent/50" : "hover:bg-accent/50";
};

/** The page's size on the canvas, as its frame's header says it. */
const PageSize = ({ id }: { id: string }) => {
  const frame = useEditor((s) => s.frames[id]);
  return frame ? (
    <span className="shrink-0 font-small text-muted-foreground tabular-nums">
      {Math.round(frame.width)} × {Math.round(frame.height)}
    </span>
  ) : null;
};

/** A page's own row, and its tree under it. */
const PageRow = ({
  expanded,
  item,
  row: line,
  shared,
}: {
  expanded: boolean;
  item: LayerItem;
  row: VisibleRow;
  shared: Shared;
}) => {
  const page = item.page as Page;
  const problem = useDocuments((s) => s.docs[page.id]?.problem);
  const { key } = item;
  const selected = useEditor((s) => s.selectedPage === page.id);
  const dropHere = useDropHere(key);
  const dropHandlers = rowDrop(item, shared);
  const selectThePage = () => {
    selectPage(page.id);
  };
  const route = [page.route, page.variant].filter(Boolean).join(" · ");
  const onContextMenu = (e: MouseEvent) => {
    selectThePage();
    openMenuAt(e, { kind: "page", pageId: page.id });
  };
  const row = (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions lint/a11y/useKeyWithClickEvents: the treeitem around it takes the keys, through the tree.
    <div
      className={cn(
        ROW,
        "gap-1.5 pr-2 text-foreground",
        rowTone(selected, false),
        dropHere !== null && "ring-2 ring-primary ring-inset",
        FOCUS_RING
      )}
      data-row={key}
      onClick={selectThePage}
      {...dropHandlers}
      style={{ paddingLeft: ROW_PAD }}
    >
      <Chevron
        collapsed={!expanded}
        hidden={item.children.length === 0}
        onToggle={() => shared.toggle(key)}
      />
      <RowName
        className="min-w-0 font-label"
        item={item}
        label={page.name}
        onRename={(name) => renamePageTo(page, name)}
        shared={shared}
      />
      {shared.renaming === key ? null : (
        <>
          <span
            className="min-w-0 flex-1 basis-0 truncate font-code text-muted-foreground"
            title={route || undefined}
          >
            {route}
          </span>
          <PageSize id={page.id} />
        </>
      )}
    </div>
  );
  return (
    <TreeItem
      item={item}
      label={page.name}
      onContextMenu={onContextMenu}
      row={line}
      selected={selected}
      shared={shared}
    >
      {row}
      {problem ? (
        <div
          className="mx-2 flex h-5 items-center truncate font-small text-destructive"
          style={{ paddingLeft: ROW_PAD + INDENT + 4 }}
          title={problem}
        >
          Not a valid page: {problem}
        </div>
      ) : null}
    </TreeItem>
  );
};

const Chevron = ({
  collapsed,
  hidden,
  onToggle,
}: {
  collapsed: boolean;
  hidden: boolean;
  onToggle: () => void;
}) => (
  <Button
    aria-label={collapsed ? "Expand" : "Collapse"}
    className={cn(
      "size-4 shrink-0 text-muted-foreground",
      hidden && "invisible"
    )}
    onClick={(e: MouseEvent) => {
      e.stopPropagation();
      onToggle();
    }}
    size="icon-xs"
    tabIndex={-1}
    variant="ghost"
  >
    {collapsed ? (
      <ChevronRight className="size-3" />
    ) : (
      <ChevronDown className="size-3" />
    )}
  </Button>
);

/**
 * One line per level the row is nested under, drawn where that level's chevron sits. The rows sit
 * flush against each other, so a line runs unbroken down the whole of a subtree.
 */
const DepthGuides = ({ ancestors }: { ancestors: readonly string[] }) => (
  <>
    {ancestors.map((id, level) => (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-px bg-border group-hover/tree:bg-foreground/12"
        key={id}
        style={{ left: ROW_PAD + level * INDENT + CHEVRON_CENTER }}
      />
    ))}
  </>
);

/**
 * The row's context menu, for a pointer that does not right-click. Opening it selects the row, so
 * the canvas shows what the actions — and the shortcuts they name — are about to touch.
 */
const RowMenu = ({ row }: { row: Row }) => {
  const { frame, node } = row;
  const open = useContextMenu(
    (s) =>
      s.open &&
      s.request?.target.kind === "node" &&
      s.request.target.frame === frame &&
      s.request.target.nodeId === node.id
  );
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    select({ frame, nodeId: node.id });
    showMenu({ frame, kind: "node", nodeId: node.id }, e.currentTarget);
  };
  return (
    <Button
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={`Actions for ${nodeLabel(node)}`}
      className="hidden shrink-0 text-muted-foreground group-focus-within:flex group-hover:flex aria-expanded:flex"
      onClick={onClick}
      size="icon-sm"
      tabIndex={-1}
      title="More"
      variant="ghost"
    >
      <MoreHorizontal />
    </Button>
  );
};

/**
 * The eye or the lock of a row, as in Figma: shown while the pointer is over the row, and for
 * good while it is on, so that a hidden or a locked layer is seen to be one at a glance. Until
 * then they take no room from the name.
 */
const RowToggle = ({
  children,
  label,
  on,
  onToggle,
}: {
  children: ReactNode;
  label: string;
  on: boolean;
  onToggle: () => void;
}) => (
  <Button
    aria-label={label}
    aria-pressed={on}
    className={cn(
      "shrink-0 text-muted-foreground",
      !on && "hidden group-focus-within:flex group-hover:flex"
    )}
    onClick={(e: MouseEvent) => {
      e.stopPropagation();
      onToggle();
    }}
    size="icon-sm"
    tabIndex={-1}
    title={label}
    variant="ghost"
  >
    {children}
  </Button>
);

/** The lock, the eye and the menu at the end of a node's row. */
const RowControls = ({ row }: { row: Row }) => {
  const { frame } = row;
  // Hidden or shown at the breakpoint of the view the selection is in (ADR 0036).
  const node = useDrawnIn(row.node, frame);
  const target = { frame, nodeId: node.id };
  return (
    <>
      <RowToggle
        label={node.locked ? "Unlock" : "Lock"}
        on={node.locked === true}
        onToggle={() => setLocked(!node.locked, target)}
      >
        {node.locked ? <Lock /> : <LockOpen />}
      </RowToggle>
      <RowToggle
        label={node.hidden ? "Show" : "Hide"}
        on={node.hidden === true}
        onToggle={() => setHidden(!node.hidden, target)}
      >
        {node.hidden ? <EyeOff /> : <Eye />}
      </RowToggle>
      <RowMenu row={row} />
    </>
  );
};

const LayerRow = ({
  expanded,
  item,
  row: visible,
  shared,
}: {
  expanded: boolean;
  item: LayerItem;
  /** Where it is in the list: what it is written under, and whether that is hidden. */
  row: VisibleRow;
  shared: Shared;
}) => {
  const { frame, key } = item;
  const { guides, hiddenAbove } = visible;
  const node = item.node as DesignNode;
  const row: Row = { frame, node };
  const hasChildren = item.children.length > 0;
  const selected = useIsSelected(frame, node.id);
  const hovered = useEditor(
    (s) =>
      s.hover !== null &&
      ownFrameOf(s.hover.frame) === frame &&
      s.hover.nodeId === node.id
  );
  const dropHere = useDropHere(key);
  const dragHandlers = rowDrag(item, shared);
  const renaming = shared.renaming === key;
  const label = nodeLabel(node);
  const target = { frame, nodeId: node.id };
  const drawn = useDrawnIn(node, frame);

  /** Shift-click adds the row to the selection, or takes it out. */
  const onClick = (e: MouseEvent) => selectItem(item, e.shiftKey);
  const onMouseEnter = () => useEditor.getState().setHover(target);
  const onContextMenu = (e: MouseEvent) => {
    selectForMenu({ frame: rowFrame(frame), nodeId: node.id });
    openMenuAt(e, { frame, kind: "node", nodeId: node.id });
  };

  const line = (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions lint/a11y/useKeyWithClickEvents: the treeitem around it takes the keys, through the tree.
    <div
      className={cn(
        ROW,
        "font-body text-foreground",
        rowTone(selected, hovered),
        dropHere === "inside" && "ring-2 ring-primary ring-inset",
        dropHere === "before" &&
          "shadow-[inset_0_2px_0_0_var(--color-primary)]",
        dropHere === "after" &&
          "shadow-[inset_0_-2px_0_0_var(--color-primary)]",
        FOCUS_RING
      )}
      data-row={key}
      draggable={!renaming}
      onClick={onClick}
      {...dragHandlers}
      onMouseEnter={onMouseEnter}
      onMouseLeave={clearHover}
      style={{ paddingLeft: ROW_PAD + guides.length * INDENT }}
      title={nodeKind(node)}
    >
      <DepthGuides ancestors={guides} />
      <Chevron
        collapsed={!expanded}
        hidden={!hasChildren}
        onToggle={() => shared.toggle(key)}
      />
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5",
          (drawn.hidden || hiddenAbove) && "opacity-50"
        )}
      >
        {/* A component's instance keeps the colour its selection has on the canvas. */}
        <NodeIcon
          className={cn(
            "size-3.5 shrink-0",
            node.type === "instance"
              ? "text-component"
              : "text-muted-foreground"
          )}
          node={node}
        />
        <RowName
          item={item}
          label={label}
          onRename={(name) => renameNodeTo(name, target)}
          shared={shared}
        />
        {node.slot && !renaming ? (
          <span
            className="shrink-0 truncate font-small text-muted-foreground"
            title={`Fills the ${node.slot} slot of its system component`}
          >
            {node.slot}
          </span>
        ) : null}
        {node.link && !renaming ? <LinkTag link={node.link} /> : null}
      </span>
      {renaming ? null : <RowControls row={row} />}
    </div>
  );

  return (
    <TreeItem
      item={item}
      label={label}
      onContextMenu={onContextMenu}
      row={visible}
      selected={selected}
      shared={shared}
    >
      {line}
    </TreeItem>
  );
};

/** Where a layer leads in the prototype, after its name; in red when it leads to no page. */
const LinkTag = ({ link }: { link: string }) => {
  const canvas = useEditor((s) => s.canvas);
  const pages = useProject((s) => s.pages);
  const { broken, label } = describeLink(
    pages.filter((p) => p.canvas === canvas),
    link
  );
  return (
    <span
      className={cn(
        "min-w-0 shrink truncate font-small",
        broken ? "text-destructive" : "text-muted-foreground"
      )}
      title={broken ? `${link} leads to a page that is not there` : link}
    >
      → {label}
    </span>
  );
};
