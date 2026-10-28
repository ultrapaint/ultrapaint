/**
 * Bringing something into view on the canvas, the canvas's counterpart of showing a panel: a
 * page's frame or a node, wherever it is. The canvas it is on is opened, the prototype left
 * for the design workspace, it is selected, and the camera glides to it once its frame is laid
 * out (`zoomToSelectionOnceLaidOut`), so a caller neither measures the canvas nor waits a frame.
 */
import { zoomToSelectionOnceLaidOut } from "../state/camera.ts";
import {
  frameOfCanvasNode,
  isNodeFrame,
  pageOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { goTo } from "../state/location.ts";
import { useProject } from "../state/project.ts";

/**
 * What is brought into view: a page's frame (a view's selects its page), a node of a frame, a
 * page's or one beside the pages on the open canvas, or a node beside the pages of a canvas,
 * whichever of its frames holds it.
 */
export type Revealed =
  | { readonly page: string }
  | Selection
  | { readonly canvas: string; readonly nodeId: string };

/** Counts the reveals asked for: only the last one asked for goes on once its canvas is open. */
let revealing = 0;

/** Whether reveal `asked` is still the one to go on with, on `canvas`. */
const stillAsked = (asked: number, canvas: string) =>
  asked === revealing && useEditor.getState().canvas === canvas;

/**
 * The frame of `canvas` that holds `nodeId` beside its pages, once its document is read; null
 * when it does not, or when another reveal or canvas is asked for first.
 */
const frameHolding = (
  canvas: string,
  nodeId: string,
  asked: number
): Promise<string | null> =>
  new Promise((resolve) => {
    let off: () => void = () => undefined;
    const check = () => {
      const { canvas: of, docs, loaded } = useDocuments.getState();
      const read = loaded && of === canvas;
      if (!stillAsked(asked, canvas) || read) {
        off();
        resolve(read ? frameOfCanvasNode(docs, canvas, nodeId) : null);
        return true;
      }
      return false;
    };
    if (!check()) {
      const offs = [useDocuments.subscribe(check), useEditor.subscribe(check)];
      off = () => {
        for (const o of offs) {
          o();
        }
      };
    }
  });

/**
 * Brings `target` into view, selected: done once it is selected on its canvas, the camera moving
 * when the frame is laid out. A page no canvas has is left alone, as is a node no canvas holds.
 */
export const reveal = async (target: Revealed): Promise<void> => {
  revealing += 1;
  const asked = revealing;
  if ("canvas" in target) {
    useEditor.getState().setWorkspace("design");
    if (target.canvas !== useEditor.getState().canvas) {
      await goTo({ canvas: target.canvas });
    }
    if (!stillAsked(asked, target.canvas)) {
      return;
    }
    const frame = await frameHolding(target.canvas, target.nodeId, asked);
    if (frame !== null) {
      useEditor.getState().select({ frame, nodeId: target.nodeId });
      zoomToSelectionOnceLaidOut(frame);
    }
    return;
  }
  const frame = "page" in target ? target.page : target.frame;
  const page = isNodeFrame(frame)
    ? undefined
    : useProject.getState().pages.find((p) => p.id === pageOfFrame(frame));
  if (!(page || isNodeFrame(frame))) {
    return;
  }
  const editor = useEditor.getState();
  editor.setWorkspace("design");
  if (page && page.canvas !== editor.canvas) {
    await goTo({
      canvas: page.canvas,
      page: page.id,
      route: page.route ?? null,
      variant: page.variant ?? null,
    });
    // Another reveal or canvas was asked for while this one opened.
    if (!stillAsked(asked, page.canvas)) {
      return;
    }
  }
  if ("page" in target) {
    useEditor.getState().selectPage(target.page);
  } else {
    useEditor.getState().select(target);
  }
  zoomToSelectionOnceLaidOut(frame);
};
