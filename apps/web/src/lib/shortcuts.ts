import { childrenOf } from "@ultrapaint/design-document/tree";
import { useEffect } from "react";
import { bridgeFor } from "../canvas/bridge.ts";
import { useComments } from "../state/comments.ts";
import { api } from "../state/connection.ts";
import { pathIn, useDocuments } from "../state/documents.ts";
import {
  flushLayout,
  useEditor,
  type Viewport,
  workspaceOrder,
} from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import {
  deleteSelection,
  duplicateSelection,
  selected,
  wrapSelection,
} from "./node-actions.ts";

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable)
  );
};

/**
 * Dialogs, menus and select popups are not page-blocking the way native confirm/prompt were, so
 * while one is open keys must not reach the canvas (Backspace would delete the selection behind
 * it). They are only mounted while open; focus can stay on the trigger, so the target is no guide.
 */
const overlayOpen = () =>
  document.querySelector(
    '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'
  ) !== null;

type EditorState = ReturnType<typeof useEditor.getState>;

const NAV_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"];

/** Steps back or forward through everything the editor changed, files and canvas alike. */
export const undoOrRedo = async (redo: boolean) => {
  try {
    await flushLayout();
    await (redo
      ? api().request("edit.redo", undefined)
      : api().request("edit.undo", undefined));
  } catch (error) {
    reportError(error);
  }
};

/** Editing shortcuts are exclusive: returns true when the key was consumed. */
const handleEditKey = (e: KeyboardEvent, s: EditorState, meta: boolean) => {
  if (meta && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undoOrRedo(e.shiftKey);
    return true;
  }
  if (meta && e.key.toLowerCase() === "d" && s.selection) {
    e.preventDefault();
    duplicateSelection();
    return true;
  }
  // ⌘G wraps in a group, ⌥⌘G in a row, ⇧⌘G in a column.
  if (meta && e.key.toLowerCase() === "g" && s.selection) {
    e.preventDefault();
    let wrapper: "row" | "column" | "group" = "group";
    if (e.altKey) {
      wrapper = "row";
    } else if (e.shiftKey) {
      wrapper = "column";
    }
    wrapSelection(wrapper);
    return true;
  }
  if ((e.key === "Backspace" || e.key === "Delete") && s.selection) {
    e.preventDefault();
    deleteSelection();
    return true;
  }
  if (e.key === "Enter" && s.selection) {
    const current = selected();
    if (current?.node.type === "text") {
      e.preventDefault();
      bridgeFor(s.selection.frame).editText(s.selection.nodeId);
      return true;
    }
  }
  return false;
};

const handleModeKey = (e: KeyboardEvent, s: EditorState, meta: boolean) => {
  if (!meta && e.key.toLowerCase() === "v") {
    s.setMode("select");
  }
  if (!meta && e.key.toLowerCase() === "i") {
    s.setMode("interact");
  }
  if (!meta && e.key.toLowerCase() === "h") {
    s.setMode("pan");
  }
  // Groups and texts are made on the canvas, which the prototype does not show.
  if (!meta && e.key.toLowerCase() === "g" && s.workspace !== "prototype") {
    s.setMode("group");
  }
  if (!meta && e.key.toLowerCase() === "t" && s.workspace !== "prototype") {
    s.setMode("text");
  }
  // Comments belong to the canvas, which the prototype does not show.
  if (!meta && e.key.toLowerCase() === "c" && s.workspace !== "prototype") {
    if (e.shiftKey) {
      useComments.getState().toggleVisible();
    } else {
      s.setMode("comment");
      if (!useComments.getState().visible) {
        useComments.getState().toggleVisible();
      }
    }
  }
};

/**
 * Ctrl+1..3 jump to a workspace. Ctrl and not ⌘, which the browser keeps for its tabs, and
 * exclusive: returns true when the key was consumed.
 */
const handleWorkspaceKey = (e: KeyboardEvent, s: EditorState) => {
  if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
    return false;
  }
  const next = workspaceOrder[Number(e.key) - 1];
  if (!next) {
    return false;
  }
  e.preventDefault();
  s.setWorkspace(next);
  return true;
};

const handleZoomKey = (e: KeyboardEvent, s: EditorState, meta: boolean) => {
  const viewport = viewportSize();
  if (e.shiftKey && e.key === "!") {
    s.zoomToFit(viewport);
  }
  if (e.shiftKey && e.key === "@") {
    s.zoomToSelection(viewport);
  }
  if (e.shiftKey && e.key === "0") {
    s.setView({ zoom: 1 });
  }
  if (meta && (e.key === "=" || e.key === "+")) {
    e.preventDefault();
    zoomBy(1.25);
  }
  if (meta && e.key === "-") {
    e.preventDefault();
    zoomBy(0.8);
  }
};

// Tree navigation: up and down through siblings, left to the parent, right into the children.
const handleTreeNavigation = (e: KeyboardEvent, s: EditorState) => {
  const { selection } = s;
  if (!(selection && NAV_KEYS.includes(e.key))) {
    return;
  }
  const path = pathIn(
    useDocuments.getState().docs,
    s.space,
    selection.frame,
    selection.nodeId
  );
  const node = path?.at(-1);
  if (!node) {
    return;
  }
  e.preventDefault();
  const parent = path?.at(-2);
  const go = (id: string) => s.select({ frame: selection.frame, nodeId: id });
  if (e.key === "Escape" || e.key === "ArrowLeft") {
    if (parent && parent.type !== "page") {
      go(parent.id);
    } else if (e.key === "Escape") {
      s.select(null);
    }
  } else if (e.key === "ArrowRight") {
    const [child] = childrenOf(node);
    if (child) {
      go(child.id);
    }
  } else if (parent) {
    const siblings = childrenOf(parent);
    const idx = siblings.findIndex((c) => c.id === node.id);
    const sib = siblings[idx + (e.key === "ArrowDown" ? 1 : -1)];
    if (sib) {
      go(sib.id);
    }
  }
};

/**
 * Escape closes an open comment, or gives up on one being written, before it lets go of a
 * selected page. Returns true when the key was consumed.
 */
const handleEscape = (s: EditorState) => {
  const comments = useComments.getState();
  if (comments.draft || comments.open) {
    comments.setDraft(null);
    comments.setOpen(null);
    return true;
  }
  if (s.selectedPage) {
    s.selectPage(null);
    return true;
  }
  return false;
};

export const useShortcuts = () => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The settings page replaces the editor: nothing on it is there to be acted on.
      if (overlayOpen() || useProject.getState().settingsOpen) {
        return;
      }
      const s = useEditor.getState();
      // A workspace switch carries no meaning for a text field, so it works while typing too.
      if (handleWorkspaceKey(e, s)) {
        return;
      }
      if (isTyping(e)) {
        return;
      }
      const meta = e.metaKey || e.ctrlKey;
      if (handleEditKey(e, s, meta)) {
        return;
      }
      if (e.key === "Escape" && handleEscape(s)) {
        return;
      }
      handleModeKey(e, s, meta);
      handleZoomKey(e, s, meta);
      handleTreeNavigation(e, s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
};

/**
 * The part of the canvas that can be seen, in the canvas's own coordinates: the left panel floats
 * over the canvas's left edge, and what is fitted or zoomed into belongs in what is left of it.
 */
export const viewportSize = (): Viewport => {
  const el = document.querySelector("[data-canvas]");
  if (!el) {
    return { height: window.innerHeight, width: window.innerWidth - 544, x: 0 };
  }
  const rect = el.getBoundingClientRect();
  const panel = document
    .querySelector("[data-canvas-cover]")
    ?.getBoundingClientRect();
  const covered = panel ? Math.max(0, panel.right - rect.left) : 0;
  return { height: rect.height, width: rect.width - covered, x: covered };
};

export const zoomBy = (k: number) => {
  const s = useEditor.getState();
  const { width, height, x } = viewportSize();
  const cx = x + width / 2;
  const cy = height / 2;
  const next = Math.min(4, Math.max(0.05, s.view.zoom * k));
  const r = next / s.view.zoom;
  s.setView({
    x: cx - (cx - s.view.x) * r,
    y: cy - (cy - s.view.y) * r,
    zoom: next,
  });
};

export const useProjectName = () => useProject((s) => s.info.name);
