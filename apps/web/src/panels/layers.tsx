/**
 * The layers of the whole space, read off its documents: every page with its tree, then the
 * nodes placed on the canvas beside the pages, the way Figma lists the frames of a page. A row
 * selects what it names on the canvas, and rows are dragged to move nodes — inside a page,
 * between pages, onto the canvas and back.
 */
import type { DesignNode, DocumentEdit } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import {
  canvasDocOf,
  childrenOf,
  findPath,
  nodeKind,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import { ChevronDown, ChevronRight, File, MoreVertical } from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { bridgeFor } from "../canvas/bridge.ts";
import { NodeIcon } from "../components/node-icon.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { holdsChildren } from "../state/catalogue.ts";
import { openMenuAt, showMenu, useContextMenu } from "../state/context-menu.ts";
import {
  applyEdits,
  canvasNodes,
  docOfFrame,
  frameOfCanvasNode,
  nodeFrameOf,
  useDocuments,
} from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

/** A row's own indent, and where its chevron sits inside it. */
const ROW_PAD = 8;
const INDENT = 12;
const CHEVRON_CENTER = 8;

const LAYERS_MIME = "application/ultrapaint-layer";

type DropPosition = "before" | "inside" | "after";

interface DropTarget {
  key: string;
  position: DropPosition;
}

/** A row of the panel: a node of a frame, where it sits, and what may be done with it. */
/** Where among its siblings a dropped layer goes, the dragged one left out. */
const dropIndex = (
  siblings: readonly DesignNode[],
  dragged: string,
  target: string,
  position: DropPosition
) => {
  if (position === "inside") {
    return 0;
  }
  const at = siblings
    .filter((c) => c.id !== dragged)
    .findIndex((c) => c.id === target);
  return position === "before" ? at : at + 1;
};

/** A move within one document, or out of one into another. */
const layerMoveEdits = (move: {
  destination: string;
  index: number;
  node: DesignNode;
  /** The container it goes into; null for the top of the canvas. */
  parent: string | null;
  source: string;
  /** The layer it was dropped at. */
  target: DesignNode;
}): DocumentEdit[] => {
  const { destination, index, node, parent, source, target } = move;
  if (source === destination) {
    return [{ doc: source, ops: [{ id: node.id, index, op: "move", parent }] }];
  }
  // Onto the canvas beside another node on it: just below that one.
  const placed =
    parent === null
      ? { ...node, x: target.x ?? 0, y: (target.y ?? 0) + 40 }
      : node;
  return [
    { doc: source, ops: [{ id: node.id, op: "remove" }] },
    { doc: destination, ops: [{ index, node: placed, op: "insert", parent }] },
  ];
};

interface Row {
  /** The frame the node is shown in. */
  frame: string;
  node: DesignNode;
  /** The node it is inside, or null for the top of a page or of the canvas. */
  parent: DesignNode | null;
}

const keyOf = (frame: string, nodeId: string) => `${frame}#${nodeId}`;

const dropPositionAt = (node: DesignNode, y: number): DropPosition => {
  if (holdsChildren(node) && y > 0.3 && y < 0.7) {
    return "inside";
  }
  return y <= 0.5 ? "before" : "after";
};

const clearHover = () => useEditor.getState().setHover(null);

export const Layers = () => {
  const space = useEditor((s) => s.space);
  const allPages = useProject((s) => s.pages);
  const pages = allPages.filter((p) => p.space === space);
  const docs = useDocuments((s) => s.docs);
  const loaded = useDocuments((s) => s.loaded);
  const selection = useEditor((s) => s.selection);
  const selectedPage = useEditor((s) => s.selectedPage);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Row | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const nodes = canvasNodes(docs, space);

  // Opens the way down to the selection whenever it changes (adjusted during render rather than
  // in an effect, so the expanded tree paints in the same pass).
  const [revealed, setRevealed] = useState<Selection | null>(null);
  if (selection && selection !== revealed) {
    setRevealed(selection);
    const root =
      docs[selection.frame]?.root ??
      nodes.find((n) => nodeFrameOf(n.id) === selection.frame) ??
      null;
    const path = findPath(root, selection.nodeId);
    if (path) {
      const next = new Set(collapsed);
      for (const n of path) {
        next.delete(keyOf(selection.frame, n.id));
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
    const key = keyOf(revealed.frame, revealed.nodeId);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-row="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, [revealed]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  /** Moves the dragged row next to, or into, the target row: across documents too. */
  const onDrop = async (target: Row, position: DropPosition) => {
    if (!drag || space === null) {
      return;
    }
    const into = position === "inside" ? target.node : target.parent;
    const intoFrame = target.frame;
    const siblings = into ? childrenOf(into) : nodes;
    const source = docOfFrame(drag.frame, space);
    const destination = into
      ? docOfFrame(intoFrame, space)
      : canvasDocOf(space);
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
        destination === canvasDocOf(space)
          ? frameOfCanvasNode(after, space, drag.node.id)
          : intoFrame;
      if (frame) {
        useEditor.getState().select({ frame, nodeId: drag.node.id });
      }
    }
  };

  if (space === null) {
    return <PanelEmpty>Open a space from the Pages panel</PanelEmpty>;
  }
  if (!loaded) {
    return <PanelEmpty>Reading the designs…</PanelEmpty>;
  }
  if (pages.length === 0 && nodes.length === 0) {
    return <PanelEmpty>This space has no pages yet</PanelEmpty>;
  }

  const shared: Shared = {
    collapsed,
    drag,
    dropTarget,
    onDrop,
    selectedPage,
    selection,
    setDrag,
    setDropTarget,
    toggle,
  };

  return (
    <div className="py-1" ref={listRef} role="tree">
      {pages.map((page) => (
        <PageRows key={page.id} page={page} shared={shared} />
      ))}
      {nodes.length > 0 && (
        <div className="mt-2 px-3 pt-1 pb-0.5 font-medium text-[10px] text-muted-foreground uppercase">
          On the canvas
        </div>
      )}
      {nodes.map((node) => (
        <LayerRow
          ancestors={[]}
          key={node.id}
          row={{ frame: nodeFrameOf(node.id), node, parent: null }}
          shared={shared}
        />
      ))}
    </div>
  );
};

interface Shared {
  collapsed: Set<string>;
  drag: Row | null;
  dropTarget: DropTarget | null;
  onDrop: (target: Row, position: DropPosition) => Promise<void>;
  selectedPage: string | null;
  selection: Selection | null;
  setDrag: (row: Row | null) => void;
  setDropTarget: (
    target: DropTarget | null | ((d: DropTarget | null) => DropTarget | null)
  ) => void;
  toggle: (key: string) => void;
}

/** A page's own row, and its tree under it. */
const PageRows = ({ page, shared }: { page: Page; shared: Shared }) => {
  const state = useDocuments((s) => s.docs[page.id]);
  const root = state?.root ?? null;
  const key = keyOf(page.id, "page");
  const isCollapsed = shared.collapsed.has(key);
  const selected = shared.selectedPage === page.id;
  const select = () => {
    useEditor.getState().selectPage(page.id);
  };
  const onContextMenu = (e: MouseEvent) => {
    select();
    openMenuAt(e, { kind: "page", pageId: page.id });
  };
  const children = root ? childrenOf(root) : [];
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!(shared.drag && root)) {
      return;
    }
    e.preventDefault();
    shared.setDropTarget({ key, position: "inside" });
  };
  const onDropHere = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    shared.setDropTarget(null);
    if (root) {
      shared.onDrop({ frame: page.id, node: root, parent: null }, "inside");
    }
    shared.setDrag(null);
  };
  return (
    <div>
      <div
        aria-expanded={!isCollapsed}
        aria-selected={selected}
        className={cn(
          "group relative flex h-7 cursor-default items-center gap-1 pr-1 font-medium text-[11px]",
          selected
            ? "bg-selection/25 text-foreground"
            : "text-foreground hover:bg-muted/50",
          shared.dropTarget?.key === key && "ring-1 ring-brand ring-inset"
        )}
        data-row={keyOf(page.id, root?.id ?? "page")}
        onClick={select}
        onContextMenu={onContextMenu}
        onDragLeave={() => shared.setDropTarget(null)}
        onDragOver={onDragOver}
        onDrop={onDropHere}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select();
          }
        }}
        role="treeitem"
        style={{ paddingLeft: ROW_PAD }}
        tabIndex={0}
      >
        <Chevron
          collapsed={isCollapsed}
          hidden={children.length === 0}
          onToggle={() => shared.toggle(key)}
        />
        <File className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{page.name}</span>
        <span className="ml-auto truncate pr-1 font-mono font-normal text-[10px] text-muted-foreground">
          {page.route}
        </span>
      </div>
      {state?.problem ? (
        <div
          className="truncate px-8 py-0.5 text-[10px] text-destructive"
          title={state.problem}
        >
          Not a valid page: {state.problem}
        </div>
      ) : null}
      {!isCollapsed &&
        children.map((child) => (
          <LayerRow
            ancestors={[page.id]}
            key={child.id}
            row={{ frame: page.id, node: child, parent: root }}
            shared={shared}
          />
        ))}
    </div>
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
      className="invisible ml-auto size-5 shrink-0 text-muted-foreground group-focus-within:visible group-hover:visible aria-expanded:visible"
      onClick={onClick}
      size="icon-xs"
      variant="ghost"
    >
      <MoreVertical className="size-3" />
    </Button>
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
  row,
  ancestors,
  shared,
}: {
  row: Row;
  /** The rows this one is written inside, outermost first: one guide line each. */
  ancestors: readonly string[];
  shared: Shared;
}) => {
  const { frame, node } = row;
  const hover = useEditor((s) => s.hover);
  const key = keyOf(frame, node.id);
  const isCollapsed = shared.collapsed.has(key);
  const children = childrenOf(node);
  const hasChildren = children.length > 0;
  const alsoSelected = useEditor((s) =>
    s.also.some((a) => a.frame === frame && a.nodeId === node.id)
  );
  const selected =
    (shared.selection?.frame === frame &&
      shared.selection.nodeId === node.id) ||
    alsoSelected;
  const hovered = hover?.frame === frame && hover.nodeId === node.id;
  const dropHere =
    shared.dropTarget?.key === key ? shared.dropTarget.position : null;

  const select = () => useEditor.getState().select({ frame, nodeId: node.id });
  /** Shift-click adds the row to the selection, or takes it out. */
  const onClick = (e: MouseEvent) =>
    e.shiftKey
      ? useEditor.getState().toggleSelected({ frame, nodeId: node.id })
      : select();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) {
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select();
    }
  };
  const editText = () => {
    if (node.type === "text") {
      select();
      bridgeFor(frame).editText(node.id);
    }
  };
  const onDragLeave = () =>
    shared.setDropTarget((d) => (d?.key === key ? null : d));
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    const dragged = shared.drag;
    if (!dragged || dragged.node.id === node.id) {
      return;
    }
    // Not into itself or anything inside it.
    if (dragged.frame === frame && findPath(dragged.node, node.id) !== null) {
      return;
    }
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    shared.setDropTarget({ key, position: dropPositionAt(node, y) });
  };
  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    shared.setDrag(row);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(LAYERS_MIME, node.id);
  };
  const onDropHere = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = shared.dropTarget;
    shared.setDropTarget(null);
    if (t?.key === key) {
      shared.onDrop(row, t.position);
    }
    shared.setDrag(null);
  };
  const onMouseEnter = () =>
    useEditor.getState().setHover({ frame, nodeId: node.id });
  const onContextMenu = (e: MouseEvent) => {
    select();
    openMenuAt(e, { frame, kind: "node", nodeId: node.id });
  };

  return (
    <div>
      <div
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        aria-selected={selected}
        className={cn(
          "group relative flex h-6 cursor-default items-center gap-1 pr-1 text-[11px]",
          rowTone(selected, hovered, node.type === "instance"),
          node.hidden && "opacity-50",
          dropHere === "inside" && "ring-1 ring-brand ring-inset",
          dropHere === "before" &&
            "shadow-[inset_0_2px_0_0_var(--color-brand)]",
          dropHere === "after" && "shadow-[inset_0_-2px_0_0_var(--color-brand)]"
        )}
        data-row={key}
        draggable
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDoubleClick={editText}
        onDragEnd={() => shared.setDrag(null)}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
        onDrop={onDropHere}
        onKeyDown={onKeyDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={clearHover}
        role="treeitem"
        style={{ paddingLeft: ROW_PAD + ancestors.length * INDENT }}
        tabIndex={0}
        title={nodeKind(node)}
      >
        <DepthGuides ancestors={ancestors} />
        <Chevron
          collapsed={isCollapsed}
          hidden={!hasChildren}
          onToggle={() => shared.toggle(key)}
        />
        <span
          className={cn(
            "shrink-0 text-muted-foreground",
            node.type === "instance" && "text-component",
            selected && "text-foreground"
          )}
        >
          <NodeIcon node={node} />
        </span>
        <span
          className={cn(
            "truncate",
            node.type === "instance" && "font-medium text-component",
            selected && node.type === "instance" && "text-foreground"
          )}
        >
          {nodeLabel(node)}
        </span>
        {node.link ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
            → {node.link}
          </span>
        ) : null}
        <RowMenu row={row} />
      </div>
      {!isCollapsed && hasChildren
        ? children.map((child) => (
            <LayerRow
              ancestors={[...ancestors, node.id]}
              key={child.id}
              row={{ frame, node: child, parent: node }}
              shared={shared}
            />
          ))
        : null}
    </div>
  );
};
