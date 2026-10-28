/**
 * The design system the project imported, and its conventions. The inspector's pickers, the
 * Design system panel, the Assets panel and every preview read it from here.
 */
import type {
  DesignSystem,
  DesignSystemState,
} from "@ultrapaint/contracts/design-system";
import {
  type Breakpoint,
  breakpointsOf,
} from "@ultrapaint/design-document/breakpoints";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface DesignSystemStore extends DesignSystemState {
  /** Runs the fixed-rule scan and saves what it finds. */
  detect: () => Promise<DesignSystem | null>;
  detecting: boolean;
  load: () => Promise<void>;
  loaded: boolean;
}

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
  load: () => designSystemData.read().catch(reportError),
  loaded: false,
}));

// `problem` and `notes` are set even when absent: a design system that reads again clears the
// last one's.
const take = (state: DesignSystemState) =>
  useDesignSystem.setState({
    ...state,
    loaded: true,
    notes: state.notes,
    problem: state.problem,
  });

const designSystemData = follow({
  apply: take,
  on: { designSystem: take },
  read: () => api().request("designSystem.get", undefined),
});

const breakpointCache = new WeakMap<DesignSystem, readonly Breakpoint[]>();

/** The design system's breakpoints (ADR 0036), the same list while it stays the same. */
export const breakpointsFor = (
  ds: DesignSystem | null
): readonly Breakpoint[] => {
  if (!ds) {
    return breakpointsOf(null);
  }
  let found = breakpointCache.get(ds);
  if (!found) {
    found = breakpointsOf(ds);
    breakpointCache.set(ds, found);
  }
  return found;
};

/** The breakpoints of the design system now. */
export const currentBreakpoints = () =>
  breakpointsFor(useDesignSystem.getState().designSystem);

export const useBreakpoints = () =>
  useDesignSystem((s) => breakpointsFor(s.designSystem));
