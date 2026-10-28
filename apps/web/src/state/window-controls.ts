/**
 * Where the window's own buttons are (`Platform.windowControls`): the room the title card leaves
 * them, and whether the top of the editor moves the window. Nothing in a browser.
 */
import { useSyncExternalStore } from "react";
import { platform } from "../platform.ts";

const never = () => () => undefined;

export interface WindowChrome {
  /** The cards at the top are the window's title bar: dragged, they move it. */
  drag: boolean;
  /** How far from the window's left edge the buttons reach; 0 when none are drawn. */
  inset: number;
}

/** The window's buttons as they are now: none in full screen. */
export const useWindowChrome = (): WindowChrome => {
  const controls = platform().windowControls;
  // A boolean, which React compares by value: across the shell's bridge each read is a copy.
  const fullScreen = useSyncExternalStore(
    controls?.subscribe ?? never,
    () => controls?.current().fullScreen ?? false
  );
  if (!controls) {
    return { drag: false, inset: 0 };
  }
  return { drag: true, inset: fullScreen ? 0 : controls.current().inset };
};
