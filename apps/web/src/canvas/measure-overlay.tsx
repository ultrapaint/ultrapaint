/**
 * The distances ⌥ shows (ADR 0131): from the selection to the node the pointer is over in the
 * same frame, or from the selection to its parent's edges while the pointer is over the selection
 * itself. Drawn in `--measure` beside the selection's chrome, outside the page's clip, its lines
 * and pills at their size on screen whatever the zoom.
 */
import type { Rect } from "@ultrapaint/contracts/preview";
import { layerPath } from "@ultrapaint/design-document/instance-layers";
import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { appFileOf, rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useSelectedIn } from "../state/selection.ts";
import { unionOf } from "./boxes.ts";
import { screenPx, UNZOOM, useExactInv } from "./camera.ts";
import { frameOf, useFrameEvents } from "./editor-frame.ts";
import { useHoverIn } from "./frame-highlights.tsx";
import { type MeasureLine, measureLines, type Point } from "./measure.ts";
import { useMeasuring } from "./measure-key.ts";
import { CANVAS_TAG } from "./selection-chrome.tsx";

/**
 * Where a straight piece between two points on one axis is drawn, a pixel thick on screen: a
 * filled box centred on them, or a dashed one's single border. Snapping's lines are drawn so too
 * (`snap-overlay`).
 */
export const pieceStyle = (
  from: Point,
  to: Point,
  dashed: boolean
): CSSProperties => {
  const left = Math.min(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const across = screenPx(1);
  if (from.y === to.y) {
    const width = Math.abs(to.x - from.x);
    return dashed
      ? { borderTopWidth: across, left, top, width }
      : { height: across, left, top, transform: "translateY(-50%)", width };
  }
  const height = Math.abs(to.y - from.y);
  return dashed
    ? { borderLeftWidth: across, height, left, top }
    : { height, left, top, transform: "translateX(-50%)", width: across };
};

/** A length in a pill centred on `at`, set as the size label at its size on screen. */
export const MeasurePill = ({
  at,
  children,
}: {
  at: Point;
  children: ReactNode;
}) => (
  <div
    className="absolute flex h-0 w-0 items-center justify-center"
    style={{ left: at.x, top: at.y }}
  >
    <span
      className={cn(CANVAS_TAG, "bg-measure")}
      data-measure-length
      style={{ transform: UNZOOM }}
    >
      {children}
    </span>
  </div>
);

/** One distance: its line, the dashed way to a box it passes beside, and its length in a pill. */
const Distance = ({ line }: { line: MeasureLine }) => {
  const mid = {
    x: (line.from.x + line.to.x) / 2,
    y: (line.from.y + line.to.y) / 2,
  };
  return (
    <>
      <div
        className="absolute bg-measure"
        data-measure-line={line.axis}
        style={pieceStyle(line.from, line.to, false)}
      />
      {line.guide ? (
        <div
          className="absolute border-0 border-measure border-dashed"
          style={pieceStyle(line.guide.from, line.guide.to, true)}
        />
      ) : null}
      <MeasurePill at={mid}>{line.length}</MeasurePill>
    </>
  );
};

/**
 * What is measured: from the selection's box to the node the pointer is over, or to the parent
 * the selection is in while the pointer is over the selection itself.
 */
type Measured = { from: Rect; to: Rect } | { from: Rect; parent: string };

const useMeasured = (frameId: string): Measured | null => {
  const selected = useSelectedIn(frameId);
  const hoverId = useHoverIn(frameId);
  const rects = useEditor((s) => s.rects[frameId]);
  const canvas = useEditor((s) => s.canvas);
  const root = useDocuments((s) => rootOfFrame(s.docs, canvas, frameId));
  if (hoverId === null || !rects) {
    return null;
  }
  const from = unionOf(selected.flatMap((id) => rects[id] ?? []));
  if (!from) {
    return null;
  }
  if (!selected.includes(hoverId)) {
    const to = rects[hoverId];
    return to ? { from, to } : null;
  }
  // Over the selection itself: its insets in its parent, which its children may cover whole;
  // several selected, in the parent they share, if they share one.
  const parents = new Set(
    selected.map((id) => layerPath(root, id, appFileOf)?.at(-2)?.id)
  );
  const [parent] = parents;
  if (parents.size !== 1 || parent === undefined) {
    return null;
  }
  return { from, parent };
};

/** The lines, kept at their size on screen as the view zooms. */
const Distances = ({ lines }: { lines: readonly MeasureLine[] }) => {
  const ref = useRef<HTMLDivElement>(null);
  useExactInv(ref);
  return (
    <div className="pointer-events-none absolute inset-0 z-30" ref={ref}>
      {lines.map((line) => (
        <Distance
          key={`${line.axis} ${line.from.x} ${line.from.y}`}
          line={line}
        />
      ))}
    </div>
  );
};

/** The distances between two boxes. */
const Between = ({ from, to }: { from: Rect; to: Rect }) => {
  const lines = measureLines(from, to);
  return lines.length > 0 ? <Distances lines={lines} /> : null;
};

/**
 * The selection's insets in its parent, whose box is read as the frame draws it: a change to
 * the parent alone moves nothing watched.
 */
const InParent = ({
  frameId,
  from,
  parent,
}: {
  frameId: string;
  from: Rect;
  parent: string;
}) => {
  const read = () => frameOf(frameId).measure([parent])[parent];
  const [to, setTo] = useState(read);
  useFrameEvents(frameId, { rendered: () => setTo(read()) });
  return to ? <Between from={from} to={to} /> : null;
};

const Measuring = ({ frameId }: { frameId: string }) => {
  const measured = useMeasured(frameId);
  if (!measured) {
    return null;
  }
  return "parent" in measured ? (
    <InParent
      frameId={frameId}
      from={measured.from}
      key={measured.parent}
      parent={measured.parent}
    />
  ) : (
    <Between from={measured.from} to={measured.to} />
  );
};

/** What ⌥ measures in a frame, in the frame's own pixels. */
export const MeasureOverlay = ({ frameId }: { frameId: string }) =>
  useMeasuring(frameId) ? <Measuring frameId={frameId} /> : null;
