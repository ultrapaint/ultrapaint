/**
 * The Group and Text tools of the strip. A press on the canvas makes one where a drop at that
 * point would land: inside the container under it, where its layout puts it, or on the canvas at
 * the press, standing on its own. A group can be drawn to a size, and a click gives it a default
 * one; a text is edited as soon as the preview has drawn it. Either way the tool hands back to
 * Select, as in every design tool.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { tokenOf } from "@ultrapaint/contracts/token-table";
import { newElement } from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { create } from "zustand";
import { insertNodesAt } from "../lib/node-actions.ts";
import { placeOnCanvas } from "../state/canvas-grid.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { canvasPoint, type Drop, placementAt, placeOfDrop } from "./drag.ts";
import { type EditorFrame, frameOf } from "./editor-frame.ts";

type CreateTool = "group" | "text";

interface Point {
  x: number;
  y: number;
}

interface CreateStore {
  /** Where the next one would land, under the pointer or at the press. */
  drop: Drop | null;
  /** The press and the pointer while a group is drawn, in the canvas's coordinates. */
  from: Point | null;
  to: Point | null;
}

export const useCreate = create<CreateStore>(() => ({
  drop: null,
  from: null,
  to: null,
}));

export const isCreateTool = (mode: string): mode is CreateTool =>
  mode === "group" || mode === "text";

/** Below this, in canvas pixels, a drawn group was a click. */
const CLICK_SIZE = 4;
const DEFAULT_GROUP = { height: 120, width: 200 };

/** The rectangle between two points, whichever way it was drawn. */
export const boxOf = (a: Point, b: Point) => ({
  height: Math.abs(b.y - a.y),
  width: Math.abs(b.x - a.x),
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
});

/** Shows where a press at `p` would put what the tool makes. */
const followDrop = (p: Point) =>
  useCreate.setState({ drop: placementAt(p.x, p.y) });

/** The pointer over the canvas with a tool picked: shows where a press would put it. */
export const hoverCreate = (clientX: number, clientY: number) => {
  if (!useCreate.getState().from) {
    followDrop(canvasPoint(clientX, clientY));
  }
};

/** With the grid on, both corners of what is drawn go on it, unless `free` (⌘/Ctrl) is held. */
export const beginCreate = (clientX: number, clientY: number, free = false) => {
  const p = placeOnCanvas(canvasPoint(clientX, clientY), free);
  useCreate.setState({ from: p, to: p });
  followDrop(p);
};

export const moveCreate = (clientX: number, clientY: number, free = false) => {
  if (useCreate.getState().from) {
    useCreate.setState({
      to: placeOnCanvas(canvasPoint(clientX, clientY), free),
    });
  }
};

export const cancelCreate = () =>
  useCreate.setState({ drop: null, from: null, to: null });

/** On the canvas a group stands alone, like a frame: it gets the design's background. */
const canvasFill = () => {
  const ds = useDesignSystem.getState().designSystem;
  return tokenOf(ds, "color-background") ? "$color-background" : "#ffffff";
};

const groupNode = (box: ReturnType<typeof boxOf>, drop: Drop): DesignNode => {
  const drawn = box.width >= CLICK_SIZE && box.height >= CLICK_SIZE;
  const size = drawn
    ? { height: Math.round(box.height), width: Math.round(box.width) }
    : DEFAULT_GROUP;
  return {
    ...newElement("group", makeIdGenerator()),
    ...size,
    ...(drop.kind === "canvas" && { fill: canvasFill() }),
  } as DesignNode;
};

const EDIT_TRIES = 30;
const EDIT_INTERVAL_MS = 100;

/** Whether the frame's preview is up and has the node on screen. */
const isDrawn = (frame: EditorFrame, nodeId: string) =>
  frame.ready && nodeId in frame.measure([nodeId]);

/**
 * Starts editing a new text once its frame has drawn it. A text placed on the canvas gets a frame
 * of its own, which has to load first.
 */
const editWhenDrawn = async (nodeId: string) => {
  for (let i = 0; i < EDIT_TRIES; i += 1) {
    const { selection } = useEditor.getState();
    // Selected something else meanwhile: that is where the user went.
    if (selection?.nodeId !== nodeId) {
      return;
    }
    const frame = frameOf(selection.frame);
    if (isDrawn(frame, nodeId)) {
      frame.editText(nodeId);
      return;
    }
    // biome-ignore lint/performance/noAwaitInLoops: each try waits for the preview to catch up.
    await new Promise((resolve) => setTimeout(resolve, EDIT_INTERVAL_MS));
  }
};

/** The press is over: makes the group or the text where it was. */
export const endCreate = async (tool: CreateTool) => {
  const { from, to } = useCreate.getState();
  cancelCreate();
  if (!(from && to)) {
    return;
  }
  const drop = placementAt(from.x, from.y) ?? { kind: "canvas" };
  const box = boxOf(from, to);
  const node =
    tool === "group"
      ? groupNode(box, drop)
      : newElement("paragraph", makeIdGenerator());
  useEditor.getState().setMode("select");
  const [id] = await insertNodesAt(placeOfDrop(drop, { x: box.x, y: box.y }), [
    node,
  ]);
  if (id && tool === "text") {
    await editWhenDrawn(id);
  }
};
