/**
 * The three-way rule every side is synced by (ADR 0025, 0027, 0028): a value of a side (the
 * code, Figma, DESIGN.md) against the design system's and against what the two held the last
 * time they agreed. The server's sync engine compares a side's tokens with it, and DESIGN.md's
 * mirror merges its front matter with it, so a value comes to the same on every side.
 *
 * Values are compared as Sync compares them (`sameValue`): `#2b7fff` and its `oklch()` are one
 * colour. An absent value is a value too: a token one side does not have.
 */
import type { TokenOutcome } from "./sync.ts";
import { sameValue } from "./token-value.ts";

/**
 * What a side and the design system each held for one value when they last agreed. A baseline
 * that keeps one value per key (the code's, DESIGN.md's) held the same on both sides; Figma's
 * keeps both, so a difference the user settled stays settled.
 */
export interface Agreed {
  readonly design?: string;
  readonly source?: string;
}

/** An agreement kept as one value, both sides holding it; null when nothing was agreed. */
export const agreedOn = (value: string | undefined): Agreed | null =>
  value === undefined ? null : { design: value, source: value };

/**
 * What one value comes to:
 * - the same on both sides (or on neither): `same`;
 * - the side does not have it: `source-behind`. A token is never taken out of the design system
 *   because a side left it out; the side gets it back (the code on export, DESIGN.md from the
 *   mirror) or is left as it is (Figma);
 * - nothing agreed: the design system takes a token it does not have (`to-design`), and the
 *   user picks between two values (`conflict`);
 * - changed since they agreed on the side alone: `to-design`; on the design system alone, or on
 *   neither (the user kept the design's): `source-behind`; on both: `conflict`.
 */
export const outcomeOf = (
  source: string | undefined,
  design: string | undefined,
  agreed: Agreed | null
): TokenOutcome => {
  if (sameValue(source, design)) {
    return "same";
  }
  if (source === undefined) {
    return "source-behind";
  }
  if (agreed === null) {
    return design === undefined ? "to-design" : "conflict";
  }
  const sourceChanged = !sameValue(source, agreed.source);
  const designChanged = !sameValue(design, agreed.design);
  if (sourceChanged && designChanged) {
    return "conflict";
  }
  return sourceChanged ? "to-design" : "source-behind";
};

/**
 * What the two agree on for one value once a sync is done, from what each holds now: what they
 * share; the difference itself when the sync settled it (the user kept the design's, or the
 * design's waits for a side that is never written) and the baseline can keep two values;
 * otherwise what was agreed before. Null once neither has it.
 */
export const agreedAfter = (
  source: string | undefined,
  design: string | undefined,
  previous: Agreed | null,
  settled: boolean
): Agreed | null => {
  if (source === undefined && design === undefined) {
    return null;
  }
  if (sameValue(source, design) || settled) {
    return {
      ...(design !== undefined && { design }),
      ...(source !== undefined && { source }),
    };
  }
  return previous;
};
