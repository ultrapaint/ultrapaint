import * as React from "react";
import { bridgeFor } from "../canvas/bridge.ts";
import { api } from "../state/connection.ts";
import { findPath, useEditor } from "../state/editor.ts";
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
  document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]') !==
  null;

export const runEdit = async (op: import("@ultrapaint/contracts").EditOp) => {
  const s = useEditor.getState();
  try {
    const r = await api().request("edit.apply", { op });
    const sel = s.selection;
    if (sel && r.location && op.kind !== "delete") s.select({ ...sel, source: r.location });
    if (op.kind === "delete") s.select(null);
    if (r.warnings.length) console.warn(r.warnings.join("\n"));
    return r;
  } catch (error) {
    reportError(error);
    return null;
  }
};

export const useShortcuts = () => {
  React.useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (isTyping(e) || overlayOpen()) return;
      const s = useEditor.getState();
      const meta = e.metaKey || e.ctrlKey;
      const viewport = viewportSize();

      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        try {
          const r = e.shiftKey
            ? await api().request("edit.redo", undefined)
            : await api().request("edit.undo", undefined);
          if (r?.location && s.selection) s.select({ ...s.selection, source: r.location });
        } catch (error) {
          reportError(error);
        }
        return;
      }
      if (meta && e.key.toLowerCase() === "d" && s.selection?.source) {
        e.preventDefault();
        void runEdit({ kind: "duplicate", target: s.selection.source });
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && s.selection?.source) {
        e.preventDefault();
        void runEdit({ kind: "delete", target: s.selection.source });
        return;
      }
      if (e.key === "Enter" && s.selection) {
        e.preventDefault();
        bridgeFor(s.selection.screenId).editText(s.selection.nodeId);
        return;
      }
      if (!meta && e.key.toLowerCase() === "v") s.setMode("select");
      if (!meta && e.key.toLowerCase() === "i") s.setMode("interact");
      if (!meta && e.key.toLowerCase() === "h") s.setMode("pan");
      if (e.shiftKey && e.key === "!") s.zoomToFit(viewport);
      if (e.shiftKey && e.key === "@") s.zoomToSelection(viewport);
      if (e.shiftKey && e.key === "0") s.setView({ zoom: 1 });
      if (meta && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomBy(1.25);
      }
      if (meta && e.key === "-") {
        e.preventDefault();
        zoomBy(0.8);
      }

      // Tree navigation.
      if (
        s.selection &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"].includes(e.key)
      ) {
        const tree = s.trees[s.selection.screenId];
        const path = findPath(tree, s.selection.nodeId);
        if (!path) return;
        e.preventDefault();
        const node = path[path.length - 1];
        const parent = path[path.length - 2];
        if (!node) return;
        const go = (id: string, source: import("@ultrapaint/contracts").SourceLocation | null) =>
          s.select({
            screenId: (s.selection as NonNullable<typeof s.selection>).screenId,
            nodeId: id,
            source,
          });
        if (e.key === "Escape" || e.key === "ArrowLeft") {
          if (parent && parent.id !== "root") go(parent.id, parent.source);
          else if (e.key === "Escape") s.select(null);
        } else if (e.key === "ArrowRight") {
          const child = node.children[0];
          if (child) go(child.id, child.source);
        } else if (parent) {
          const idx = parent.children.findIndex((c) => c.id === node.id);
          const sib = parent.children[idx + (e.key === "ArrowDown" ? 1 : -1)];
          if (sib) go(sib.id, sib.source);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
};

export const viewportSize = () => {
  const el = document.querySelector("main > div");
  return {
    width: el?.clientWidth ?? window.innerWidth - 544,
    height: el?.clientHeight ?? window.innerHeight - 40,
  };
};

export const zoomBy = (k: number) => {
  const s = useEditor.getState();
  const { width, height } = viewportSize();
  const cx = width / 2;
  const cy = height / 2;
  const next = Math.min(4, Math.max(0.05, s.view.zoom * k));
  const r = next / s.view.zoom;
  s.setView({ zoom: next, x: cx - (cx - s.view.x) * r, y: cy - (cy - s.view.y) * r });
};

export const useProjectName = () => useProject((s) => s.info.name);
