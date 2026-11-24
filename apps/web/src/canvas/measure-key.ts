/**
 * ⌥ (Alt) held over the canvas, which measures from the selection to what the pointer is over
 * (ADR 0131). A modifier with the pointer, as ⌥-click's deep select is, never a command of the
 * shortcut list.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { isTyping } from "../lib/keys.ts";
import { useEditor } from "../state/editor.ts";
import { useDrag } from "./drag.ts";
import { useHoverIn } from "./frame-highlights.tsx";

export const useMeasureKey = create<{
  /** Whether a click still goes to the innermost node: ⌥ held, or Ctrl or ⌘ (`deep`). */
  deep: boolean;
  held: boolean;
}>(() => ({ deep: false, held: false }));

/** ⌥ held or not, and whether Ctrl or ⌘ are held with it as it changes. */
const setHeld = (held: boolean, otherDeep = false) => {
  if (useMeasureKey.getState().held !== held) {
    useMeasureKey.setState({ deep: held || otherDeep, held });
  }
};

/**
 * Whether ⌥ is held, while a canvas is on screen: set as it is pressed, unless a field or a text
 * edited on the canvas takes the key, and cleared as it is let go or the window loses focus.
 */
export const useWatchMeasureKey = () => {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt" && !isTyping(e)) {
        setHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        setHeld(false, e.ctrlKey || e.metaKey);
      }
    };
    // A key released while the window is in the background never reaches keyup.
    const blur = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      setHeld(false);
    };
  }, []);
};

/**
 * Whether ⌥ measures in a frame now: held, with the pointer over a node of the frame the
 * selection was made in, and no drag under way. Another page, or another view of the
 * selection's page, is another drawing. The selection's size gives way to the distances.
 */
export const useMeasuring = (frameId: string) => {
  const held = useMeasureKey((s) => s.held);
  const madeHere = useEditor((s) => s.selection?.frame === frameId);
  const pointed = useHoverIn(frameId) !== null;
  const dragging = useDrag((s) => s.dragged !== null);
  return held && madeHere && pointed && !dragging;
};
