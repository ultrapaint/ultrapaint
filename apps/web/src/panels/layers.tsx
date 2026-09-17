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
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { bridgeFor } from "../canvas/bridge.ts";
import { PanelEmpty } from "../components/panel.tsx";
import { runEdit } from "../lib/shortcuts.ts";
import { findPath, useEditor } from "../state/editor.ts";

const keyOf = (n: TreeNode) =>
  n.source ? `${sourceKey(n.source)}:${n.kind}` : n.id;

type DropPosition = "before" | "inside" | "after";

interface DropTarget {
  id: string;
  position: DropPosition;
}

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

  // Auto-expand the path to the selection.
  useEffect(() => {
    if (!(selection && tree) || selection.screenId !== activeScreen) {
      return;
    }
    const path = findPath(tree, selection.nodeId);
    if (!path) {
      return;
    }
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const n of path) {
        next.delete(keyOf(n));
      }
      return next;
    });
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-node="${selection.nodeId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, [selection, tree, activeScreen]);

  const toggle = useCallback(
    (n: TreeNode) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        const k = keyOf(n);
        if (next.has(k)) {
          next.delete(k);
        } else {
          next.add(k);
        }
        return next;
      }),
    []
  );

  const onDrop = useCallback(
    async (
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
    },
    [drag]
  );

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
  const selected = shared.selectedId === node.id;
  const hovered = shared.hoveredId === node.id;
  const hasChildren = node.children.length > 0;
  const dropHere = dropTarget?.id === node.id ? dropTarget.position : null;

  const select = useCallback(() => {
    useEditor.getState().select({
      nodeId: node.id,
      screenId: activeScreen,
      source: node.source,
    });
  }, [activeScreen, node.id, node.source]);
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) {
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        if (e.key === " ") {
          e.preventDefault();
        }
        select();
      }
    },
    [select]
  );
  const editText = useCallback(
    () => bridgeFor(activeScreen).editText(node.id),
    [activeScreen, node.id]
  );
  const onDragLeave = useCallback(
    () => setDropTarget((d) => (d?.id === node.id ? null : d)),
    [node.id, setDropTarget]
  );
  const onDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!drag || drag.node.id === node.id || !node.editable) {
        return;
      }
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      setDropTarget({ id: node.id, position: dropPositionAt(node, y) });
    },
    [drag, node, setDropTarget]
  );
  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      setDrag({ node });
      e.dataTransfer.effectAllowed = "move";
    },
    [node, setDrag]
  );
  const onDropHere = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const t = dropTarget;
      setDropTarget(null);
      setDrag(null);
      if (t) {
        onDrop(node, t.position, parent);
      }
    },
    [dropTarget, node, onDrop, parent, setDrag, setDropTarget]
  );
  const onMouseEnter = useCallback(
    () =>
      useEditor
        .getState()
        .setHover({ nodeId: node.id, screenId: activeScreen }),
    [activeScreen, node.id]
  );
  const onToggle = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      toggle(node);
    },
    [node, toggle]
  );

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
            node.kind === "component" && "font-medium text-brand",
            selected && node.kind === "component" && "text-foreground"
          )}
        >
          {node.summary}
        </span>
      </div>
      {!isCollapsed && hasChildren
        ? node.children.map((c) => (
            <LayerNode
              depth={depth + 1}
              key={c.id}
              node={c}
              parent={node}
              shared={shared}
            />
          ))
        : null}
    </div>
  );
};
