/**
 * What a frame draws over its preview: the outlines of the hovered and the selected nodes, the box
 * around several selected, and an error the preview reported.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import { findNode } from "@ultrapaint/design-document/tree";
import { AlertTriangle } from "lucide-react";
import {
  kindColor,
  kindHoverColor,
  selectionKindOf,
} from "../lib/selection-kind.ts";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor, useInv } from "../state/editor.ts";
import { ElementToolbar, GroupToolbar } from "./element-toolbar.tsx";
import { TAG_HEIGHT } from "./element-toolbar-placement.ts";
import { SelectionTag } from "./selection-tag.tsx";

/** The node selected in this frame, if the selection is here. */
export const useSelectedIn = (frameId: string) =>
  useEditor((s) =>
    s.selection?.frame === frameId ? s.selection.nodeId : null
  );

/**
 * The others selected with it in this frame, as their ids joined by spaces: a string, so the
 * frames the selection is not in see nothing change.
 */
export const useAlsoIn = (frameId: string) =>
  useEditor((s) =>
    s.selection?.frame === frameId ? s.also.map((a) => a.nodeId).join(" ") : ""
  );

/** The node hovered in this frame, if the pointer is over one here. */
export const useHoverIn = (frameId: string) =>
  useEditor((s) => (s.hover?.frame === frameId ? s.hover.nodeId : null));

export const idsOf = (joined: string): string[] =>
  joined === "" ? [] : joined.split(" ");

/** The box around several rects. */
const unionOf = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) {
    return null;
  }
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { height: bottom - top, width: right - left, x: left, y: top };
};

/** The outlines of the hovered and the selected nodes, and an error the preview reported. */
export const Highlights = ({ frameId }: { frameId: string }) => {
  const inv = useInv();
  const selectedId = useSelectedIn(frameId);
  const alsoIds = useAlsoIn(frameId);
  const hoverId = useHoverIn(frameId);
  const rects = useEditor((s) => s.rects[frameId]);
  const hostError = useEditor((s) => s.hostErrors[frameId]);
  const canvas = useEditor((s) => s.canvas);
  const frameWidth = useEditor(
    (s) =>
      s.frames[frameId]?.width ??
      s.sizes[frameId]?.width ??
      Number.POSITIVE_INFINITY
  );
  const frameHeight = useEditor(
    (s) =>
      s.frames[frameId]?.height ??
      s.sizes[frameId]?.height ??
      Number.POSITIVE_INFINITY
  );
  const frame = { height: frameHeight, width: frameWidth };
  // This frame's document only: an edit elsewhere has nothing to outline here.
  const root = useDocuments((s) => rootOfFrame(s.docs, canvas, frameId));
  const selectedNode = selectedId === null ? null : findNode(root, selectedId);
  const hoverNode = hoverId === null ? null : findNode(root, hoverId);
  const selectedRect = selectedId === null ? undefined : rects?.[selectedId];
  const hoverRect =
    hoverId !== null && hoverId !== selectedId ? rects?.[hoverId] : undefined;
  // Several selected: each is outlined, and what they share hangs over the box around them.
  const others = idsOf(alsoIds).flatMap((nodeId) => {
    const node = findNode(root, nodeId);
    const rect = rects?.[nodeId];
    return node && rect
      ? [{ node, rect, target: { frame: frameId, nodeId } }]
      : [];
  });
  const many = others.length > 0;
  const group =
    many && selectedRect && selectedNode && selectedId !== null
      ? {
          nodes: [selectedNode, ...others.map((o) => o.node)],
          rect: unionOf([selectedRect, ...others.map((o) => o.rect)]),
          targets: [
            { frame: frameId, nodeId: selectedId },
            ...others.map((o) => o.target),
          ],
        }
      : null;
  return (
    <>
      {hoverRect ? (
        <Outline inv={inv} kind="hover" node={hoverNode} rect={hoverRect} />
      ) : null}
      {selectedRect ? (
        <Outline
          bare={many}
          frame={frame}
          inv={inv}
          kind="selection"
          node={selectedNode}
          rect={selectedRect}
        />
      ) : null}
      {others.map((o) => (
        <Outline
          bare
          inv={inv}
          key={o.target.nodeId}
          kind="selection"
          node={o.node}
          rect={o.rect}
        />
      ))}
      {group?.rect ? (
        <GroupOutline
          frame={frame}
          inv={inv}
          nodes={group.nodes}
          rect={group.rect}
          targets={group.targets}
        />
      ) : null}
      {hostError ? (
        <div
          className="absolute inset-x-0 bottom-0 flex items-start gap-2 bg-destructive/90 p-3 font-code text-white"
          style={{ fontSize: 14 * inv, padding: 12 * inv }}
        >
          <AlertTriangle className="size-4 shrink-0" />
          <pre className="whitespace-pre-wrap">{hostError}</pre>
        </div>
      ) : null}
    </>
  );
};

/**
 * The box around several selected nodes: their count on its edge and the toolbar of what they
 * share.
 */
const GroupOutline = ({
  frame,
  inv,
  nodes,
  rect,
  targets,
}: {
  frame: { height: number; width: number };
  inv: number;
  nodes: readonly DesignNode[];
  rect: Rect;
  targets: readonly Selection[];
}) => {
  const color = kindColor("element");
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        height: rect.height,
        left: rect.x,
        outline: `${1 * inv}px dashed ${color}`,
        outlineOffset: 3 * inv,
        top: rect.y,
        width: rect.width,
      }}
    >
      <span
        className="absolute left-0 flex h-5 items-center rounded-t-[5px] px-1.5 font-body font-semibold text-white leading-4"
        style={{
          background: color,
          bottom: "100%",
          transform: `translate(${-1 * inv}px, ${-4 * inv}px) scale(${inv})`,
          transformOrigin: "bottom left",
        }}
      >
        {nodes.length} selected
      </span>
      <GroupToolbar
        frame={frame}
        inv={inv}
        nodes={nodes}
        rect={rect}
        targets={targets}
      />
    </div>
  );
};

/** A frame whose size is not known yet: nothing keeps the toolbar in. */
const UNBOUNDED = {
  height: Number.POSITIVE_INFINITY,
  width: Number.POSITIVE_INFINITY,
};

/**
 * A node's outline, in the colour of what it is: blue for an element, purple for a component. The
 * selection's name sits on its top-left edge, where the element toolbar hangs its controls from;
 * its size is the inspector's.
 */
const Outline = ({
  bare = false,
  frame = UNBOUNDED,
  rect,
  inv,
  kind,
  node,
}: {
  /** One of several selected: outlined only, the group carries the name and the toolbar. */
  bare?: boolean;
  /** The frame's size, which the toolbar stays inside while it fits. */
  frame?: { height: number; width: number };
  rect: { x: number; y: number; width: number; height: number };
  inv: number;
  kind: "hover" | "selection";
  node: DesignNode | null;
}) => {
  const tone = selectionKindOf(node);
  const color = kind === "selection" ? kindColor(tone) : kindHoverColor(tone);
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        height: rect.height,
        left: rect.x,
        outline: `${(kind === "selection" ? 2 : 1) * inv}px solid ${color}`,
        outlineOffset: -1 * inv,
        top: rect.y,
        width: rect.width,
      }}
    >
      {kind === "selection" && !bare && node ? (
        <>
          <SelectionTag
            color={color}
            inside={rect.y < TAG_HEIGHT * inv}
            inv={inv}
            node={node}
          />
          <ElementToolbar frame={frame} inv={inv} node={node} rect={rect} />
        </>
      ) : null}
    </div>
  );
};
