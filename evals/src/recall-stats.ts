/**
 * How far a recall count can be trusted: the share of a version's runs that caught the gaps, with
 * the interval a resampling of the gaps gives it, and the difference between two versions over
 * the same gaps.
 *
 * A gap's runs go together (one section, one wording of the rule), so the gaps are what is
 * resampled, not the runs: counting 102 runs as 102 independent tries makes the interval too
 * narrow. The resampling is seeded, so a report says the same thing each time it is written.
 */

/** A gap's runs with one version: how many there were and how many caught it. */
export interface Counted {
  readonly caught: number;
  readonly runs: number;
}

/** The bounds between which 95% of the resampled values fall. */
export interface Interval {
  readonly high: number;
  readonly low: number;
}

/** How many times the gaps are resampled: enough for the bounds to hold to a point. */
export const RESAMPLES = 2000;

const MODULUS = 2_147_483_647;

/**
 * A generator of numbers in [0, 1) from a seed (Park and Miller's, whose products stay exact in
 * a double): the same seed, the same numbers.
 */
const seeded = (seed: number) => {
  let state = (seed % (MODULUS - 1)) + 1;
  const next = () => {
    state = (state * 48_271) % MODULUS;
    return (state - 1) / (MODULUS - 1);
  };
  // A small seed's first numbers are small too: they are let go.
  next();
  next();
  return next;
};

const shareOf = (counted: readonly Counted[]) => {
  const runs = counted.reduce((n, c) => n + c.runs, 0);
  return runs === 0
    ? undefined
    : counted.reduce((n, c) => n + c.caught, 0) / runs;
};

/** The value a share of the sorted values lies under. */
const quantile = (sorted: readonly number[], share: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;

/** `value` of the gaps drawn again with replacement, `RESAMPLES` times, as its 95% interval. */
const resampled = (
  gaps: number,
  value: (drawn: readonly number[]) => number | undefined
): Interval | undefined => {
  if (gaps === 0) {
    return;
  }
  const next = seeded(gaps);
  const values: number[] = [];
  for (let i = 0; i < RESAMPLES; i += 1) {
    const one = value(
      Array.from({ length: gaps }, () => Math.floor(next() * gaps))
    );
    if (one !== undefined) {
      values.push(one);
    }
  }
  if (values.length === 0) {
    return;
  }
  values.sort((a, b) => a - b);
  return { high: quantile(values, 0.975), low: quantile(values, 0.025) };
};

/** The share of runs that caught, over every gap; none when nothing was judged. */
export const recallOf = shareOf;

/** The 95% interval of a version's recall, one entry per gap. */
export const intervalOf = (perGap: readonly Counted[]) =>
  resampled(perGap.length, (drawn) =>
    shareOf(drawn.flatMap((i) => perGap[i] ?? []))
  );

/**
 * What a version caught more than another, as a difference of shares with its 95% interval: the
 * two lists hold the same gaps in the same order, and a draw takes a gap's runs with both.
 */
export const differenceOf = (
  perGap: readonly Counted[],
  against: readonly Counted[]
) => {
  const a = shareOf(perGap);
  const b = shareOf(against);
  const interval = resampled(
    Math.min(perGap.length, against.length),
    (drawn) => {
      const one = shareOf(drawn.flatMap((i) => perGap[i] ?? []));
      const other = shareOf(drawn.flatMap((i) => against[i] ?? []));
      return one === undefined || other === undefined ? undefined : one - other;
    }
  );
  return a === undefined || b === undefined || interval === undefined
    ? undefined
    : { ...interval, difference: a - b };
};

/** A share as whole points: "59%". */
export const percent = (share: number) => `${Math.round(share * 100)}%`;

/** "49–68%", the bounds of an interval in whole points. */
export const showInterval = (interval: Interval) =>
  `${Math.round(interval.low * 100)}–${Math.round(interval.high * 100)}%`;

/** A difference in whole points with its sign, "+12" or "−3", the minus a real one. */
export const points = (share: number) => {
  const n = Math.round(share * 100);
  if (n === 0) {
    return "0";
  }
  return n > 0 ? `+${n}` : `−${-n}`;
};
