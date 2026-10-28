/**
 * The layers of the whole canvas, read off its documents: every page with its tree, then the
 * nodes placed on the canvas beside the pages, the way Figma lists the frames of a page. A row
 * selects what it names on the canvas, and rows are dragged to move nodes — inside a page,
 * between pages, onto the canvas and back. A layer is renamed in its row, hidden and locked from
 * it, and found by typing into the filter above the tree. The tree answers the keyboard as the
 * WAI-ARIA tree pattern has it: the arrows walk and fold it, Enter selects, F2 renames. Its keys
 * are the command list's (`focusBindings.layersRow`); the tree hosts their scope.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import {
  childrenOf,
  findPath,
  nodeKind,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  File,
  Lock,
  LockOpen,
  MoreVertical,
  Search,
  X,
} from "lucide-react";
import {
  type DragEvent,
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
import { scopeKeyDown } from "../lib/keymap.ts";
import { describeLink } from "../lib/links.ts";
import {
  moveNode,
  renameNodeTo,
  setHidden,
  setLocked,
} from "../lib/node-actions.ts";
import { renamePageTo } from "../lib/page-actions.ts";
import { openMenuAt, showMenu, useContextMenu } from "../state/context-menu.ts";
import {
  canvasNodes,
  isNodeFrame,
  nodeFrameOf,
  pageOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { type Selection, selectForMenu, useEditor } from "../state/editor.ts";
import {
  openLayersPanel,
  takeRenameRequest,
  useLayerRename,
} from "../state/layer-rename.ts";
import { useProject } from "../state/project.ts";
import {
  editedFrameOf,
  useDrawnIn,
  useIsSelected,
} from "../state/selection.ts";
import { InlineInput } from "./canvases.tsx";
import {
  type DropPosition,
  dropIndex,
  rowDrag,
  setDropTarget,
  useDropHere,
} from "./layer-drag.ts";
import {
  filterLayers,
  type LayerItem,
  layerKey,
  looseItem,
  oneLevelFolded,
  oneLevelOpen,
  openUnless,
  pageItem,
  pageKey,
  pagesOpen,
  treeMove,
  type VisibleRow,
  visibleRows,
} from "./layer-tree.ts";
import { offsetsOf, useListWindow, windowOf } from "./list-window.ts";

/** A row's own indent, and where its chevron sits inside it. */
const ROW_PAD = 8;
const INDENT = 12;
const CHEVRON_CENTER = 8;

/** A row of the panel that names a node: the node, where it sits, and what may be done with it. */
export interface Row {
  /** The frame the node is shown in. */
  frame: string;
  node: DesignNode;
  /** The node it is inside, or null for the top of a page or of the canvas. */
  parent: DesignNode | null;
}

const clearHover = () => useEditor.getState().setHover(null);

/** The item a key names, wherever it is in the tree. */
const findItem = (
  items: readonly LayerItem[],
  key: string
): LayerItem | null => {
  for (const item of items) {
    if (item.key === key) {
      return item;
    }
    const found = findItem(item.children, key);
    if (found) {
      return found;
    }
  }
  return null;
};

/** The row a key names, once it is drawn. */
const rowElement = (list: HTMLElement | null, key: string) =>
  list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null;

/** The frame a row's node is in: a row names the page, and the view of it the selection is in. */
const rowFrame = (frame: string) =>
  editedFrameOf(useEditor.getState().selection, frame);

/** Selects what a row names: the page as a whole, or the node, Shift adding it to the rest. */
const selectItem = (item: LayerItem, add: boolean) => {
  const editor = useEditor.getState();
  if (item.page) {
    editor.selectPage(item.page.id);
    return;
  }
  if (!item.node) {
    return;
  }
  const at = { frame: rowFrame(item.frame), nodeId: item.node.id };
  if (add) {
    editor.toggleSelected(at);
  } else {
    editor.select(at);
  }
};

/** The row that stands for what is selected: the node, or the page as a whole. */
const selectedKeyOf = (
  selection: Selection | null,
  selectedPage: string | null
) => {
  // A node selected in a view of a page is the page's row (ADR 0036).
  if (selection) {
    return layerKey(pageOfFrame(selection.frame), selection.nodeId);
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

/** A set with the key in it, or out of it. */
const withKey = (set: ReadonlySet<string>, key: string, present: boolean) => {
  const next = new Set(set);
  if (present) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
};

/** The treeitem a key was pressed on, or the focus went to; null for a field or a button in it. */
const treeItemKey = (target: EventTarget) => {
  const element = target as HTMLElement;
  return element.getAttribute("role") === "treeitem"
    ? (element.dataset.key ?? null)
    : null;
};

/**
 * Opens the way down to the selection whenever it changes: its page, and the layers it is inside,
 * not the selected one itself. It is adjusted during render rather than in an effect, so the
 * opened tree paints in the same pass; `onReveal` hears of the row, which takes the tree's focus
 * and is scrolled to.
 */
const useRevealSelection = ({
  flipped,
  onReveal,
  rootOf,
  setFlipped,
}: {
  flipped: ReadonlySet<string>;
  onReveal: (key: string) => void;
  rootOf: (frame: string) => { page: boolean; root: DesignNode | null };
  setFlipped: (next: ReadonlySet<string>) => void;
}) => {
  const selection = useEditor((s) => s.selection);
  const [revealed, setRevealed] = useState<Selection | null>(null);
  if (selection && selection !== revealed) {
    setRevealed(selection);
    const frame = pageOfFrame(selection.frame);
    onReveal(layerKey(frame, selection.nodeId));
    const { page, root } = rootOf(frame);
    const path = findPath(root, selection.nodeId);
    if (path) {
      // A page opens by default, a layer when flipped. A page's root is the page's own row.
      const next = new Set(flipped);
      if (page) {
        next.delete(pageKey(frame));
      }
      for (const n of path.slice(page ? 1 : 0, -1)) {
        next.add(layerKey(frame, n.id));
      }
      if (
        next.size !== flipped.size ||
        [...next].some((k) => !flipped.has(k))
      ) {
        setFlipped(next);
      }
    }
  }
};

/**
 * While the panel is open, Rename from a menu types the new name into the row: `onRequest` hears
 * of the node, once for each time it is asked.
 */
const useRenameRequests = (onRequest: (target: Selection) => void) => {
  const request = useLayerRename((s) => s.request);
  const [taken, setTaken] = useState<Selection | null>(null);
  if (request && request !== taken) {
    setTaken(request);
    onRequest(request);
  }
  useEffect(() => {
    if (request) {
      takeRenameRequest();
    }
  }, [request]);
  useEffect(() => openLayersPanel(), []);
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
    <div className="flex items-center border-b px-2 py-1.5">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Find layers"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Find layers…"
          value={query}
        />
        {query === "" ? null : (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label="Clear the filter"
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
  <div className="flex h-9 shrink-0 items-center gap-0.5 pr-1.5 pl-3">
    <span className="flex-1 font-heading-xsmall">Layers</span>
    <IconButton
      disabled={!onExpand}
      onClick={onExpand}
      size="icon-xs"
      tooltip="Expand one level"
    >
      <ChevronsUpDown />
    </IconButton>
    <IconButton
      disabled={!onCollapse}
      onClick={onCollapse}
      size="icon-xs"
      tooltip="Collapse one level"
    >
      <ChevronsDownUp />
    </IconButton>
  </div>
);

/** The heights of the panel's lines, which the window of drawn rows is worked out from. */
const PAGE_ROW = 28;
const PAGE_PROBLEM = 20;
const NODE_ROW = 24;
const HEADING = 32;
/** The room above the first line and below the last. */
const LIST_PAD = 4;
/** Drawn beyond what is seen, either side, so a scroll shows rows already there. */
const OVERSCAN = 300;

/** What the panel says instead of the tree, or null when there is one to show. */
const emptyText = (canvas: string | null, loaded: boolean, count: number) => {
  if (canvas === null) {
    return "Open a canvas from the Pages panel";
  }
  if (!loaded) {
    return "Reading the designs…";
  }
  return count === 0 ? "Nothing on this canvas yet" : null;
};

/** A line of the list: a row, or the heading over the nodes placed on the canvas. */
type Line = { kind: "heading" } | { kind: "row"; row: VisibleRow };

export const Layers = () => {
  const canvas = useEditor((s) => s.canvas);
  const allPages = useProject((s) => s.pages);
  const pages = allPages.filter((p) => p.canvas === canvas);
  const docs = useDocuments((s) => s.docs);
  const loaded = useDocuments((s) => s.loaded);
  const selection = useEditor((s) => s.selection);
  const selectedPage = useEditor((s) => s.selectedPage);
  /** The rows open or folded against how the panel starts out: see `pagesOpen`. */
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  /** What is folded while a filter is typed: everything it finds starts out open. */
  const [foldedInFilter, setFoldedInFilter] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [query, setQuery] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Row | null>(null);
  /** A row to scroll to once it is drawn, and whether it takes the focus. */
  const [scrollTo, setScrollTo] = useState<{
    focus: boolean;
    key: string;
  } | null>(null);
  const listed = useListWindow(listRef);
  // The tree is built again only when the documents change: a canvas holds thousands of layers,
  // and a selection or a fold changes none of them.
  const { items, nodes } = useMemo(() => {
    const placed = canvasNodes(docs, canvas);
    return {
      items: [
        ...allPages
          .filter((p) => p.canvas === canvas)
          .map((page) => pageItem(page, docs[page.id]?.root ?? null)),
        ...placed.map((node) => looseItem(nodeFrameOf(node.id), node)),
      ],
      nodes: placed,
    };
  }, [allPages, canvas, docs]);

  const filtering = query.trim() !== "";
  const setFolding = filtering ? setFoldedInFilter : setFlipped;
  const shown = useMemo(() => filterLayers(items, query), [items, query]);
  const isOpen = filtering ? openUnless(foldedInFilter) : pagesOpen(flipped);
  const rows = useMemo(
    () =>
      visibleRows(
        shown,
        filtering ? openUnless(foldedInFilter) : pagesOpen(flipped)
      ),
    [shown, filtering, foldedInFilter, flipped]
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
      lines.push({ kind: "heading" });
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

  useRevealSelection({
    flipped,
    onReveal: (key) => {
      setFocusKey(key);
      setScrollTo({ focus: false, key });
    },
    rootOf: (frame) => {
      const doc = docs[pageOfFrame(frame)];
      if (doc) {
        return { page: true, root: doc.root ?? null };
      }
      return {
        page: false,
        root: nodes.find((n) => nodeFrameOf(n.id) === frame) ?? null,
      };
    },
    setFlipped,
  });

  /** A row to focus once it is drawn: a row off screen is drawn after the list scrolls to it. */
  const pendingFocus = useRef<string | null>(null);
  // A row asked for is scrolled to once it is a line of the list, and takes the focus if asked.
  useEffect(() => {
    if (scrollTo) {
      const index = lines.findIndex(
        (l) => l.kind === "row" && l.row.key === scrollTo.key
      );
      if (index >= 0) {
        listed.scrollIntoView(
          LIST_PAD + (tops[index] as number),
          LIST_PAD + (tops[index + 1] as number)
        );
        setScrollTo(null);
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
  useRenameRequests((target) => {
    const key = layerKey(target.frame, target.nodeId);
    if (findItem(shown, key) === null) {
      setQuery("");
    }
    setRenaming(key);
    setScrollTo({ focus: false, key });
  });

  const toggle = (key: string) =>
    setFolding((prev) => withKey(prev, key, !prev.has(key)));

  /** Opens or folds each of the rows, from whichever way it is now. */
  const flipRows = (keys: readonly string[]) =>
    setFolding((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (!next.delete(key)) {
          next.add(key);
        }
      }
      return next;
    });
  const toOpen = oneLevelOpen(rows);
  const toFold = oneLevelFolded(rows);

  /** Opens or folds a row, whichever way it is by default. */
  const setRowOpen = (key: string, open: boolean) => {
    const item = findItem(shown, key);
    if (item && isOpen(item) !== open) {
      toggle(key);
    }
  };

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

  /** Moves the dragged row next to, or into, the target row: across documents too. */
  const onDrop = async (target: Row, position: DropPosition) => {
    if (!drag) {
      return;
    }
    const into = position === "inside" ? target.node : target.parent;
    const index = dropIndex(
      into ? childrenOf(into) : nodes,
      drag.node.id,
      target.node.id,
      position
    );
    await moveNode(
      { frame: drag.frame, nodeId: drag.node.id },
      into
        ? {
            frame: rowFrame(target.frame),
            index,
            kind: "into",
            parent: into.id,
          }
        : {
            // From a page onto the canvas beside a node on it: just below that one.
            ...(!isNodeFrame(drag.frame) && {
              at: { x: target.node.x ?? 0, y: (target.node.y ?? 0) + 40 },
            }),
            index,
            kind: "canvas",
          }
    );
  };

  /** Walks the tree from a row: the focus moves, or a row opens or folds. */
  const walkFrom = (key: string, pressed: string) => {
    const move = treeMove(rows, key, pressed);
    if (move && "focus" in move) {
      focusRow(move.focus);
    } else if (move && "expand" in move) {
      setRowOpen(move.expand, true);
    } else if (move) {
      setRowOpen(move.collapse, false);
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

  const onQuery = (next: string) => {
    setQuery(next);
    setFoldedInFilter(new Set());
  };

  const onFilterDown = () => {
    const [first] = rows;
    if (first) {
      focusRow(first.key);
    }
  };

  const empty = emptyText(canvas, loaded, pages.length + nodes.length);
  if (empty) {
    return (
      <div className="flex h-full flex-col">
        <LayersHeading />
        <PanelEmpty>{empty}</PanelEmpty>
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
        className="min-h-0 flex-1 overflow-auto"
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
                  className="flex h-8 items-end px-3 pb-0.5 font-heading-xsmall text-muted-foreground uppercase"
                  key="heading"
                  role="presentation"
                >
                  On the canvas
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
          <div className="px-3 py-2 font-body text-muted-foreground">
            No layer goes by that name
          </div>
        ) : null}
      </div>
    </div>
  );
};

export interface Shared {
  drag: Row | null;
  endRename: (key: string) => void;
  onDrop: (target: Row, position: DropPosition) => Promise<void>;
  /** The row whose name is being typed. */
  renaming: string | null;
  setDrag: (row: Row | null) => void;
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
          className="h-5 px-1 font-body leading-4"
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
  "[:focus-visible>&]:outline-1 [:focus-visible>&]:outline-ring [:focus-visible>&]:-outline-offset-1";

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
  const root = item.node;
  const { key } = item;
  const selected = useEditor((s) => s.selectedPage === page.id);
  const dropHere = useDropHere(key);
  const select = () => {
    useEditor.getState().selectPage(page.id);
  };
  const onContextMenu = (e: MouseEvent) => {
    select();
    openMenuAt(e, { kind: "page", pageId: page.id });
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!(shared.drag && root)) {
      return;
    }
    e.preventDefault();
    setDropTarget({ key, position: "inside" });
  };
  const onDropHere = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropTarget(null);
    if (root) {
      shared.onDrop({ frame: page.id, node: root, parent: null }, "inside");
    }
    shared.setDrag(null);
  };
  const row = (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions lint/a11y/useKeyWithClickEvents: the treeitem around it takes the keys, through the tree.
    <div
      className={cn(
        "group relative flex h-7 cursor-default items-center gap-1 pr-1 font-body font-medium",
        selected
          ? "bg-selection/25 text-foreground"
          : "text-foreground hover:bg-muted/50",
        dropHere !== null && "ring-1 ring-brand ring-inset",
        FOCUS_RING
      )}
      data-row={key}
      onClick={select}
      onDragLeave={() => setDropTarget(null)}
      onDragOver={onDragOver}
      onDrop={onDropHere}
      style={{ paddingLeft: ROW_PAD }}
    >
      <Chevron
        collapsed={!expanded}
        hidden={item.children.length === 0}
        onToggle={() => shared.toggle(key)}
      />
      <File className="size-3 shrink-0 text-muted-foreground" />
      <RowName
        item={item}
        label={page.name}
        onRename={(name) => renamePageTo(page, name)}
        shared={shared}
      />
      {shared.renaming === key ? null : (
        <span className="ml-auto truncate pr-1 font-code text-muted-foreground">
          {[page.route, page.variant].filter(Boolean).join(" · ")}
        </span>
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
          className="flex h-5 items-center truncate px-8 font-body text-destructive"
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
        className="pointer-events-none absolute inset-y-0 w-px bg-border"
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
    useEditor.getState().select({ frame, nodeId: node.id });
    showMenu({ frame, kind: "node", nodeId: node.id }, e.currentTarget);
  };
  return (
    <Button
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={`Actions for ${nodeLabel(node)}`}
      className="invisible size-5 shrink-0 text-muted-foreground group-focus-within:visible group-hover:visible aria-expanded:visible"
      onClick={onClick}
      size="icon-xs"
      tabIndex={-1}
      variant="ghost"
    >
      <MoreVertical className="size-3" />
    </Button>
  );
};

/**
 * The eye or the lock of a row, as in Figma: shown while the pointer is over the row, and for
 * good while it is on, so that a hidden or a locked layer is seen to be one at a glance.
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
      "size-5 shrink-0 text-muted-foreground",
      !on && "invisible group-focus-within:visible group-hover:visible"
    )}
    onClick={(e: MouseEvent) => {
      e.stopPropagation();
      onToggle();
    }}
    size="icon-xs"
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
        {node.locked ? (
          <Lock className="size-3" />
        ) : (
          <LockOpen className="size-3" />
        )}
      </RowToggle>
      <RowToggle
        label={node.hidden ? "Show" : "Hide"}
        on={node.hidden === true}
        onToggle={() => setHidden(!node.hidden, target)}
      >
        {node.hidden ? (
          <EyeOff className="size-3" />
        ) : (
          <Eye className="size-3" />
        )}
      </RowToggle>
      <RowMenu row={row} />
    </>
  );
};

/** A component's row takes the component colour when selected, as its selection on the canvas does. */
const rowTone = (selected: boolean, hovered: boolean, component = false) => {
  if (selected) {
    return component
      ? "bg-component/30 text-foreground"
      : "bg-selection/25 text-foreground";
  }
  return hovered
    ? "bg-muted text-foreground"
    : "text-muted-foreground hover:bg-muted/50";
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
  const row: Row = { frame, node, parent: item.parent };
  const hasChildren = item.children.length > 0;
  const selected = useIsSelected(frame, node.id);
  const hovered = useEditor(
    (s) =>
      s.hover !== null &&
      pageOfFrame(s.hover.frame) === frame &&
      s.hover.nodeId === node.id
  );
  const dropHere = useDropHere(key);
  const dragHandlers = rowDrag(row, key, shared);
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
        "group relative flex h-6 cursor-default items-center gap-1 pr-1 font-body",
        rowTone(selected, hovered, node.type === "instance"),
        dropHere === "inside" && "ring-1 ring-brand ring-inset",
        dropHere === "before" && "shadow-[inset_0_2px_0_0_var(--color-brand)]",
        dropHere === "after" && "shadow-[inset_0_-2px_0_0_var(--color-brand)]",
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
          "flex min-w-0 flex-1 items-center gap-1",
          (drawn.hidden || hiddenAbove) && "opacity-50"
        )}
      >
        <span
          className={cn(
            "shrink-0 text-muted-foreground",
            node.type === "instance" && "text-component",
            selected && "text-foreground"
          )}
        >
          <NodeIcon node={node} />
        </span>
        <RowName
          className={cn(
            node.type === "instance" && "font-medium text-component",
            selected && node.type === "instance" && "text-foreground"
          )}
          item={item}
          label={label}
          onRename={(name) => renameNodeTo(name, target)}
          shared={shared}
        />
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
        "min-w-0 shrink truncate font-body",
        broken ? "text-destructive" : "text-muted-foreground/70"
      )}
      title={broken ? `${link} leads to a page that is not there` : link}
    >
      → {label}
    </span>
  );
};
