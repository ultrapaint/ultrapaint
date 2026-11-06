/**
 * The look page (ADR 0062): a look chosen by seeing it, before the first screen or whenever the
 * project has no design system of its own. Its dials make a design system (`lookSystem`), drawn
 * on the preview while the page is open as a trial in place of the project's (`trialSystem`), so
 * the sample screens and everything else draw in it. Choosing writes it; a first prompt from the
 * start screen that waited for the look is sent then.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { FirstPrompt } from "@ultrapaint/contracts/shell-bridge";
import {
  LOOK_PRESETS,
  type LookDials,
  lookSystem,
} from "@ultrapaint/design-document/look-dials";
import { create } from "zustand";

/** The Design system item the look page's samples are drawn as. */
export const LOOK_ITEM = "look";

const FIRST_DIALS = (LOOK_PRESETS[0] as { dials: LookDials }).dials;

interface LookPageStore {
  readonly dials: LookDials;
  readonly open: boolean;
  /** The start screen's prompt, sent once the look is chosen. */
  readonly pending: FirstPrompt | null;
  /** The design system the dials come to, while the page is open. */
  readonly trial: DesignSystem | null;
}

export const useLookPage = create<LookPageStore>(() => ({
  dials: FIRST_DIALS,
  open: false,
  pending: null,
  trial: null,
}));

/** The design system drawn in place of the project's, while the look page is open. */
export const trialSystem = (): DesignSystem | null =>
  useLookPage.getState().trial;

export const showLookPage = (pending: FirstPrompt | null = null) =>
  useLookPage.setState((s) => ({
    open: true,
    pending,
    trial: lookSystem(s.dials),
  }));

export const hideLookPage = () =>
  useLookPage.setState({ open: false, pending: null, trial: null });

export const setDials = (change: Partial<LookDials>) =>
  useLookPage.setState((s) => {
    const dials = { ...s.dials, ...change };
    return { dials, trial: s.open ? lookSystem(dials) : null };
  });
