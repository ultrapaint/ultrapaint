import type { Rect } from "@ultrapaint/contracts/preview";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import type { ReactNode } from "react";
import { useEditor } from "../state/editor.ts";
import { boxOf, isCreateTool, useCreate } from "./create-tool.ts";
import { useDrag } from "./drag.ts";

const BRAND = "#4f8cff";

/**
 * What a drag looks like: the element following the pointer as an outline, and where it would
 * land. Drawn in the canvas's own coordinates, so it zooms with the frames; strokes and labels
 * keep their size on screen.
 */
export const DragOverlay = ({ zoom }: { zoom: number }) => {
  const dragged = useDrag((s) => s.dragged);
  const drop = useDrag((s) => s.drop);
  const pointer = useDrag((s) => s.pointer);
  const grab = useDrag((s) => s.grab);
  const copy = useDrag((s) => s.copy);
  if (!dragged) {
    return null;
  }
  const inv = 1 / zoom;
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
    <div className="pointer-events-none absolute top-0 left-0">
      {dragged.kind === "node" && (
        <div
          className="absolute rounded-sm"
          style={{
            background: "rgba(79,140,255,0.08)",
            height: dragged.rect.height,
            left: pointer.x - grab.x,
            outline: `${1.5 * inv}px dashed ${BRAND}`,
            top: pointer.y - grab.y,
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
export const CreateOverlay = ({ zoom }: { zoom: number }) => {
  const mode = useEditor((s) => s.mode);
  const drop = useCreate((s) => s.drop);
  const from = useCreate((s) => s.from);
  const to = useCreate((s) => s.to);
  if (!isCreateTool(mode)) {
    return null;
  }
  const inv = 1 / zoom;
  const drawn = mode === "group" && from && to ? boxOf(from, to) : null;
  return (
    <div className="pointer-events-none absolute top-0 left-0">
      {drop?.kind === "into" && drop.box && <Box inv={inv} rect={drop.box} />}
      {drop?.kind === "into" && drop.line && (
        <Line inv={inv} rect={drop.line} />
      )}
      {drawn && drawn.width > 0 && drawn.height > 0 ? (
        <div
          className="absolute"
          style={{
            background: "rgba(79,140,255,0.08)",
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
    className="absolute top-0 left-0 whitespace-nowrap rounded-sm bg-brand px-1 py-0.5 font-medium text-[10px] text-brand-foreground"
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
      background: "rgba(79,140,255,0.06)",
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
