/**
 * The distances ⌥ shows (ADR 0131): from the selection to the node the pointer is over in the
 * same frame, or from the selection to its parent's edges while the pointer is over the selection
 * itself. Drawn in `--measure` beside the selection's chrome, outside the page's clip, its lines
 * and pills at their size on screen whatever the zoom.
 */
import type { Rect } from "@ultrapaint/contracts/preview";
import { layerPath } from "@ultrapaint/design-document/instance-layers";
import { type CSSProperties, useReducer, useRef } from "react";
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
 * filled box centred on them, or a dashed one's single border.
 */
const pieceStyle = (from: Point, to: Point, dashed: boolean): CSSProperties => {
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
      <div
        className="absolute flex h-0 w-0 items-center justify-center"
        style={{ left: mid.x, top: mid.y }}
      >
        <span
          className={cn(CANVAS_TAG, "bg-measure")}
          data-measure-length
          style={{ transform: UNZOOM }}
        >
          {line.length}
        </span>
      </div>
    </>
  );
};

/**
 * A parent's box as the frame drew it, read from the page at its `drawing`th drawing: the count
 * is what makes each drawing a new reading, where a value kept from the last render would do.
 */
const parentBox = (frameId: string, parent: string, _drawing: number) =>
  frameOf(frameId).measure([parent])[parent];

/**
 * The boxes measured: the selection's, and what the pointer means by the node it is over, at
 * the frame's `drawing`th drawing.
 */
const useMeasured = (
  frameId: string,
  drawing: number
): { from: Rect; to: Rect } | null => {
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
  const to = parentBox(frameId, parent, drawing);
  return to ? { from, to } : null;
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

const Measuring = ({ frameId }: { frameId: string }) => {
  // The parent is measured as the frame draws: each drawing reads it again, as a change to the
  // parent alone moves nothing watched.
  const [drawing, drawn] = useReducer((n: number) => n + 1, 0);
  useFrameEvents(frameId, { rendered: drawn });
  const measured = useMeasured(frameId, drawing);
  const lines = measured ? measureLines(measured.from, measured.to) : [];
  return lines.length > 0 ? <Distances lines={lines} /> : null;
};

/** What ⌥ measures in a frame, in the frame's own pixels. */
export const MeasureOverlay = ({ frameId }: { frameId: string }) =>
  useMeasuring(frameId) ? <Measuring frameId={frameId} /> : null;
