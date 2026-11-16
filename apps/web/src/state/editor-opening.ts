/**
 * The editor's own steps of an open (ADR 0099): its code in, the project read, the canvas drawn.
 * In the desktop app they finish the shell's opening, which began before this page; in a browser
 * they are the whole open, its estimate kept in the browser from the last one.
 */
import {
  type EditorStepId,
  estimateFrom,
  isEditorStep,
  type Opening,
  OpeningTimes,
  openingSteps,
} from "@ultrapaint/contracts/opening";
import { Option, Schema } from "effect";

/** When each of the editor's steps was done, in milliseconds since the epoch. */
export type Reached = Partial<Record<EditorStepId, number>>;

/** Where a browser keeps how long the editor's last open took. */
export const LAST_OPENING_KEY = "ultrapaint:last-opening";

const decodeTimes = Schema.decodeUnknownOption(
  Schema.fromJsonString(OpeningTimes)
);

/** The times the last open in this browser took; none when there was none, or it is unreadable. */
export const lastOpeningHere = (): OpeningTimes | undefined => {
  try {
    const kept = localStorage.getItem(LAST_OPENING_KEY);
    return kept === null ? undefined : Option.getOrUndefined(decodeTimes(kept));
  } catch {
    // Storage refused (a private window): no estimate, as on a first open.
    return undefined;
  }
};

/** Keeps how long this open took, for the next one's estimate. */
export const keepOpeningHere = (times: OpeningTimes) => {
  try {
    localStorage.setItem(LAST_OPENING_KEY, JSON.stringify(times));
  } catch {
    // Storage refused: the next open has no estimate, which is all that is lost.
  }
};

/** The editor's open in a browser, begun with the page: the server served it, so it is up. */
export const browserOpening = (options: {
  readonly name: string;
  readonly since: number;
  readonly where: string;
}): Opening => {
  const steps = openingSteps("browser");
  const estimate = estimateFrom(steps, lastOpeningHere());
  return {
    ...(estimate === undefined ? {} : { estimate }),
    log: [],
    name: options.name,
    remote: false,
    since: options.since,
    steps,
    where: options.where,
  };
};

/**
 * The opening with the editor's steps as they stand: each reached one done, timed from the end of
 * the one before (the first from when the shell began it, or the page did), the next at work.
 * A step the opening does not list (a local project's "Loading the editor") counts in the one
 * after it.
 */
export const withEditorSteps = (
  opening: Opening,
  reached: Reached
): Opening => {
  let from: number | undefined;
  let working = false;
  const steps = opening.steps.map((step) => {
    if (!isEditorStep(step.id)) {
      return step;
    }
    const begun = from ?? step.since ?? opening.since;
    const at = reached[step.id];
    const { line: _line, ms: _ms, since: _since, ...base } = step;
    if (at !== undefined) {
      from = at;
      return { ...base, ms: Math.max(0, at - begun), state: "done" as const };
    }
    if (!working) {
      working = true;
      return { ...base, since: begun, state: "now" as const };
    }
    return { ...base, state: "next" as const };
  });
  return { ...opening, steps };
};

/** How long the editor's steps took, by id: what the shell, or the browser, keeps. */
export const editorTimes = (opening: Opening): OpeningTimes =>
  Object.fromEntries(
    opening.steps.flatMap((s) =>
      isEditorStep(s.id) && s.state === "done" && s.ms !== undefined
        ? [[s.id, s.ms]]
        : []
    )
  );
