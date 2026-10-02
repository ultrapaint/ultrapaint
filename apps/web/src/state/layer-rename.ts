/**
 * A layer named in place. While the layers panel is open, Rename from a menu or the Assets panel types
 * the new name into the layer's own row, as Figma does; with the panel closed it asks in a dialog.
 */
import { create } from "zustand";
import type { Selection } from "./editor.ts";

interface LayerRenameStore {
  /** How many layers panels are open: one, or none. */
  readonly panels: number;
  /** A node whose row should turn into a name field, until the panel takes it up. */
  readonly request: Selection | null;
}

export const useLayerRename = create<LayerRenameStore>(() => ({
  panels: 0,
  request: null,
}));

/** Counts a layers panel in, and gives back what counts it out. */
export const openLayersPanel = () => {
  useLayerRename.setState((s) => ({ panels: s.panels + 1 }));
  return () => useLayerRename.setState((s) => ({ panels: s.panels - 1 }));
};

/** Asks the layers panel to rename a node in its row; false when no panel is there to. */
export const requestInlineRename = (target: Selection) => {
  if (useLayerRename.getState().panels === 0) {
    return false;
  }
  useLayerRename.setState({ request: target });
  return true;
};

/** The panel has taken the request up. */
export const takeRenameRequest = () =>
  useLayerRename.setState({ request: null });
