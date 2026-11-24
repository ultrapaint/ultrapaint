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
import type {
  DesignSystemEdit,
  DesignSystemEditInput,
} from "@ultrapaint/contracts/design-system-edit";
import {
  type Breakpoint,
  breakpointsOf,
} from "@ultrapaint/design-document/breakpoints";
import { applyEdits } from "@ultrapaint/design-document/design-system-edits";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";
import { ensureEditable } from "./setup.ts";

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
/**
 * The operations committed and saved: the next design system the server sends has them, and
 * takes the draft's place while the draft is still those, not a field typed in since.
 */
let settling: readonly DesignSystemEdit[] | null = null;

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
    if (draft === settling) {
      draft = null;
    }
    settling = null;
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
  settling = null;
  useDesignSystem.setState({ designSystem: drawn() });
};

/**
 * What a design system edit carries into its undo step (ADR 0136): a field set to the token it
 * makes, as the documents' edits or the system component's look change the field sends.
 */
export type CarriedEdits = Pick<DesignSystemEditInput, "component" | "edits">;

/**
 * Sends `ops` as one `designSystem.edit`, with what it carries, drawn meanwhile as the draft is:
 * the draft gives way to the design system the server sends back, or at once when it is refused,
 * unless another took its place meanwhile. A refusal is the caller's to report.
 */
const sendEdits = async (
  ops: readonly DesignSystemEdit[],
  label: string | undefined,
  carried: CarriedEdits = {}
) => {
  draft = ops;
  useDesignSystem.setState({ designSystem: drawn() });
  try {
    const result = await api().request("designSystem.edit", {
      ops,
      ...carried,
      ...(label !== undefined && { label }),
    });
    settling = ops;
    // What the server sends back takes the draft's place; asked for, so it never waits.
    designSystemData.read().catch(reportError);
    return result;
  } catch (error) {
    // A field typed in, or another commit made, while this one was on its way is not this one's
    // to take away.
    if (draft === ops) {
      draftEdits(null);
    }
    throw error;
  }
};

/** Sends `ops` as one `designSystem.edit`, one undo step (`sendEdits`); false when refused. */
export const commitEdits = async (
  ops: readonly DesignSystemEdit[],
  label?: string
): Promise<boolean> => {
  // A field of the design system set to a token made from its value goes in one step with it.
  const token = takeTokenMade();
  const all = token ? [token, ...ops] : ops;
  if (all.length === 0) {
    draftEdits(null);
    return true;
  }
  try {
    await sendEdits(all, label);
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};

/** The token a field's value is being made into, while the field sets itself to it (ADR 0136). */
let making: DesignSystemEdit | null = null;

/**
 * Makes a token and sets a field to it, in one undo step (ADR 0136). `setField` writes the field as
 * any edit of it does (at the view's breakpoint, as an instance's override, at a look's place),
 * and the edit that sends at once takes the token with it (`takeTokenMade`), as one
 * `designSystem.edit`. A field whose write sends nothing at once leaves the token to be sent alone.
 */
export const makeTokenFor = (op: DesignSystemEdit, setField: () => void) => {
  // Nothing is made while the field could not be written (a point of the history looked at).
  if (!ensureEditable()) {
    return;
  }
  making = op;
  try {
    setField();
  } finally {
    const left = takeTokenMade();
    if (left) {
      commitEdits([left]);
    }
  }
};

/**
 * The token being made for the field whose edit is about to be sent, taken so that it goes in
 * that edit's step; null when none is. Every way a field's edit is sent asks before it sends.
 */
export const takeTokenMade = (): DesignSystemEdit | null => {
  const op = making;
  making = null;
  return op;
};

/** A token made, sent with the field's edit it carries (`makeTokenFor`); a refusal is the caller's. */
export const commitTokenWith = (
  op: DesignSystemEdit,
  carried: CarriedEdits,
  label?: string
) => sendEdits([op], label, carried);

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
