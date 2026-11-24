/**
 * The lines a page's frame being moved by its name snapped to (ADR 0138): each matched edge as a
 * line across the frame and every frame on it, the space to the nearest in a pill. Drawn above the
 * frames in the canvas's own coordinates, in `--measure`, its lines and pills at their size on
 * screen whatever the zoom, as ⌥'s distances are (ADR 0131).
 */
import { useRef } from "react";
import { useExactInv } from "./camera.ts";
import { OVER_FRAMES } from "./drag-overlay.tsx";
import { MeasurePill, pieceStyle } from "./measure-overlay.tsx";
import type { SnapGuide } from "./snap.ts";
import { useSnapGuides } from "./snap-guides.ts";

/** A point at `along` on the guide's axis and `across` on the other. */
const pointOn = (axis: SnapGuide["axis"], along: number, across: number) =>
  axis === "x" ? { x: along, y: across } : { x: across, y: along };

const Guide = ({ guide }: { guide: SnapGuide }) => {
  const { at, axis, gap } = guide;
  return (
    <>
      <div
        className="absolute bg-measure"
        data-snap-line={axis}
        style={pieceStyle(
          pointOn(axis, at, guide.from),
          pointOn(axis, at, guide.to),
          false
        )}
      />
      {gap ? (
        <MeasurePill at={pointOn(axis, at, (gap.from + gap.to) / 2)}>
          {gap.length}
        </MeasurePill>
      ) : null}
    </>
  );
};

/** The lines kept at their size on screen as the view zooms, above every frame. */
const Guides = ({ guides }: { guides: readonly SnapGuide[] }) => {
  const ref = useRef<HTMLDivElement>(null);
  useExactInv(ref);
  return (
    <div
      className="pointer-events-none absolute top-0 left-0"
      ref={ref}
      style={OVER_FRAMES}
    >
      {guides.map((guide) => (
        <Guide guide={guide} key={guide.axis} />
      ))}
    </div>
  );
};

/** What the frame being moved snaps to, while it does. */
export const SnapOverlay = () => {
  const guides = useSnapGuides((s) => s.guides);
  return guides.length > 0 ? <Guides guides={guides} /> : null;
};
