/**
 * What the editor's keys do that is no store's own: undo and redo through the server, walking the
 * selection's tree, letting go of what Escape lets go of, editing a text, the selection's menu,
 * the clipboard's events, and the zoom kept to the part of the canvas the panels leave. Which key
 * does what is the command list's (`commands.ts`); `keymap.ts` hears the keys.
 */
import { childrenOf } from "@ultrapaint/design-document/tree";
import { useEffect } from "react";
import { frameOf } from "../canvas/editor-frame.ts";
import { cancelGesture } from "../canvas/frame-gesture.ts";
import { clampZoom, nextView, setView, viewportSize } from "../state/camera.ts";
import { clearCanvasPicks } from "../state/canvas-picks.ts";
import { useComments } from "../state/comments.ts";
import { api } from "../state/connection.ts";
import { showMenu } from "../state/context-menu.ts";
import { pathIn, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { leaveIsolation } from "../state/isolation.ts";
import { layoutSaved } from "../state/page-layout.ts";
import { reportError, useProject } from "../state/project.ts";
import { select, selectPage } from "../state/selection.ts";
import { allFrames, surfaceNow } from "../state/surface.ts";
import { onCopyEvent, onPasteEvent } from "./clipboard.ts";
import { isTyping, overlayOpen } from "./keys.ts";
import { selected } from "./node-actions.ts";

type EditorState = ReturnType<typeof useEditor.getState>;

/** Steps back or forward through everything the editor changed, files and canvas alike. */
export const undoOrRedo = async (redo: boolean) => {
  try {
    await layoutSaved();
    await (redo
      ? api().request("edit.redo", undefined)
      : api().request("edit.undo", undefined));
  } catch (error) {
    reportError(error);
  }
};

/** Edits the selected text in place; false when what is selected is no text. */
export const editSelectedText = () => {
  const { selection } = useEditor.getState();
  if (!selection || selected()?.node.type !== "text") {
    return false;
  }
  frameOf(selection.frame).editText(selection.nodeId);
  return true;
};

/**
 * Walks the selection's tree by an arrow: up and down through siblings, left to the parent, right
 * into the children; Escape goes to the parent, or lets go at the top. On the canvas only: the
 * prototype shows no selection. False when nothing selected is in a tree.
 */
export const walkSelection = (key: string) => {
  const s = useEditor.getState();
  const { selection } = s;
  if (s.workspace === "prototype" || !selection) {
    return false;
  }
  const path = pathIn(
    useDocuments.getState().docs,
    s.canvas,
    selection.frame,
    selection.nodeId
  );
  const node = path?.at(-1);
  if (!node) {
    return false;
  }
  const parent = path?.at(-2);
  const go = (id: string) => select({ frame: selection.frame, nodeId: id });
  if (key === "Escape" || key === "ArrowLeft") {
    if (parent && parent.type !== "page") {
      go(parent.id);
    } else if (key === "Escape") {
      select(null);
    }
  } else if (key === "ArrowRight") {
    const [child] = childrenOf(node);
    if (child) {
      go(child.id);
    }
  } else if (parent) {
    const siblings = childrenOf(parent);
    const idx = siblings.findIndex((c) => c.id === node.id);
    const sib = siblings[idx + (key === "ArrowDown" ? 1 : -1)];
    if (sib) {
      go(sib.id);
    }
  }
  return true;
};

/**
 * What Escape lets go of before the selection: an open comment, or one being written; the
 * prototype's commenting, which has no other tool to pick in its place; a selected page. False
 * when there was none of them.
 */
export const dismiss = () => {
  const s = useEditor.getState();
  const comments = useComments.getState();
  if (comments.draft || comments.open) {
    comments.setDraft(null);
    comments.setOpen(null);
    return true;
  }
  if (s.workspace === "prototype" && s.mode === "comment") {
    s.setMode("interact");
    return true;
  }
  if (s.selectedPage) {
    selectPage(null);
    return true;
  }
  return false;
};

/**
 * Escape: one step back from whatever is going on, the first of these that has something to put
 * away. What the pointer is doing (a frame moved or sized, a drag, a marquee, a group being drawn:
 * put back, nothing saved, the tool kept), an app component edited in place (left), an open
 * comment, the prototype's commenting or a selected page (`dismiss`), what the main area holds
 * besides (a board's pick), then the selection (its parent, or let go at the top). False when
 * none had anything, and the key is the browser's.
 */
export const stepBack = (): boolean =>
  cancelGesture() ||
  leaveIsolation() ||
  dismiss() ||
  surfaceNow().escape() ||
  clearCanvasPicks() ||
  walkSelection("Escape");

/** Where on screen a point of the canvas is. */
const screenOf = (x: number, y: number) => {
  const r = document.querySelector("[data-canvas]")?.getBoundingClientRect();
  const { view } = useEditor.getState();
  return {
    x: (r?.left ?? 0) + view.x + x * view.zoom,
    y: (r?.top ?? 0) + view.y + y * view.zoom,
  };
};

/**
 * The context menu key, or ⇧F10, opens the menu of what is selected on the canvas, against it.
 * A focused row of a panel gets the browser's own contextmenu event instead, and opens its own.
 */
const openSelectionMenu = (s: EditorState) => {
  const frames = allFrames();
  if (s.selection) {
    const { frame, nodeId } = s.selection;
    const box = frames[frame];
    const rect = s.rects[frame]?.[nodeId];
    if (!box) {
      return false;
    }
    const at = rect
      ? screenOf(
          box.x + rect.x + rect.width / 2,
          box.y + rect.y + rect.height / 2
        )
      : screenOf(box.x, box.y);
    showMenu({ frame, kind: "node", nodeId }, at);
    return true;
  }
  const box = s.selectedPage ? frames[s.selectedPage] : undefined;
  if (s.selectedPage && box) {
    showMenu({ kind: "page", pageId: s.selectedPage }, screenOf(box.x, box.y));
    return true;
  }
  return false;
};

/** Nothing but the canvas has the focus: a panel's row or a button keeps its own keys. */
const onCanvasFocus = () =>
  document.activeElement === document.body ||
  document.activeElement?.closest("[data-canvas]") !== null;

/** The menu key, or ⇧F10, while the canvas has the focus; false when it opened no menu. */
export const openSelectionMenuByKey = () =>
  onCanvasFocus() && openSelectionMenu(useEditor.getState());

/** A clipboard event the editor may take: nothing typed in, no text selected, no overlay. */
const clipboardIsOurs = (e: ClipboardEvent) =>
  !(
    isTyping(e) ||
    overlayOpen() ||
    useProject.getState().settingsOpen ||
    useEditor.getState().workspace === "prototype" ||
    !(window.getSelection()?.isCollapsed ?? true)
  );

/** ⌘C, ⌘X and ⌘V copy, cut and paste nodes, through the system clipboard. */
export const useClipboardEvents = () => {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (clipboardIsOurs(e)) {
        onCopyEvent(e, e.type === "cut");
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (clipboardIsOurs(e)) {
        onPasteEvent(e);
      }
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
};

export const zoomBy = (k: number) => {
  // From the view as the next frame draws it, so a pan still waiting for that frame is kept.
  const view = nextView();
  const { width, height, x } = viewportSize();
  const cx = x + width / 2;
  const cy = height / 2;
  const next = clampZoom(view.zoom * k);
  const r = next / view.zoom;
  setView({
    x: cx - (cx - view.x) * r,
    y: cy - (cy - view.y) * r,
    zoom: next,
  });
};
