/**
 * What the pointer is over in a frame, as the canvas means it: the preview's hit test with the
 * locked nodes taken out. A locked node is chosen in the layers panel, never on the canvas.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import { findLayer } from "@ultrapaint/design-document/instance-layers";
import { appFileOf, rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { asDrawnIn } from "../state/selection.ts";
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

/**
 * The layers under a point of a frame, as a right-click there lists them (ADR 0143): those a
 * click may take, the deepest first and the frame's root last, without those hidden at the
 * frame's breakpoint. Each is the node as the frame draws it, an instance's layer as its main
 * component's tree has it (ADR 0114).
 */
export const layersUnder = (
  frameId: string,
  x: number,
  y: number
): readonly DesignNode[] => {
  const root = frameRoot(frameId);
  return hitUnlocked(frameId, x, y)
    .map((id) => findLayer(root, id, appFileOf))
    .flatMap((node) => {
      // Hidden or not as the frame draws it, at its breakpoint (ADR 0036).
      const drawn = node && asDrawnIn(node, frameId);
      return drawn && !drawn.hidden ? [drawn] : [];
    })
    .reverse();
};

/** Whether a frame shows a locked node: one placed on the canvas and locked there. */
export const isFrameLocked = (frameId: string) =>
  frameRoot(frameId)?.locked === true;
