/**
 * What a frame draws over its preview: the outlines of the hovered and the selected nodes, the box
 * around several selected, and an error the preview reported.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import { resolveAtBreakpoint } from "@ultrapaint/design-document/breakpoints";
import { findNode } from "@ultrapaint/design-document/tree";
import { AlertTriangle } from "lucide-react";
import { kindColor, selectionKindOf } from "../lib/selection-kind.ts";
import { useInv } from "../state/camera.ts";
import { useBreakpoints } from "../state/design-system.ts";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { useFrameBreakpoint, useSelectedIn } from "../state/selection.ts";
import { useFrameError } from "./editor-frame.ts";
import { ElementToolbar, GroupToolbar } from "./element-toolbar.tsx";
import { GroupChatButton } from "./element-toolbar-chat.tsx";
import { SelectionTag, TAG_HEIGHT } from "./selection-tag.tsx";

/** The node hovered in this frame, if the pointer is over one here. */
export const useHoverIn = (frameId: string) =>
  useEditor((s) => (s.hover?.frame === frameId ? s.hover.nodeId : null));

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
  // A node selected in one view of a page is outlined in every view of it (ADR 0036); its
  // toolbar is the view's it was made in.
  const [selectedId = null, ...alsoIds] = useSelectedIn(frameId);
  const madeHere = useEditor((s) => s.selection?.frame === frameId);
  const hoverId = useHoverIn(frameId);
  const rects = useEditor((s) => s.rects[frameId]);
  const pageError = useFrameError(frameId);
  const canvas = useEditor((s) => s.canvas);
  // This frame's document only: an edit elsewhere has nothing to outline here. As the frame
  // draws it: a row from a breakpoint on is named a row there (ADR 0036).
  const own = useDocuments((s) => rootOfFrame(s.docs, canvas, frameId));
  const breakpoint = useFrameBreakpoint(frameId);
  const breakpoints = useBreakpoints();
  const root = own && resolveAtBreakpoint(own, breakpoints, breakpoint);
  const selectedNode = selectedId === null ? null : findNode(root, selectedId);
  const hoverNode = hoverId === null ? null : findNode(root, hoverId);
  const selectedRect = selectedId === null ? undefined : rects?.[selectedId];
  const hoverRect =
    hoverId !== null && hoverId !== selectedId ? rects?.[hoverId] : undefined;
  // Several selected: each is outlined, and what they share hangs over the box around them.
  const others = alsoIds.flatMap((nodeId) => {
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
        <Outline kind="hover" node={hoverNode} rect={hoverRect} />
      ) : null}
      {/* Kept while the frame measures a node just selected, hidden: its toolbar is updated
          for the node rather than drawn anew a frame later. */}
      {selectedRect || selectedNode ? (
        <Outline
          bare={many || !madeHere}
          hidden={!selectedRect}
          kind="selection"
          node={selectedNode}
          rect={selectedRect ?? NO_RECT}
        />
      ) : null}
      {others.map((o) => (
        <Outline
          bare
          key={o.target.nodeId}
          kind="selection"
          node={o.node}
          rect={o.rect}
        />
      ))}
      {group?.rect && madeHere ? (
        <GroupOutline
          nodes={group.nodes}
          rect={group.rect}
          targets={group.targets}
        />
      ) : null}
      {pageError ? <FrameError message={pageError.message} /> : null}
    </>
  );
};

/**
 * The box around several selected nodes: their count and the agent's button on its edge, and the
 * bar of what they share above the tools.
 */
const GroupOutline = ({
  nodes,
  rect,
  targets,
}: {
  nodes: readonly DesignNode[];
  rect: Rect;
  targets: readonly Selection[];
}) => {
  // The tag is drawn at its size on screen, whatever the zoom.
  const inv = useInv();
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
      <div
        className="pointer-events-auto absolute left-0 flex items-end gap-0.5"
        style={{
          bottom: "100%",
          transform: `translate(${-1 * inv}px, ${-4 * inv}px) scale(${inv})`,
          transformOrigin: "bottom left",
        }}
      >
        <span
          className="flex h-5 items-center whitespace-nowrap rounded-t-sm px-1.5 font-body-small-medium text-white"
          style={{ background: color }}
        >
          {nodes.length} selected
        </span>
        <GroupChatButton targets={targets} />
      </div>
      <GroupToolbar nodes={nodes} targets={targets} />
    </div>
  );
};

/**
 * What a part of the page threw and nothing caught, over the foot of the frame at its size on
 * screen, so it reads at any zoom; gone once the page draws again.
 */
const FrameError = ({ message }: { message: string }) => {
  const inv = useInv();
  return (
    <div
      className="absolute bottom-0 left-0 flex max-h-40 flex-col gap-1 overflow-auto border-destructive/40 border-t bg-popover px-3 py-2.5 text-popover-foreground"
      data-canvas-scroll
      role="alert"
      style={{
        transform: `scale(${inv})`,
        transformOrigin: "bottom left",
        width: `${100 / inv}%`,
      }}
    >
      <span className="flex items-center gap-1.5 font-body-medium">
        <AlertTriangle className="size-4 shrink-0 text-destructive" />
        Part of this page failed to draw
      </span>
      <pre className="select-text whitespace-pre-wrap font-code text-muted-foreground">
        {message}
      </pre>
    </div>
  );
};

/** Where a node not measured yet is outlined, hidden. */
const NO_RECT: Rect = { height: 0, width: 0, x: 0, y: 0 };

/**
 * A node's outline, in the colour of what it is: blue for an element, purple for a component. The
 * selection's tag sits on its top-left edge, its controls in the bar above the tools; its size is
 * the inspector's.
 */
const Outline = ({
  bare = false,
  hidden = false,
  rect,
  kind,
  node,
}: {
  /** One of several selected: outlined only, the group carries the tag and the bar. */
  bare?: boolean;
  /** Not drawn while its node is not measured yet, its bar kept. */
  hidden?: boolean;
  rect: { x: number; y: number; width: number; height: number };
  kind: "hover" | "selection";
  node: DesignNode | null;
}) => {
  // The tag is placed by it: the room it takes depends on the zoom.
  const inv = useInv();
  const tone = selectionKindOf(node);
  // Crisp, in the kind's own colour: 1px under the pointer, 2px once selected.
  const color = kindColor(tone);
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        height: rect.height,
        left: rect.x,
        outline: `${(kind === "selection" ? 2 : 1) * inv}px solid ${color}`,
        outlineOffset: -1 * inv,
        top: rect.y,
        visibility: hidden ? "hidden" : undefined,
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
            width={rect.width / inv}
          />
          <ElementToolbar node={node} />
        </>
      ) : null}
    </div>
  );
};
