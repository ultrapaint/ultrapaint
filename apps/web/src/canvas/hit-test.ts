/**
 * What the pointer is over in a frame, as the canvas means it: the preview's hit test with the
 * locked nodes taken out. A locked node is chosen in the layers panel, never on the canvas.
 */
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { unlockedChain } from "../state/tree.ts";
import { frameOf } from "./editor-frame.ts";

const frameRoot = (frameId: string) =>
  rootOfFrame(
    useDocuments.getState().docs,
    useEditor.getState().canvas,
    frameId
  );

/**
 * The nodes under a point of a frame, outermost first, that a click or a drag may take: the
 * chain stops short of the first locked one.
 */
export const hitUnlocked = (
  frameId: string,
  x: number,
  y: number
): readonly string[] =>
  unlockedChain(frameOf(frameId).hitTest(x, y), frameRoot(frameId));

/** Whether a frame shows a locked node: one placed on the canvas and locked there. */
export const isFrameLocked = (frameId: string) =>
  frameRoot(frameId)?.locked === true;
