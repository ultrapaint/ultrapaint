/**
 * The design system the project imported, and its conventions. The inspector's pickers, the
 * Design system panel, the Library and every preview read it from here.
 *
 * An edit is live (ADR 0045): while a field is typed in, its operations are laid over the design
 * system the server last sent (`draftEdits`), so every frame draws the value typed; committed
 * (`commitEdits`), they are one `designSystem.edit`, one undo step, and the draft gives way to
 * what the server sends back.
 */
import type {
  DesignSystem,
  DesignSystemState,
} from "@ultrapaint/contracts/design-system";
import type { DesignSystemEdit } from "@ultrapaint/contracts/design-system-edit";
import {
  type Breakpoint,
  breakpointsOf,
} from "@ultrapaint/design-document/breakpoints";
import { applyEdits } from "@ultrapaint/design-document/design-system-edits";
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
  /** The design system as the server last sent it, without the draft being typed. */
  saved: DesignSystem | null;
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
  saved: null,
}));

/** The design system as the server last sent it, under the draft. */
let saved: DesignSystem | null = null;
/** The operations of a field being typed in, laid over `saved`; null when none is. */
let draft: readonly DesignSystemEdit[] | null = null;
/** A draft committed: the next design system the server sends replaces it. */
let settling = false;

/** `saved` with the draft laid over it; as it is while the draft does not fit (a value half typed). */
const drawn = (): DesignSystem | null => {
  if (!(saved && draft)) {
    return saved;
  }
  const edited = applyEdits(saved, draft);
  return "problem" in edited ? saved : edited;
};

// `problem` and `notes` are set even when absent: a design system that reads again clears the
// last one's.
const take = (state: DesignSystemState) => {
  saved = state.designSystem;
  if (settling) {
    settling = false;
    draft = null;
  }
  useDesignSystem.setState({
    ...state,
    designSystem: drawn(),
    loaded: true,
    notes: state.notes,
    problem: state.problem,
    saved,
  });
};

const designSystemData = follow({
  apply: take,
  on: { designSystem: take },
  read: () => api().request("designSystem.get", undefined),
  whole: ["designSystem"],
});

/**
 * Draws the design system with `ops` made, as typed, until they are committed or let go (null):
 * nothing is sent.
 */
export const draftEdits = (ops: readonly DesignSystemEdit[] | null) => {
  draft = ops && ops.length > 0 ? ops : null;
  settling = false;
  useDesignSystem.setState({ designSystem: drawn() });
};

/**
 * Sends `ops` as one `designSystem.edit`, one undo step, drawn meanwhile as the draft is: the
 * draft gives way to the design system the server sends back, or at once when it is refused.
 */
export const commitEdits = async (
  ops: readonly DesignSystemEdit[],
  label?: string
): Promise<boolean> => {
  if (ops.length === 0) {
    draftEdits(null);
    return true;
  }
  draft = ops;
  useDesignSystem.setState({ designSystem: drawn() });
  try {
    await api().request("designSystem.edit", {
      ops,
      ...(label !== undefined && { label }),
    });
    settling = true;
    // What the server sends back takes the draft's place; asked for, so it never waits.
    designSystemData.read().catch(reportError);
    return true;
  } catch (error) {
    draftEdits(null);
    reportError(error);
    return false;
  }
};

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
