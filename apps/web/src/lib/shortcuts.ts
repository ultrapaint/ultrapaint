import type { TreeNode } from "@ultrapaint/contracts/preview";
import { useEffect } from "react";
import { bridgeFor } from "../canvas/bridge.ts";
import { api } from "../state/connection.ts";
import { useEditor, workspaceOrder } from "../state/editor.ts";
import { findPath, hostOf, rowChildren } from "../state/tree.ts";
import { reportError, useProject } from "../state/project.ts";

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

export const runEdit = async (
  op: import("@ultrapaint/contracts/edit").EditOp
) => {
  const s = useEditor.getState();
  try {
    const r = await api().request("edit.apply", { op });
    const sel = s.selection;
    if (sel && r.location && op.kind !== "delete") {
      s.select({ ...sel, source: r.location });
    }
    if (op.kind === "delete") {
      s.select(null);
    }
    if (r.warnings.length) {
      console.warn(r.warnings.join("\n"));
    }
    return r;
  } catch (error) {
    reportError(error);
    return null;
  }
};

type EditorState = ReturnType<typeof useEditor.getState>;

const NAV_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"];

const undoOrRedo = async (s: EditorState, redo: boolean) => {
  try {
    const r = redo
      ? await api().request("edit.redo", undefined)
      : await api().request("edit.undo", undefined);
    if (r?.location && s.selection) {
      s.select({ ...s.selection, source: r.location });
    }
  } catch (error) {
    reportError(error);
  }
};

/** Editing shortcuts are exclusive: returns true when the key was consumed. */
const handleEditKey = (e: KeyboardEvent, s: EditorState, meta: boolean) => {
  if (meta && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undoOrRedo(s, e.shiftKey);
    return true;
  }
  if (meta && e.key.toLowerCase() === "d" && s.selection?.source) {
    e.preventDefault();
    runEdit({ kind: "duplicate", target: s.selection.source });
    return true;
  }
  if ((e.key === "Backspace" || e.key === "Delete") && s.selection?.source) {
    e.preventDefault();
    runEdit({ kind: "delete", target: s.selection.source });
    return true;
  }
  if (e.key === "Enter" && s.selection) {
    e.preventDefault();
    bridgeFor(s.selection.screenId).editText(s.selection.nodeId);
    return true;
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

/**
 * The selected node and its parent as the layers panel shows them: a component and its host
 * element share a row, so navigation moves as if they were one node.
 */
const rowPath = (path: readonly TreeNode[]) => {
  let node = path.at(-1);
  let parent = path.at(-2);
  let depth = path.length - 2;
  if (parent && hostOf(parent)?.id === node?.id) {
    node = parent;
    depth -= 1;
    parent = path[depth];
  }
  const grand = path[depth - 1];
  if (parent && grand && hostOf(grand)?.id === parent.id) {
    parent = grand;
  }
  return { node, parent };
};

// Tree navigation.
const handleTreeNavigation = (e: KeyboardEvent, s: EditorState) => {
  const { selection } = s;
  if (!(selection && NAV_KEYS.includes(e.key))) {
    return;
  }
  const tree = s.trees[selection.screenId];
  const path = findPath(tree, selection.nodeId);
  if (!path) {
    return;
  }
  e.preventDefault();
  const { node, parent } = rowPath(path);
  if (!node) {
    return;
  }
  const go = (
    id: string,
    source: import("@ultrapaint/contracts/base").SourceLocation | null
  ) =>
    s.select({
      nodeId: id,
      screenId: selection.screenId,
      source,
    });
  if (e.key === "Escape" || e.key === "ArrowLeft") {
    if (parent && parent.id !== "root") {
      go(parent.id, parent.source);
    } else if (e.key === "Escape") {
      s.select(null);
    }
  } else if (e.key === "ArrowRight") {
    const [child] = rowChildren(node);
    if (child) {
      go(child.id, child.source);
    }
  } else if (parent) {
    const siblings = rowChildren(parent);
    const current = node;
    const idx = siblings.findIndex((c) => c.id === current.id);
    const sib = siblings[idx + (e.key === "ArrowDown" ? 1 : -1)];
    if (sib) {
      go(sib.id, sib.source);
    }
  }
};

export const useShortcuts = () => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlayOpen()) {
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
      if (e.key === "Escape" && s.selectedScreen) {
        s.selectScreen(null);
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

export const viewportSize = () => {
  const el = document.querySelector("main > div");
  return {
    height: el?.clientHeight ?? window.innerHeight,
    width: el?.clientWidth ?? window.innerWidth - 544,
  };
};

export const zoomBy = (k: number) => {
  const s = useEditor.getState();
  const { width, height } = viewportSize();
  const cx = width / 2;
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
