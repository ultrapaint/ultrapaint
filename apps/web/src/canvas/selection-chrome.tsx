/**
 * What the selection carries on the canvas, as Figma draws it (ADR 0086): a handle on each corner
 * of an element inside a page, which sizes it; its size under it; and the agent's button on its
 * top-left edge while the pointer is over it. Drawn outside the page's clip, so an element on the
 * page's edge keeps them, at their size on screen whatever the zoom. A page's own frame draws its
 * name and handles; this adds its size and the button. Nothing names an element on the canvas:
 * Layers and the inspector do.
 */

import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import { resolveAtBreakpoint } from "@ultrapaint/design-document/breakpoints";
import { findNode, nodeLabel } from "@ultrapaint/design-document/tree";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { kindColor, selectionKindOf } from "../lib/selection-kind.ts";
import { sizeLabel } from "../lib/size-label.ts";
import { useBreakpoints } from "../state/design-system.ts";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { useFrameBreakpoint, useSelectedIn } from "../state/selection.ts";
import { AskAgent } from "./ask-agent.tsx";
import { screenPx, useExactInv } from "./camera.ts";
import type { Corner } from "./frame.tsx";
import { beginNodeResize } from "./frame-gesture.ts";

const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

/** How long the button stays once the pointer leaves the selection: the way to the button. */
const LEAVE_MS = 250;

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

/**
 * Whether the button is shown: the pointer over the selection, on the button, or its popover
 * open; for a moment after the pointer leaves, so it can be reached.
 */
const useAskShown = (inside: boolean) => {
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);
  const [lingering, setLingering] = useState(false);
  const wasInside = useRef(inside);
  useEffect(() => {
    const was = wasInside.current;
    wasInside.current = inside;
    if (inside || !was) {
      return;
    }
    setLingering(true);
    const timer = setTimeout(() => setLingering(false), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [inside]);
  return {
    ask: { onHover: setOver, onOpenChange: setOpen, open },
    shown: inside || over || open || lingering,
  };
};

/** The node hovered in `frame`, when the pointer is over one there. */
const useHoverIn = (frame: string) =>
  useEditor((s) => (s.hover?.frame === frame ? s.hover.nodeId : null));

/** Whether the pointer is over one of `nodes` or something inside it. */
const holdsHover = (nodes: readonly DesignNode[], hoverId: string | null) =>
  hoverId !== null && nodes.some((n) => findNode(n, hoverId) !== null);

/** The size, centred under the box, in the selection's colour. */
const SizeTag = ({ color, label }: { color: string; label: string }) => (
  <div
    className="pointer-events-none absolute top-full left-1/2 flex w-0 justify-center"
    style={{ marginTop: screenPx(6) }}
  >
    <span
      className="flex h-4 shrink-0 items-center whitespace-nowrap rounded-sm px-1 font-body-small-medium text-white tabular-nums"
      style={{
        background: color,
        transform: "scale(var(--inv))",
        transformOrigin: "top center",
      }}
    >
      {label}
    </span>
  </div>
);

/** The agent's button, against the box's left edge at its top, and the way to it from the box. */
const AskSlot = ({
  ask,
  shown,
  subject,
  targets,
}: {
  ask: ReturnType<typeof useAskShown>["ask"];
  shown: boolean;
  subject: string;
  targets: readonly Selection[];
}) =>
  shown ? (
    <div
      className="pointer-events-auto absolute top-0 right-full flex pr-1"
      style={{ transform: "scale(var(--inv))", transformOrigin: "top right" }}
    >
      <AskAgent {...ask} subject={subject} targets={targets} />
    </div>
  ) : null;

/** A corner's handle: a small white square edged in the selection's colour, on the outline. */
const Handle = ({
  color,
  corner,
  onPress,
}: {
  color: string;
  corner: Corner;
  onPress: (e: ReactPointerEvent, corner: Corner) => void;
}) => {
  const off = screenPx(-4);
  const north = corner[0] === "n";
  const west = corner[1] === "w";
  return (
    <div
      className={cn(
        "pointer-events-auto absolute rounded-[1px] bg-white",
        corner === "nw" || corner === "se"
          ? "cursor-nwse-resize"
          : "cursor-nesw-resize"
      )}
      data-selection-handle={corner}
      onPointerDown={(e) => onPress(e, corner)}
      style={{
        border: `${screenPx(1)} solid ${color}`,
        bottom: north ? undefined : off,
        height: screenPx(8),
        left: west ? off : undefined,
        right: west ? undefined : off,
        top: north ? off : undefined,
        width: screenPx(8),
      }}
    />
  );
};

/**
 * The box the chrome hangs on, in the frame's own pixels. Its `--inv` is kept exact as the view
 * zooms, so what it holds keeps its size on screen through a gesture.
 */
const Box = ({ children, rect }: { children: ReactNode; rect: Rect }) => {
  const ref = useRef<HTMLDivElement>(null);
  useExactInv(ref);
  return (
    <div
      className="pointer-events-none absolute z-30"
      ref={ref}
      style={{
        height: rect.height,
        left: rect.x,
        top: rect.y,
        width: rect.width,
      }}
    >
      {children}
    </div>
  );
};

/** One element inside the page: its handles, its size and the button. */
const ElementChrome = ({
  frameId,
  inside,
  node,
  rect,
}: {
  frameId: string;
  inside: boolean;
  node: DesignNode;
  rect: Rect;
}) => {
  const { ask, shown } = useAskShown(inside);
  const color = kindColor(selectionKindOf(node));
  const onPress = (e: ReactPointerEvent, corner: Corner) =>
    beginNodeResize(e, frameId, node.id, corner, rect);
  return (
    <Box rect={rect}>
      {CORNERS.map((corner) => (
        <Handle color={color} corner={corner} key={corner} onPress={onPress} />
      ))}
      <SizeTag color={color} label={sizeLabel(rect, node)} />
      <AskSlot
        ask={ask}
        shown={shown}
        subject={nodeLabel(node)}
        targets={[{ frame: frameId, nodeId: node.id }]}
      />
    </Box>
  );
};

/**
 * The frame's own node, a page or a node on the canvas: the frame draws its outline, name and
 * handles; this, its size and the button.
 */
const RootChrome = ({
  frame,
  frameId,
  inside,
  isNode,
  node,
  rect,
}: {
  frame: { height: number; width: number };
  frameId: string;
  inside: boolean;
  isNode: boolean;
  node: DesignNode;
  rect: Rect | undefined;
}) => {
  const { ask, shown } = useAskShown(inside);
  const box = { height: frame.height, width: frame.width, x: 0, y: 0 };
  return (
    <Box rect={box}>
      <SizeTag
        color={kindColor(selectionKindOf(node))}
        label={
          isNode && rect
            ? sizeLabel(rect, node)
            : sizeLabel({ height: frame.height, width: frame.width })
        }
      />
      <AskSlot
        ask={ask}
        shown={shown}
        subject={nodeLabel(node)}
        targets={[{ frame: frameId, nodeId: node.id }]}
      />
    </Box>
  );
};

/** Several selected: the size of the box around them, and the button for all of them. */
const GroupChrome = ({
  inside,
  rect,
  targets,
}: {
  inside: boolean;
  rect: Rect;
  targets: readonly Selection[];
}) => {
  const { ask, shown } = useAskShown(inside);
  return (
    <Box rect={rect}>
      <SizeTag color={kindColor("element")} label={sizeLabel(rect)} />
      <AskSlot
        ask={ask}
        shown={shown}
        subject={`${targets.length} elements`}
        targets={targets}
      />
    </Box>
  );
};

/** The selection's chrome in the frame it was made in; nothing in the other views of its page. */
export const SelectionChrome = ({
  frame,
  frameId,
  isNode,
}: {
  frame: { height: number; width: number };
  frameId: string;
  isNode: boolean;
}) => {
  const [leadId = null, ...alsoIds] = useSelectedIn(frameId);
  const madeHere = useEditor((s) => s.selection?.frame === frameId);
  const rects = useEditor((s) => s.rects[frameId]);
  const hoverId = useHoverIn(frameId);
  const canvas = useEditor((s) => s.canvas);
  const own = useDocuments((s) => rootOfFrame(s.docs, canvas, frameId));
  const breakpoint = useFrameBreakpoint(frameId);
  const breakpoints = useBreakpoints();
  if (!(madeHere && own && leadId !== null)) {
    return null;
  }
  const root = resolveAtBreakpoint(own, breakpoints, breakpoint);
  const nodes = [leadId, ...alsoIds].flatMap((id) => {
    const node = findNode(root, id);
    return node ? [node] : [];
  });
  const [lead] = nodes;
  if (!lead) {
    return null;
  }
  const inside = holdsHover(nodes, hoverId);
  if (nodes.length > 1) {
    const box = unionOf(nodes.flatMap((n) => rects?.[n.id] ?? []));
    return box ? (
      <GroupChrome
        inside={inside}
        rect={box}
        targets={nodes.map((n) => ({ frame: frameId, nodeId: n.id }))}
      />
    ) : null;
  }
  if (lead.id === root.id) {
    return (
      <RootChrome
        frame={frame}
        frameId={frameId}
        inside={inside}
        isNode={isNode}
        node={lead}
        rect={rects?.[lead.id]}
      />
    );
  }
  const rect = rects?.[lead.id];
  return rect ? (
    <ElementChrome
      frameId={frameId}
      inside={inside}
      key={lead.id}
      node={lead}
      rect={rect}
    />
  ) : null;
};
