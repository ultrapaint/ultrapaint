import type { TreeNode } from "@ultrapaint/contracts";
import { sourceKey } from "@ultrapaint/contracts";
import { ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";
import { bridgeFor } from "../canvas/bridge.ts";
import { Empty } from "../components/ui.tsx";
import { cn } from "../lib/cn.ts";
import { runEdit } from "../lib/shortcuts.ts";
import { findPath, useEditor } from "../state/editor.ts";

const keyOf = (n: TreeNode) => (n.source ? `${sourceKey(n.source)}:${n.kind}` : n.id);

export const Layers = () => {
  const activeScreen = useEditor((s) => s.activeScreen);
  const tree = useEditor((s) => (activeScreen ? s.trees[activeScreen] : undefined));
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const listRef = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<{ node: TreeNode } | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{
    id: string;
    position: "before" | "inside" | "after";
  } | null>(null);

  // Auto-expand the path to the selection.
  React.useEffect(() => {
    if (!selection || !tree || selection.screenId !== activeScreen) return;
    const path = findPath(tree, selection.nodeId);
    if (!path) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const n of path) next.delete(keyOf(n));
      return next;
    });
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-node="${selection.nodeId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, [selection, tree, activeScreen]);

  if (!activeScreen || !tree) {
    return <Empty>Select a screen to see its layers</Empty>;
  }

  const toggle = (n: TreeNode) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const k = keyOf(n);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const onDrop = async (
    target: TreeNode,
    position: "before" | "inside" | "after",
    parent: TreeNode | undefined,
    index: number,
  ) => {
    if (!drag?.node.source) return;
    if (position === "inside") {
      if (!target.source) return;
      await runEdit({ kind: "move", target: drag.node.source, into: target.source, index: 0 });
    } else {
      if (!parent?.source) return;
      const siblings = parent.children.filter((c) => c.id !== drag.node.id);
      const targetIdx = siblings.findIndex((c) => c.id === target.id);
      await runEdit({
        kind: "move",
        target: drag.node.source,
        into: parent.source,
        index: position === "before" ? targetIdx : targetIdx + 1,
      });
    }
    void index;
  };

  const renderNode = (
    node: TreeNode,
    depth: number,
    parent?: TreeNode,
    index = 0,
  ): React.ReactNode => {
    const isCollapsed = collapsed.has(keyOf(node));
    const selected = selection?.screenId === activeScreen && selection.nodeId === node.id;
    const hovered = hover?.screenId === activeScreen && hover.nodeId === node.id;
    const hasChildren = node.children.length > 0;
    const dropHere = dropTarget?.id === node.id ? dropTarget.position : null;
    return (
      <div key={node.id}>
        <div
          data-node={node.id}
          draggable={node.editable && node.id !== "root"}
          onDragStart={(e) => {
            setDrag({ node });
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (!drag || drag.node.id === node.id || !node.editable) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            const position =
              node.kind !== "text" && y > 0.3 && y < 0.7 ? "inside" : y <= 0.5 ? "before" : "after";
            setDropTarget({ id: node.id, position });
          }}
          onDragLeave={() => setDropTarget((d) => (d?.id === node.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            const t = dropTarget;
            setDropTarget(null);
            setDrag(null);
            if (t) void onDrop(node, t.position, parent, index);
          }}
          className={cn(
            "group flex h-6 cursor-default items-center gap-1 pr-2 text-[11px]",
            selected
              ? "bg-accent/25 text-ink"
              : hovered
                ? "bg-panel-3 text-ink"
                : "text-ink-2 hover:bg-panel-2",
            !node.editable && node.id !== "root" && "text-ink-3",
            dropHere === "inside" && "ring-1 ring-accent ring-inset",
            dropHere === "before" && "shadow-[inset_0_2px_0_0_var(--color-accent)]",
            dropHere === "after" && "shadow-[inset_0_-2px_0_0_var(--color-accent)]",
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => {
            useEditor
              .getState()
              .select({ screenId: activeScreen, nodeId: node.id, source: node.source });
          }}
          onDoubleClick={() => bridgeFor(activeScreen).editText(node.id)}
          onMouseEnter={() =>
            useEditor.getState().setHover({ screenId: activeScreen, nodeId: node.id })
          }
          onMouseLeave={() => useEditor.getState().setHover(null)}
        >
          <button
            type="button"
            className={cn(
              "flex size-4 shrink-0 items-center justify-center text-ink-3",
              !hasChildren && "invisible",
            )}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node);
            }}
          >
            {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
          <span
            className={cn(
              "truncate",
              node.kind === "component" && "font-medium text-accent",
              selected && node.kind === "component" && "text-ink",
            )}
          >
            {node.summary}
          </span>
        </div>
        {!isCollapsed &&
          hasChildren &&
          node.children.map((c, i) => renderNode(c, depth + 1, node, i))}
      </div>
    );
  };

  return (
    <div ref={listRef} className="py-1">
      {tree.children.map((c, i) => renderNode(c, 0, tree, i))}
    </div>
  );
};
