/**
 * Asking an agent for variations (ADR 0098): the count Ask an agent's Variations control is set
 * to, remembered in the browser; the `Variations` task for a thing, sent in a new chat on the
 * person's Enter, Make variations… or Make more… (ADR 0074); and Try again on the takes that
 * failed, in the round's own chat. The popover is opened from the right-click menu and the
 * inspector through `requestAsk`.
 */
import {
  DEFAULT_TAKES,
  MAX_TAKES,
  type VariationsTask,
} from "@ultrapaint/contracts/tasks";
import {
  takesIn,
  type VariationRound,
  type VariationTarget,
  variationRefOf,
} from "@ultrapaint/contracts/variations";
import { create } from "zustand";
import { runTask, runTaskIn } from "./start-thread.ts";

/** One change: the popover as it always was. */
export const ONE_CHANGE = 1;

const TAKES_KEY = "ultrapaint:variations-count";

const readTakes = (): number => {
  try {
    const n = Number(localStorage.getItem(TAKES_KEY));
    return Number.isInteger(n) && n >= ONE_CHANGE && n <= MAX_TAKES
      ? n
      : ONE_CHANGE;
  } catch {
    // Nothing kept, or no storage: One change, the popover as it always was.
    return ONE_CHANGE;
  }
};

interface AskStore {
  /**
   * The popover asked open on the selection, from the right-click menu or the inspector, set to
   * `takes`; `at` tells two asks apart.
   */
  readonly request: { readonly at: number; readonly takes: number } | null;
  /** What the popover's Variations control is set to: One change (1), or 2 to 4 takes. */
  readonly takes: number;
}

export const useAsk = create<AskStore>(() => ({
  request: null,
  takes: readTakes(),
}));

/** The Variations control set, and remembered for next time. */
export const chooseTakes = (takes: number) => {
  useAsk.setState({ takes });
  try {
    localStorage.setItem(TAKES_KEY, String(takes));
  } catch {
    // Not kept: the control is set for now all the same.
  }
};

/** The count Make variations… and Make more… open at: the one chosen last, three the first time. */
export const takesForMore = (): number => {
  const { takes } = useAsk.getState();
  return takes > ONE_CHANGE ? takes : DEFAULT_TAKES;
};

/** Opens Ask an agent's popover on the selection, its Variations control set to `takes`. */
export const requestAsk = (takes = takesForMore()) =>
  useAsk.setState({ request: { at: Date.now(), takes } });

/** How long an ask waits for the selection's popover: one left over opens nothing later. */
const ASK_FRESH_MS = 1500;

/** The ask the popover opens at, while it is fresh. */
export const freshAsk = (
  request: AskStore["request"] = useAsk.getState().request
): AskStore["request"] =>
  request !== null && Date.now() - request.at < ASK_FRESH_MS ? request : null;

/** The popover's ask taken: it is open now. */
export const askTaken = () => useAsk.setState({ request: null });

/** The task for `takes` variations of a thing, `vary` saying what should vary. */
export const variationsTask = (
  target: VariationTarget,
  takes: number,
  vary: string
): VariationsTask => ({
  _tag: "Variations",
  count: takes,
  target: variationRefOf(target),
  ...(vary.trim() !== "" && { vary: vary.trim() }),
});

/** Asks an agent for variations of a thing, in a new chat opened in front (ADR 0074). */
export const askForVariations = (
  target: VariationTarget,
  takes: number,
  vary: string,
  subject: string
) => runTask(variationsTask(target, takes, vary), `Variations of ${subject}`);

/** Asks the round's chat again for as many takes as failed, on Try again. */
export const tryAgain = (round: VariationRound) =>
  runTaskIn(
    round.thread,
    variationsTask(round, takesIn(round, "failed"), round.vary ?? "")
  );
