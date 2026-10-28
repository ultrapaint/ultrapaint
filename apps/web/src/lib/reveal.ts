/**
 * Bringing something into view on the canvas, the canvas's counterpart of showing a panel: a
 * page's frame or a node, wherever it is. The canvas it is on is opened, the prototype left
 * for the design workspace, it is selected, and the camera glides to it once its frame is laid
 * out (`zoomToSelectionOnceLaidOut`), so a caller neither measures the canvas nor waits a frame.
 */
import { zoomToSelectionOnceLaidOut } from "../state/camera.ts";
import { isNodeFrame, pageOfFrame } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { goTo } from "../state/location.ts";
import { useProject } from "../state/project.ts";

/**
 * What is brought into view: a page's frame (a view's selects its page), or a node of a frame,
 * a page's or one beside the pages on the open canvas.
 */
export type Revealed = { readonly page: string } | Selection;

/** Counts the reveals asked for: only the last one asked for goes on once its canvas is open. */
let revealing = 0;

/**
 * Brings `target` into view, selected: done once it is selected on its canvas, the camera moving
 * when the frame is laid out. A page no canvas has is left alone.
 */
export const reveal = async (target: Revealed): Promise<void> => {
  revealing += 1;
  const asked = revealing;
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
    if (asked !== revealing || useEditor.getState().canvas !== page.canvas) {
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
