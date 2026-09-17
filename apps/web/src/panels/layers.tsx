import { sourceKey } from "@ultrapaint/contracts/base";
import type { TreeNode } from "@ultrapaint/contracts/preview";
import { cn } from "cn";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  type Dispatch,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { bridgeFor } from "../canvas/bridge.ts";
import { PanelEmpty } from "../components/panel.tsx";
import { runEdit } from "../lib/shortcuts.ts";
import { useEditor } from "../state/editor.ts";
import { findPath, hostOf } from "../state/tree.ts";

const keyOf = (n: TreeNode) =>
  n.source ? `${sourceKey(n.source)}:${n.kind}` : n.id;

type DropPosition = "before" | "inside" | "after";

interface DropTarget {
  id: string;
  position: DropPosition;
}

const QUOTED_TEXT_RE = / ".*"$/;

/** The host element's summary, without the text the component's summary already quotes. */
const hostLabel = (component: TreeNode, host: TreeNode) =>
  QUOTED_TEXT_RE.test(component.summary)
    ? host.summary.replace(QUOTED_TEXT_RE, "")
    : host.summary;

const dropPositionAt = (node: TreeNode, y: number): DropPosition => {
  if (node.kind !== "text" && y > 0.3 && y < 0.7) {
    return "inside";
  }
  return y <= 0.5 ? "before" : "after";
};

const clearHover = () => useEditor.getState().setHover(null);

export const Layers = () => {
  const activeScreen = useEditor((s) => s.activeScreen);
  const tree = useEditor((s) =>
    activeScreen ? s.trees[activeScreen] : undefined
  );
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ node: TreeNode } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // Auto-expand the path to the selection whenever the selection or tree changes (adjusted during
  // render rather than in an effect, so the expanded tree paints in the same pass).
  const [revealed, setRevealed] = useState<{
    selection: typeof selection;
    tree: typeof tree;
  } | null>(null);
  const selectedHere =
    selection && tree && selection.screenId === activeScreen ? selection : null;
  if (
    selectedHere &&
    tree &&
    (revealed?.selection !== selectedHere || revealed.tree !== tree)
  ) {
    setRevealed({ selection: selectedHere, tree });
    const path = findPath(tree, selectedHere.nodeId);
    if (path) {
      const next = new Set(collapsed);
      for (const n of path) {
        next.delete(keyOf(n));
      }
      setCollapsed(next);
    }
  }

  useEffect(() => {
    if (!revealed?.selection) {
      return;
    }
    const { nodeId } = revealed.selection;
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-node="${nodeId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, [revealed]);

  const toggle = (n: TreeNode) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const k = keyOf(n);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });

  const onDrop = async (
    target: TreeNode,
    position: DropPosition,
    parent: TreeNode | undefined
  ) => {
    if (!drag?.node.source) {
      return;
    }
    if (position === "inside") {
      if (!target.source) {
        return;
      }
      await runEdit({
        index: 0,
        into: target.source,
        kind: "move",
        target: drag.node.source,
      });
    } else {
      if (!parent?.source) {
        return;
      }
      const siblings = parent.children.filter((c) => c.id !== drag.node.id);
      const targetIdx = siblings.findIndex((c) => c.id === target.id);
      await runEdit({
        index: position === "before" ? targetIdx : targetIdx + 1,
        into: parent.source,
        kind: "move",
        target: drag.node.source,
      });
    }
  };

  if (!(activeScreen && tree)) {
    return <PanelEmpty>Select a screen to see its layers</PanelEmpty>;
  }

  const shared: LayerShared = {
    activeScreen,
    collapsed,
    drag,
    dropTarget,
    hoveredId: hover?.screenId === activeScreen ? hover.nodeId : null,
    onDrop,
    selectedId: selection?.screenId === activeScreen ? selection.nodeId : null,
    setDrag,
    setDropTarget,
    toggle,
  };

  return (
    <div className="py-1" ref={listRef} role="tree">
      {tree.children.map((c) => (
        <LayerNode
          depth={0}
          key={c.id}
          node={c}
          parent={tree}
          shared={shared}
        />
      ))}
    </div>
  );
};

/** Panel state every row of the tree reads, passed down unchanged. */
interface LayerShared {
  activeScreen: string;
  collapsed: Set<string>;
  drag: { node: TreeNode } | null;
  dropTarget: DropTarget | null;
  hoveredId: string | null;
  onDrop: (
    target: TreeNode,
    position: DropPosition,
    parent: TreeNode | undefined
  ) => Promise<void>;
  selectedId: string | null;
  setDrag: Dispatch<SetStateAction<{ node: TreeNode } | null>>;
  setDropTarget: Dispatch<SetStateAction<DropTarget | null>>;
  toggle: (n: TreeNode) => void;
}

const rowTone = (selected: boolean, hovered: boolean) => {
  if (selected) {
    return "bg-brand/25 text-foreground";
  }
  return hovered
    ? "bg-muted text-foreground"
    : "text-muted-foreground hover:bg-muted/50";
};

const LayerNode = ({
  node,
  depth,
  parent,
  shared,
}: {
  node: TreeNode;
  depth: number;
  parent?: TreeNode;
  shared: LayerShared;
}) => {
  const {
    activeScreen,
    collapsed,
    drag,
    dropTarget,
    onDrop,
    setDrag,
    setDropTarget,
    toggle,
  } = shared;
  const isCollapsed = collapsed.has(keyOf(node));
  const host = hostOf(node);
  const children = host ? host.children : node.children;
  const isRow = (id: string | null) =>
    id !== null && (id === node.id || id === host?.id);
  const selected = isRow(shared.selectedId);
  const hovered = isRow(shared.hoveredId);
  const hasChildren = children.length > 0;
  // In source the children are written inside the component's JSX, not its host element.
  const rowParent = host ? { ...node, children } : node;
  const dropHere = dropTarget?.id === node.id ? dropTarget.position : null;

  const select = () => {
    useEditor.getState().select({
      nodeId: node.id,
      screenId: activeScreen,
      source: node.source,
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) {
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (e.key === " ") {
        e.preventDefault();
      }
      select();
    }
  };
  const editText = () => bridgeFor(activeScreen).editText(node.id);
  const onDragLeave = () =>
    setDropTarget((d) => (d?.id === node.id ? null : d));
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!drag || drag.node.id === node.id || !node.editable) {
      return;
    }
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    setDropTarget({ id: node.id, position: dropPositionAt(node, y) });
  };
  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    setDrag({ node });
    e.dataTransfer.effectAllowed = "move";
  };
  const onDropHere = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = dropTarget;
    setDropTarget(null);
    setDrag(null);
    if (t) {
      onDrop(node, t.position, parent);
    }
  };
  const onMouseEnter = () =>
    useEditor.getState().setHover({ nodeId: node.id, screenId: activeScreen });
  const onToggle = (e: MouseEvent) => {
    e.stopPropagation();
    toggle(node);
  };

  return (
    <div>
      <div
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        aria-selected={selected}
        className={cn(
          "group flex h-6 cursor-default items-center gap-1 pr-2 text-[11px]",
          rowTone(selected, hovered),
          !node.editable && node.id !== "root" && "text-muted-foreground/60",
          dropHere === "inside" && "ring-1 ring-brand ring-inset",
          dropHere === "before" &&
            "shadow-[inset_0_2px_0_0_var(--color-brand)]",
          dropHere === "after" && "shadow-[inset_0_-2px_0_0_var(--color-brand)]"
        )}
        data-node={node.id}
        draggable={node.editable && node.id !== "root"}
        onClick={select}
        onDoubleClick={editText}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDragStart={onDragStart}
        onDrop={onDropHere}
        onKeyDown={onKeyDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={clearHover}
        role="treeitem"
        style={{ paddingLeft: 8 + depth * 12 }}
        tabIndex={0}
      >
        <Button
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          className={cn(
            "size-4 text-muted-foreground",
            !hasChildren && "invisible"
          )}
          onClick={onToggle}
          size="icon-xs"
          variant="ghost"
        >
          {isCollapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </Button>
        <span
          className={cn(
            "truncate",
            host && "max-w-[70%] shrink-0",
            node.kind === "component" && "font-medium text-brand",
            selected && node.kind === "component" && "text-foreground"
          )}
        >
          {node.summary}
        </span>
        {host ? (
          <span className="min-w-0 truncate text-muted-foreground/70">
            {hostLabel(node, host)}
          </span>
        ) : null}
      </div>
      {!isCollapsed && hasChildren
        ? children.map((c) => (
            <LayerNode
              depth={depth + 1}
              key={c.id}
              node={c}
              parent={rowParent}
              shared={shared}
            />
          ))
        : null}
    </div>
  );
};
