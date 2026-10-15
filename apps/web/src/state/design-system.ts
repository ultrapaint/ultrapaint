/**
 * The design system the project imported, and its conventions. The inspector's pickers, the
 * Design system panel, the Assets panel and every preview read it from here.
 */
import type {
  DesignSystem,
  DesignSystemState,
} from "@ultrapaint/contracts/design-system";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";

interface DesignSystemStore extends DesignSystemState {
  /** Runs the fixed-rule scan and saves what it finds. */
  detect: () => Promise<DesignSystem | null>;
  detecting: boolean;
  load: () => Promise<void>;
  loaded: boolean;
}

let bound = false;

export const useDesignSystem = create<DesignSystemStore>((set) => ({
  designSystem: null,
  detect: async () => {
    set({ detecting: true });
    try {
      return await api().request("designSystem.detect", undefined);
    } catch (error) {
      reportError(error);
      return null;
    } finally {
      set({ detecting: false });
    }
  },
  detecting: false,
  document: null,
  load: async () => {
    if (!bound) {
      bound = true;
      api().on("designSystem", (state) =>
        set({ ...state, loaded: true, problem: state.problem })
      );
    }
    try {
      const state = await api().request("designSystem.get", undefined);
      set({ ...state, loaded: true, problem: state.problem });
    } catch (error) {
      reportError(error);
    }
  },
  loaded: false,
}));
