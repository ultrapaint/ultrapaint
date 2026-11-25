/**
 * What the selection carries on the canvas, as Figma draws it (ADR 0086): a handle on each corner
 * of an element inside a page, which sizes it; a stack's spacing bands, which drag its gap and its
 * padding (ADR 0145); its size under it; and the agent's button on its top-left edge while the
 * pointer is over it. Drawn outside the page's clip, so an element on the page's edge keeps them,
 * at their size on screen whatever the zoom. A page's own frame draws its name and handles; this
 * adds its bands, its size and the button. Nothing names an element on the canvas: Layers and the
 * inspector do.
 */

import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import { resolveAtBreakpoint } from "@ultrapaint/design-document/breakpoints";
import {
  findLayer,
  layerIdOf,
} from "@ultrapaint/design-document/instance-layers";
import {
  childrenOf,
  findNode,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { askTaken, freshAsk, useAsk } from "../lib/ask-variations.ts";
import { kindColor, selectionKindOf } from "../lib/selection-kind.ts";
import { sidesOf } from "../lib/sides.ts";
import { sizeLabel } from "../lib/size-label.ts";
import { useBreakpoints, useDesignSystem } from "../state/design-system.ts";
import {
  appFileOf,
  drawnRootOf,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { useEditsMain } from "../state/isolation.ts";
import { useHeldSizes, withHeldSize } from "../state/node-sizing.ts";
import { useFrameBreakpoint, useSelectedIn } from "../state/selection.ts";
import { AskAgent } from "./ask-agent.tsx";
import { unionOf } from "./boxes.ts";
import { screenPx, UNZOOM, useExactInv } from "./camera.ts";
import { useHand } from "./canvas-ground.tsx";
import { frameOf, useFrameEvents } from "./editor-frame.ts";
import type { Corner } from "./frame.tsx";
import {
  beginNodeResize,
  beginSpacingDrag,
  useSpacingDrag,
} from "./frame-gesture.ts";
import { useMeasuring } from "./measure-key.ts";
import {
  type Band,
  paddingPx,
  spacingBands,
  spacingLabel,
  spacingNameOf,
  spacingPx,
  spacingTargets,
  stackOf,
} from "./spacing-bands.ts";

const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

/** How long the button stays once the pointer leaves the selection: the way to the button. */
const LEAVE_MS = 250;

/**
 * Whether the button is shown: the pointer over the selection, on the button, or its popover
 * open; for a moment after the pointer leaves, so it can be reached.
 */
export const useAskShown = (inside: boolean) => {
  const [over, setOver] = useState(false);
  // Asked for as it was selected, before this chrome was drawn: open from the start (ADR 0098).
  const [open, setOpen] = useState(() => freshAsk() !== null);
  const [lingering, setLingering] = useState(false);
  const wasInside = useRef(inside);
  // Make variations… and Make more… open it on the selection once it is drawn (ADR 0098).
  useEffect(
    () =>
      useAsk.subscribe((now, before) => {
        if (now.request !== before.request && freshAsk(now.request) !== null) {
          setOpen(true);
        }
      }),
    []
  );
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      askTaken();
    }
  };
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
    ask: { onHover: setOver, onOpenChange, open },
    shown: inside || over || open || lingering,
  };
};

/** The node hovered in `frame`, when the pointer is over one there. */
const useHoverIn = (frame: string) =>
  useEditor((s) => (s.hover?.frame === frame ? s.hover.nodeId : null));

/** Whether the pointer is over one of `nodes` or something inside it. */
const holdsHover = (nodes: readonly DesignNode[], hoverId: string | null) =>
  hoverId !== null &&
  nodes.some(
    (n) =>
      findNode(n, hoverId) !== null ||
      // A layer of an instance is inside the instance, and of each layer around it (ADR 0114).
      hoverId.startsWith(layerIdOf(n.id, ""))
  );

/** A label on the canvas, the selection's size or a distance measured: white on its colour. */
export const CANVAS_TAG =
  "flex h-4 shrink-0 items-center whitespace-nowrap rounded-sm px-1 font-body-small-medium text-white tabular-nums";

/** The size, centred under the box, in the selection's colour; gone while ⌥ measures. */
const SizeTag = ({
  color,
  frameId,
  label,
}: {
  color: string;
  frameId: string;
  label: string;
}) =>
  useMeasuring(frameId) ? null : (
    <div
      className="pointer-events-none absolute top-full left-1/2 flex w-0 justify-center"
      style={{ marginTop: screenPx(6) }}
    >
      <span
        className={CANVAS_TAG}
        style={{
          background: color,
          transform: UNZOOM,
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

/** The thinnest a spacing band is to the pointer, on screen: a gap or padding of 0 is reachable. */
const BAND_LEAST_PX = 6;

/** A band's hatching: lines of its colour over a wash of it, at their size on screen. */
const HATCH = `repeating-linear-gradient(-45deg, currentColor 0 ${screenPx(1)}, transparent ${screenPx(1)} ${screenPx(5)}), color-mix(in srgb, currentColor 12%, transparent)`;

/**
 * Where these children of a stack are drawn, in their order, read again each time the frame
 * draws: while a band is dragged they move with it. A child that draws nothing is left out.
 */
const useChildRects = (frameId: string, ids: readonly string[]) => {
  const read = () => {
    const rects = frameOf(frameId).measure(ids);
    return ids.flatMap((id) => rects[id] ?? []);
  };
  const [rects, setRects] = useState(read);
  // A child added or taken out is drawn too: the frame draws again.
  useFrameEvents(frameId, { rendered: () => setRects(read()) });
  return rects;
};

/**
 * One band: the space hatched in the selection's colour with a handle on it and a pill naming its
 * value, shown while the pointer is over it or it is dragged. A press on it drags its spacing.
 */
const SpacingBand = ({
  active,
  band,
  box,
  color,
  label,
  onPress,
}: {
  active: boolean;
  band: Band;
  box: Rect;
  color: string;
  /** What its pill says; none for the other side Shift drags with the one pressed. */
  label: string | null;
  onPress: (e: ReactPointerEvent) => void;
}) => {
  const hand = useHand();
  const { hit, rect } = band;
  const across = band.axis === "x";
  const above = band.side === "bottom";
  return (
    <div
      className={cn(
        "group/band pointer-events-auto absolute",
        across ? "cursor-ew-resize" : "cursor-ns-resize"
      )}
      data-spacing-band={band.key}
      onPointerDown={onPress}
      style={{
        color,
        height: hit.height,
        left: hit.x - box.x,
        top: hit.y - box.y,
        width: hit.width,
      }}
    >
      <div
        className={cn(
          "absolute hidden",
          !hand && "group-hover/band:block",
          active && "block"
        )}
        style={{
          height: rect.height,
          left: rect.x - hit.x,
          top: rect.y - hit.y,
          width: rect.width,
        }}
      >
        <div className="absolute inset-0" style={{ background: HATCH }} />
        <div
          className="-translate-1/2 absolute top-1/2 left-1/2 rounded-full bg-white"
          data-spacing-handle
          style={{
            border: `${screenPx(1)} solid currentColor`,
            height: screenPx(across ? 12 : 4),
            width: screenPx(across ? 4 : 12),
          }}
        />
        {label !== null && (
          // Under the handle; over it for the bottom padding, clear of the size under the box.
          <div
            className={cn(
              "absolute left-1/2 flex w-0 justify-center",
              above ? "bottom-1/2 items-end" : "top-1/2"
            )}
            style={
              above
                ? { marginBottom: screenPx(10) }
                : { marginTop: screenPx(10) }
            }
          >
            <span
              className={CANVAS_TAG}
              style={{
                background: color,
                transform: UNZOOM,
                transformOrigin: above ? "bottom center" : "top center",
              }}
            >
              {label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * A selected stack's spacing bands (ADR 0145): its gaps and its padding's sides, worked out from
 * where it and its children are drawn and its spacing as its view draws it, held at what a drag
 * gives it. Nothing for a node without the stack's fields, nor while ⌥ measures.
 */
const SpacingBands = ({
  box,
  color,
  frameId,
  node,
  stackBox = box,
}: {
  /** The chrome's box, which the bands are placed in. */
  box: Rect;
  color: string;
  frameId: string;
  node: DesignNode;
  /** Where the stack is drawn, when not the chrome's box: a page taller than its frame. */
  stackBox?: Rect;
}) => {
  const ds = useDesignSystem((s) => s.designSystem);
  const held = useHeldSizes((s) => s.byFrame[frameId]);
  const dragged = useSpacingDrag((s) =>
    s.dragged?.frame === frameId ? s.dragged : null
  );
  const zoom = useEditor((s) => s.view.zoom);
  const measuring = useMeasuring(frameId);
  const stack = stackOf(node);
  const children = useChildRects(
    frameId,
    stack ? childrenOf(node).map((c) => c.id) : []
  );
  const drawn = withHeldSize(node, held);
  const shown = stackOf(drawn);
  if (!(stack && shown) || measuring) {
    return null;
  }
  const targets = spacingTargets(ds);
  const bands = spacingBands(
    {
      align: shown.align,
      box: stackBox,
      children,
      direction: shown.direction,
      gap: spacingPx(shown.gap, ds),
      padding: paddingPx(drawn.padding, ds),
    },
    BAND_LEAST_PX / zoom
  );
  const lengthOf = (band: Band) =>
    band.side ? sidesOf(drawn.padding)[band.side] : shown.gap;
  /** Its value as it is; dragged, the value the drag gives it, on the band pressed alone. */
  const pillOf = (band: Band): string | null => {
    if (!dragged?.keys.includes(band.key)) {
      return spacingLabel(
        band.field,
        band.px,
        spacingNameOf(lengthOf(band), targets)
      );
    }
    return dragged.keys[0] === band.key ? dragged.label : null;
  };
  return (
    <>
      {bands.map((band) => {
        const active = dragged?.keys.includes(band.key) ?? false;
        return (
          <SpacingBand
            active={active}
            band={band}
            box={box}
            color={color}
            key={band.key}
            label={pillOf(band)}
            onPress={(e) => beginSpacingDrag(e, frameId, node, band)}
          />
        );
      })}
    </>
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
  inMain,
  inside,
  node,
  rect,
}: {
  frameId: string;
  /** Whether it is a node of a main component edited in place (ADR 0120). */
  inMain: boolean;
  inside: boolean;
  node: DesignNode;
  rect: Rect;
}) => {
  const { ask, shown } = useAskShown(inside);
  const color = kindColor(selectionKindOf(node, inMain));
  const onPress = (e: ReactPointerEvent, corner: Corner) =>
    beginNodeResize(e, frameId, node.id, corner, rect);
  return (
    <Box rect={rect}>
      <SpacingBands box={rect} color={color} frameId={frameId} node={node} />
      {CORNERS.map((corner) => (
        <Handle color={color} corner={corner} key={corner} onPress={onPress} />
      ))}
      <SizeTag color={color} frameId={frameId} label={sizeLabel(rect, node)} />
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
  const color = kindColor(selectionKindOf(node));
  return (
    <Box rect={box}>
      <SpacingBands
        box={box}
        color={color}
        frameId={frameId}
        node={node}
        stackBox={rect}
      />
      <SizeTag
        color={color}
        frameId={frameId}
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
  frameId,
  inMain,
  inside,
  rect,
  targets,
}: {
  frameId: string;
  inMain: boolean;
  inside: boolean;
  rect: Rect;
  targets: readonly Selection[];
}) => {
  const { ask, shown } = useAskShown(inside);
  return (
    <Box rect={rect}>
      <SizeTag
        color={kindColor(inMain ? "component" : "element")}
        frameId={frameId}
        label={sizeLabel(rect)}
      />
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
  const drawnRoot = useDocuments((s) => drawnRootOf(s.docs, canvas, frameId));
  const breakpoint = useFrameBreakpoint(frameId);
  const breakpoints = useBreakpoints();
  const inMain = useEditsMain(frameId);
  if (!(madeHere && own && leadId !== null)) {
    return null;
  }
  const root = resolveAtBreakpoint(own, breakpoints, breakpoint);
  const nodes = [leadId, ...alsoIds].flatMap((id) => {
    const node = findLayer(root, id, appFileOf);
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
        frameId={frameId}
        inMain={inMain}
        inside={inside}
        rect={box}
        targets={nodes.map((n) => ({ frame: frameId, nodeId: n.id }))}
      />
    ) : null;
  }
  // The frame's own root, not the root of a component edited in place in it, which is an
  // element of the page it stands in.
  if (lead.id === root.id && lead.id === drawnRoot?.id) {
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
      inMain={inMain}
      inside={inside}
      key={lead.id}
      node={lead}
      rect={rect}
    />
  ) : null;
};
