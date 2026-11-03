import type { Rect } from "@ultrapaint/contracts/preview";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import type { ReactNode } from "react";
import { useInv } from "../state/camera.ts";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useEditor } from "../state/editor.ts";
import { boxOf, isCreateTool, useCreate } from "./create-tool.ts";
import { landingPoint, useDrag } from "./drag.ts";

/** The canvas's own blue: what is dragged or drawn is what will be selected. */
const BRAND = "var(--selection)";

/**
 * Above every frame: a node placed on the canvas is lifted over the pages (and an open comment
 * card over its neighbours), and the line saying where a drop lands inside it must not be
 * drawn underneath it.
 */
const OVER_FRAMES = { zIndex: 2 };

/**
 * What a drag looks like: the element following the pointer as an outline, and where it would
 * land. Drawn in the canvas's own coordinates, so it zooms with the frames; strokes and labels
 * keep their size on screen.
 */
export const DragOverlay = () => {
  const inv = useInv();
  const dragged = useDrag((s) => s.dragged);
  const drop = useDrag((s) => s.drop);
  const pointer = useDrag((s) => s.pointer);
  const grab = useDrag((s) => s.grab);
  const copy = useDrag((s) => s.copy);
  const free = useDrag((s) => s.free);
  const grid = useCanvasGrid((s) => s.visible);
  if (!dragged) {
    return null;
  }
  // Dropped on the canvas, it lands on the grid; into a page, the page lays it out.
  const at =
    drop?.kind === "canvas"
      ? landingPoint(pointer, grab, free, grid)
      : { x: pointer.x - grab.x, y: pointer.y - grab.y };
  let label: string | null = copy ? "Copy" : null;
  if (drop?.kind === "canvas") {
    label =
      dragged.kind === "new"
        ? "Place on the canvas"
        : `${copy ? "Copy" : "Move"} onto the canvas`;
  } else if (dragged.kind === "new") {
    label = `Insert ${dragged.name}`;
  }
  return (
    <div
      className="pointer-events-none absolute top-0 left-0"
      style={OVER_FRAMES}
    >
      {dragged.kind === "node" && (
        <div
          className="absolute rounded-sm"
          style={{
            background: "color-mix(in srgb, var(--selection) 8%, transparent)",
            height: dragged.rect.height,
            left: at.x,
            outline: `${1.5 * inv}px dashed ${BRAND}`,
            top: at.y,
            width: dragged.rect.width,
          }}
        >
          <Tag inv={inv}>
            {nodeLabel(dragged.node)}
            {label ? ` · ${label}` : ""}
          </Tag>
        </div>
      )}
      {dragged.kind === "new" && label && (
        <div
          className="absolute"
          style={{ left: pointer.x, top: pointer.y + 16 * inv }}
        >
          <Tag inv={inv}>{label}</Tag>
        </div>
      )}
      {drop?.kind === "into" && drop.box && <Box inv={inv} rect={drop.box} />}
      {drop?.kind === "into" && drop.line && (
        <Line inv={inv} rect={drop.line} />
      )}
    </div>
  );
};

/**
 * What the Group and Text tools will do: where a press would put the new node, and the group
 * being drawn with its size.
 */
export const CreateOverlay = () => {
  const inv = useInv();
  const mode = useEditor((s) => s.mode);
  const drop = useCreate((s) => s.drop);
  const from = useCreate((s) => s.from);
  const to = useCreate((s) => s.to);
  if (!isCreateTool(mode)) {
    return null;
  }
  const drawn = mode === "group" && from && to ? boxOf(from, to) : null;
  return (
    <div
      className="pointer-events-none absolute top-0 left-0"
      style={OVER_FRAMES}
    >
      {drop?.kind === "into" && drop.box && <Box inv={inv} rect={drop.box} />}
      {drop?.kind === "into" && drop.line && (
        <Line inv={inv} rect={drop.line} />
      )}
      {drawn && drawn.width > 0 && drawn.height > 0 ? (
        <div
          className="absolute"
          style={{
            background: "color-mix(in srgb, var(--selection) 8%, transparent)",
            height: drawn.height,
            left: drawn.x,
            outline: `${1.5 * inv}px solid ${BRAND}`,
            top: drawn.y,
            width: drawn.width,
          }}
        >
          <Tag inv={inv}>
            {Math.round(drawn.width)} × {Math.round(drawn.height)}
          </Tag>
        </div>
      ) : null}
    </div>
  );
};

const Tag = ({ children, inv }: { children: ReactNode; inv: number }) => (
  <span
    className="absolute top-0 left-0 flex h-5 items-center whitespace-nowrap rounded-sm bg-selection px-1.5 font-caption text-white tabular-nums"
    style={{
      transform: `translateY(calc(-100% - ${4 * inv}px)) scale(${inv})`,
      transformOrigin: "bottom left",
    }}
  >
    {children}
  </span>
);

const Box = ({ rect, inv }: { rect: Rect; inv: number }) => (
  <div
    className="absolute"
    style={{
      background: "color-mix(in srgb, var(--selection) 6%, transparent)",
      height: rect.height,
      left: rect.x,
      outline: `${2 * inv}px solid ${BRAND}`,
      top: rect.y,
      width: rect.width,
    }}
  />
);

/** Where a knob sits on the bar: centred across it, at one end along it. */
const knobAt = (vertical: boolean, end: number, side: "left" | "top") => {
  const along = vertical ? "top" : "left";
  if (side !== along) {
    return "50%";
  }
  return end ? "100%" : 0;
};

/** A zero-width or zero-height rect, drawn as a bar with a knob at each end. */
const Line = ({ rect, inv }: { rect: Rect; inv: number }) => {
  const t = 2 * inv;
  const vertical = rect.width === 0;
  return (
    <div
      className="absolute"
      style={{
        background: BRAND,
        height: vertical ? rect.height : t,
        left: vertical ? rect.x - t / 2 : rect.x,
        top: vertical ? rect.y : rect.y - t / 2,
        width: vertical ? t : rect.width,
      }}
    >
      {[0, 1].map((end) => (
        <span
          className="absolute rounded-full bg-white"
          key={end}
          style={{
            border: `${t}px solid ${BRAND}`,
            height: 7 * inv,
            left: knobAt(vertical, end, "left"),
            top: knobAt(vertical, end, "top"),
            transform: "translate(-50%, -50%)",
            width: 7 * inv,
          }}
        />
      ))}
    </div>
  );
};
