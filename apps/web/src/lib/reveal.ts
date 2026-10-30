/**
 * Bringing something into view on the canvas, the canvas's counterpart of showing a panel: a
 * page's frame or a node, wherever it is. The canvas it is on is opened, the prototype or a
 * board view left for the page canvas, it is selected, and the camera glides to it once its frame
 * is laid out (`zoomToSelectionOnceLaidOut`), so a caller neither measures the canvas nor waits
 * a frame.
 */
import type { Page } from "@ultrapaint/contracts/pages";
import { useBoard } from "../state/board.ts";
import { zoomToSelectionOnceLaidOut } from "../state/camera.ts";
import { frameOfCanvasNode, useDocuments } from "../state/documents.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { type FrameRef, frameRefOf } from "../state/frame-ref.ts";
import { goTo, toPageCanvas } from "../state/location.ts";
import { useProject } from "../state/project.ts";
import { select, selectPage } from "../state/selection.ts";

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
export const reveal = (target: Revealed): Promise<void> => {
  revealing += 1;
  const asked = revealing;
  if ("canvas" in target) {
    return revealBesidePages(target, asked);
  }
  const ref = frameRefOf(frameOfTarget(target));
  switch (ref.kind) {
    case "board":
      // A node of a board's tree is on the board view, which stays open.
      revealOnBoard(ref, target as Selection);
      return Promise.resolve();
    case "node":
      return revealInFrame(target, undefined, asked);
    default: {
      const page = useProject.getState().pages.find((p) => p.id === ref.page);
      return page ? revealInFrame(target, page, asked) : Promise.resolve();
    }
  }
};

/** A node beside the pages of a canvas, in whichever of its frames holds it. */
const revealBesidePages = async (
  target: { readonly canvas: string; readonly nodeId: string },
  asked: number
) => {
  // What is revealed is on the page canvas: a board view open gives way to it.
  toPageCanvas();
  useEditor.getState().setWorkspace("design");
  if (target.canvas !== useEditor.getState().canvas) {
    await goTo({ canvas: target.canvas });
  }
  if (!stillAsked(asked, target.canvas)) {
    return;
  }
  const frame = await frameHolding(target.canvas, target.nodeId, asked);
  if (frame !== null) {
    select({ frame, nodeId: target.nodeId });
    zoomToSelectionOnceLaidOut(frame);
  }
};

/**
 * A page's frame, or a node of a frame of the page canvas: the page's canvas opened first, when it
 * is another; a node beside the pages (no page) is on the open one.
 */
const revealInFrame = async (
  target: { readonly page: string } | Selection,
  page: Page | undefined,
  asked: number
) => {
  const frame = frameOfTarget(target);
  // What is revealed is on the page canvas: a board view open gives way to it.
  toPageCanvas();
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
    selectPage(target.page);
  } else {
    select(target);
  }
  zoomToSelectionOnceLaidOut(frame);
};

const frameOfTarget = (target: { page: string } | Selection) =>
  "page" in target ? target.page : target.frame;

/**
 * A node of a board brought into view: on the board view open, selected, the camera gliding to
 * it there. A board of another item, or of a board view not open, has nothing to show.
 */
const revealOnBoard = (
  board: Extract<FrameRef, { kind: "board" }>,
  target: Selection
) => {
  const { open } = useBoard.getState();
  if (!(open && open.view === board.view && open.item === board.item)) {
    return;
  }
  select(target);
  zoomToSelectionOnceLaidOut(target.frame);
};
