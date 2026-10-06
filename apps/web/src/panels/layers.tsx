/**
 * The layers of the whole canvas, read off its documents: every page with its tree, then the
 * nodes placed on the canvas beside the pages, the way Figma lists the frames of a page. A row
 * selects what it names on the canvas, and rows are dragged to move nodes — inside a page,
 * between pages, onto the canvas and back. A layer is renamed in its row, hidden and locked from
 * it, and found by typing into the filter above the tree. The tree answers the keyboard as the
 * WAI-ARIA tree pattern has it: the arrows walk and fold it, Enter selects, F2 renames.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import {
  canvasDocOf,
  childrenOf,
  findPath,
  nodeKind,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  ChevronDown,
  ChevronRight,
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
  type RefObject,
  useEffect,
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
import { NodeIcon } from "../components/node-icon.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { describeLink } from "../lib/links.ts";
import { renameNodeTo, setHidden, setLocked } from "../lib/node-actions.ts";
import { renamePageTo } from "../lib/page-actions.ts";
import { openMenuAt, showMenu, useContextMenu } from "../state/context-menu.ts";
import {
  applyEdits,
  canvasNodes,
  docOfFrame,
  frameOfCanvasNode,
  nodeFrameOf,
  useDocuments,
} from "../state/documents.ts";
import { type Selection, selectForMenu, useEditor } from "../state/editor.ts";
import {
  openLayersPanel,
  takeRenameRequest,
  useLayerRename,
} from "../state/layer-rename.ts";
import { useProject } from "../state/project.ts";
import { InlineInput } from "./canvases.tsx";
import {
  type DropPosition,
  dropIndex,
  layerMoveEdits,
  rowDrag,
  setDropTarget,
  useDropHere,
} from "./layer-drag.ts";
import {
  filterLayers,
  isExpanded,
  type LayerItem,
  layerKey,
  looseItem,
  pageItem,
  pageKey,
  TREE_KEYS,
  treeMove,
  type VisibleRow,
  visibleRows,
} from "./layer-tree.ts";

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
  const at = { frame: item.frame, nodeId: item.node.id };
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
  if (selection) {
    return layerKey(selection.frame, selection.nodeId);
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

/** The node a row names, as the selection would. */
const at = (item: LayerItem): Selection | undefined =>
  item.node ? { frame: item.frame, nodeId: item.node.id } : undefined;

/**
 * Keys that do something to the focused row itself, past walking the tree: Enter and Space select
 * it, Shift adding it to the rest; F2 renames it; ⇧⌘H and ⇧⌘L hide and lock it, as in Figma.
 * Returns whether the key was one of them.
 */
const rowAction = (
  e: KeyboardEvent<HTMLDivElement>,
  item: LayerItem,
  rename: (key: string) => void
) => {
  const command = (e.metaKey || e.ctrlKey) && e.shiftKey && !item.page;
  const letter = e.key.toLowerCase();
  if (e.key === "Enter" || e.key === " ") {
    selectItem(item, e.shiftKey);
  } else if (e.key === "F2") {
    rename(item.key);
  } else if (command && letter === "h") {
    setHidden(!item.node?.hidden, at(item));
  } else if (command && letter === "l") {
    setLocked(!item.node?.locked, at(item));
  } else {
    return false;
  }
  return true;
};

/** The treeitem a key was pressed on, or the focus went to; null for a field or a button in it. */
const treeItemKey = (target: EventTarget) => {
  const element = target as HTMLElement;
  return element.getAttribute("role") === "treeitem"
    ? (element.dataset.key ?? null)
    : null;
};

/**
 * Opens the way down to the selection whenever it changes, and scrolls to it. It is adjusted
 * during render rather than in an effect, so the expanded tree paints in the same pass; `onReveal`
 * hears of the row, which takes the tree's focus.
 */
const useRevealSelection = ({
  collapsed,
  list,
  onReveal,
  rootOf,
  setCollapsed,
}: {
  collapsed: ReadonlySet<string>;
  list: RefObject<HTMLDivElement | null>;
  onReveal: (key: string) => void;
  rootOf: (frame: string) => DesignNode | null;
  setCollapsed: (next: ReadonlySet<string>) => void;
}) => {
  const selection = useEditor((s) => s.selection);
  const [revealed, setRevealed] = useState<Selection | null>(null);
  if (selection && selection !== revealed) {
    setRevealed(selection);
    onReveal(layerKey(selection.frame, selection.nodeId));
    const path = findPath(rootOf(selection.frame), selection.nodeId);
    if (path) {
      const next = new Set(collapsed);
      next.delete(pageKey(selection.frame));
      for (const n of path) {
        next.delete(layerKey(selection.frame, n.id));
      }
      if (next.size !== collapsed.size) {
        setCollapsed(next);
      }
    }
  }

  useEffect(() => {
    if (!revealed) {
      return;
    }
    const key = layerKey(revealed.frame, revealed.nodeId);
    requestAnimationFrame(() => {
      list.current
        ?.querySelector(`[data-row="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, [revealed, list]);
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

export const Layers = () => {
  const canvas = useEditor((s) => s.canvas);
  const allPages = useProject((s) => s.pages);
  const pages = allPages.filter((p) => p.canvas === canvas);
  const docs = useDocuments((s) => s.docs);
  const loaded = useDocuments((s) => s.loaded);
  const selection = useEditor((s) => s.selection);
  const selectedPage = useEditor((s) => s.selectedPage);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /** What is folded while a filter is typed: everything it finds starts out open. */
  const [foldedInFilter, setFoldedInFilter] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [query, setQuery] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Row | null>(null);
  const nodes = canvasNodes(docs, canvas);

  const filtering = query.trim() !== "";
  const folded = filtering ? foldedInFilter : collapsed;
  const setFolded = filtering ? setFoldedInFilter : setCollapsed;
  const items = [
    ...pages.map((page) => pageItem(page, docs[page.id]?.root ?? null)),
    ...nodes.map((node) => looseItem(nodeFrameOf(node.id), node)),
  ];
  const shown = filterLayers(items, query);
  const shownPages = shown.filter((item) => item.page);
  const shownLoose = shown.filter((item) => !item.page);
  const rows = visibleRows(shown, folded);
  const tabStop = tabStopOf(rows, [
    focusKey,
    selectedKeyOf(selection, selectedPage),
  ]);

  useRevealSelection({
    collapsed,
    list: listRef,
    onReveal: setFocusKey,
    rootOf: (frame) =>
      docs[frame]?.root ??
      nodes.find((n) => nodeFrameOf(n.id) === frame) ??
      null,
    setCollapsed,
  });

  // A row the filter hides is shown again to be renamed.
  useRenameRequests((target) => {
    const key = layerKey(target.frame, target.nodeId);
    if (findItem(shown, key) === null) {
      setQuery("");
    }
    setRenaming(key);
  });

  const toggle = (key: string) =>
    setFolded((prev) => withKey(prev, key, !prev.has(key)));

  const focusRow = (key: string) => {
    setFocusKey(key);
    rowElement(listRef.current, key)?.focus();
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
    if (!drag || canvas === null) {
      return;
    }
    const into = position === "inside" ? target.node : target.parent;
    const intoFrame = target.frame;
    const siblings = into ? childrenOf(into) : nodes;
    const source = docOfFrame(drag.frame, canvas);
    const destination = into
      ? docOfFrame(intoFrame, canvas)
      : canvasDocOf(canvas);
    const edits = layerMoveEdits({
      destination,
      index: dropIndex(siblings, drag.node.id, target.node.id, position),
      node: drag.node,
      parent: into?.id ?? null,
      source,
      target: target.node,
    });
    const result = await applyEdits(edits, "Move");
    if (result) {
      const { docs: after } = useDocuments.getState();
      const frame =
        destination === canvasDocOf(canvas)
          ? frameOfCanvasNode(after, canvas, drag.node.id)
          : intoFrame;
      if (frame) {
        useEditor.getState().select({ frame, nodeId: drag.node.id });
      }
    }
  };

  /** Walks the tree from a row: the focus moves, or a row opens or folds. */
  const walkFrom = (key: string, pressed: string) => {
    const move = treeMove(rows, key, pressed);
    if (move && "focus" in move) {
      focusRow(move.focus);
    } else if (move && "expand" in move) {
      setFolded((prev) => withKey(prev, move.expand, false));
    } else if (move) {
      setFolded((prev) => withKey(prev, move.collapse, true));
    }
    return true;
  };

  /**
   * The tree's keys, for whichever row has the focus. They are kept from the canvas, whose own
   * arrows walk the selection and whose Enter edits text.
   */
  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const key = treeItemKey(e.target);
    const item = key === null ? null : findItem(shown, key);
    if (!item) {
      return;
    }
    const plain = !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
    const handled =
      plain && TREE_KEYS.has(e.key)
        ? walkFrom(item.key, e.key)
        : rowAction(e, item, setRenaming);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

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

  if (canvas === null) {
    return <PanelEmpty>Open a canvas from the Pages panel</PanelEmpty>;
  }
  if (!loaded) {
    return <PanelEmpty>Reading the designs…</PanelEmpty>;
  }
  if (pages.length === 0 && nodes.length === 0) {
    return <PanelEmpty>Nothing on this canvas yet</PanelEmpty>;
  }

  const shared: Shared = {
    drag,
    endRename,
    folded,
    onDrop,
    renaming,
    setDrag,
    setRenaming,
    tabStop,
    toggle,
  };

  return (
    <div className="flex h-full flex-col">
      <LayerFilter onDown={onFilterDown} onQuery={onQuery} query={query} />
      <div
        aria-label="Layers"
        aria-multiselectable="true"
        className="min-h-0 flex-1 overflow-auto py-1"
        onFocus={onTreeFocus}
        onKeyDown={onTreeKeyDown}
        ref={listRef}
        role="tree"
      >
        {shownPages.map((item) => (
          <PageRow item={item} key={item.key} shared={shared} />
        ))}
        {shownLoose.length > 0 && (
          <div
            className="mt-2 px-3 pt-1 pb-0.5 font-heading-xsmall text-muted-foreground uppercase"
            role="presentation"
          >
            On the canvas
          </div>
        )}
        {shownLoose.map((item) => (
          <LayerRow
            ancestors={[]}
            item={item}
            key={item.key}
            level={1}
            shared={shared}
          />
        ))}
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
  folded: ReadonlySet<string>;
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
 * The element of a row that is its treeitem: what the keyboard focuses, and what holds the rows
 * under it in a group. What the row shows is its first child, so that the focus ring and the
 * selection colour are the row's alone.
 */
const TreeItem = ({
  children,
  expanded,
  item,
  label,
  level,
  onContextMenu,
  row,
  selected,
  shared,
}: {
  children: ReactNode;
  expanded: boolean | undefined;
  item: LayerItem;
  label: string;
  level: number;
  onContextMenu: (e: MouseEvent) => void;
  row: ReactNode;
  selected: boolean;
  shared: Shared;
}) => (
  <div
    aria-expanded={expanded}
    aria-label={label}
    aria-level={level}
    aria-selected={selected}
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
    {row}
    {expanded ? (
      // biome-ignore lint/a11y/useSemanticElements: a tree's rows are grouped by role; a fieldset is for a form.
      <div role="group">{children}</div>
    ) : null}
  </div>
);

/** The focus ring of a row, drawn when its treeitem has the keyboard's focus. */
const FOCUS_RING =
  "[:focus-visible>&]:outline-1 [:focus-visible>&]:outline-ring [:focus-visible>&]:-outline-offset-1";

/** A page's own row, and its tree under it. */
const PageRow = ({ item, shared }: { item: LayerItem; shared: Shared }) => {
  const page = item.page as Page;
  const problem = useDocuments((s) => s.docs[page.id]?.problem);
  const root = item.node;
  const { key } = item;
  const expanded = isExpanded(item, shared.folded);
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
      expanded={item.children.length > 0 ? expanded : undefined}
      item={item}
      label={page.name}
      level={1}
      onContextMenu={onContextMenu}
      row={
        <>
          {row}
          {problem ? (
            <div
              className="truncate px-8 py-0.5 font-body text-destructive"
              title={problem}
            >
              Not a valid page: {problem}
            </div>
          ) : null}
        </>
      }
      selected={selected}
      shared={shared}
    >
      {item.children.map((child) => (
        <LayerRow
          ancestors={[page.id]}
          item={child}
          key={child.key}
          level={2}
          shared={shared}
        />
      ))}
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
  const { frame, node } = row;
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
  item,
  ancestors,
  hiddenAbove = false,
  level,
  shared,
}: {
  item: LayerItem;
  /** The rows this one is written inside, outermost first: one guide line each. */
  ancestors: readonly string[];
  /** A row it is written under is hidden, and this one with it. */
  hiddenAbove?: boolean;
  level: number;
  shared: Shared;
}) => {
  const { frame, key } = item;
  const node = item.node as DesignNode;
  const row: Row = { frame, node, parent: item.parent };
  const expanded = isExpanded(item, shared.folded);
  const hasChildren = item.children.length > 0;
  const selected = useEditor(
    (s) =>
      (s.selection?.frame === frame && s.selection.nodeId === node.id) ||
      s.also.some((a) => a.frame === frame && a.nodeId === node.id)
  );
  const hovered = useEditor(
    (s) => s.hover?.frame === frame && s.hover.nodeId === node.id
  );
  const dropHere = useDropHere(key);
  const dragHandlers = rowDrag(row, key, shared);
  const renaming = shared.renaming === key;
  const label = nodeLabel(node);
  const target = { frame, nodeId: node.id };

  /** Shift-click adds the row to the selection, or takes it out. */
  const onClick = (e: MouseEvent) => selectItem(item, e.shiftKey);
  const onMouseEnter = () => useEditor.getState().setHover(target);
  const onContextMenu = (e: MouseEvent) => {
    selectForMenu(target);
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
      style={{ paddingLeft: ROW_PAD + ancestors.length * INDENT }}
      title={nodeKind(node)}
    >
      <DepthGuides ancestors={ancestors} />
      <Chevron
        collapsed={!expanded}
        hidden={!hasChildren}
        onToggle={() => shared.toggle(key)}
      />
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1",
          (node.hidden || hiddenAbove) && "opacity-50"
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
      expanded={hasChildren ? expanded : undefined}
      item={item}
      label={label}
      level={level}
      onContextMenu={onContextMenu}
      row={line}
      selected={selected}
      shared={shared}
    >
      {item.children.map((child) => (
        <LayerRow
          ancestors={[...ancestors, node.id]}
          hiddenAbove={hiddenAbove || node.hidden === true}
          item={child}
          key={child.key}
          level={level + 1}
          shared={shared}
        />
      ))}
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
