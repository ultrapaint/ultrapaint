import { assert, describe, it } from "@effect/vitest";
import {
  differenceOf,
  intervalOf,
  percent,
  points,
  recallOf,
  showInterval,
} from "./recall-stats.ts";

const gaps = (caught: readonly number[], runs = 2) =>
  caught.map((c) => ({ caught: c, runs }));

describe("recall's statistics", () => {
  it("gives a version the share of its runs that caught, over every gap", () => {
    assert.strictEqual(recallOf(gaps([2, 1, 0, 0])), 3 / 8);
    assert.strictEqual(recallOf([]), undefined);
    assert.strictEqual(recallOf([{ caught: 0, runs: 0 }]), undefined);
  });

  it("puts the recall inside an interval that narrows as the gaps agree", () => {
    const mixed = intervalOf(gaps([2, 2, 0, 0, 2, 0, 1, 1, 2, 0]));
    assert.isDefined(mixed);
    assert.isBelow(mixed?.low ?? 1, 0.5);
    assert.isAbove(mixed?.high ?? 0, 0.5);
    // Every gap caught every time: no resampling of them gives anything else.
    assert.deepStrictEqual(intervalOf(gaps([2, 2, 2, 2])), { high: 1, low: 1 });
  });

  it("says the same thing each time it is asked", () => {
    const counted = gaps([2, 0, 1, 2, 0, 0, 1, 2]);
    assert.deepStrictEqual(intervalOf(counted), intervalOf(counted));
  });

  it("holds 0 in the interval of a difference two gaps make", () => {
    const one = gaps([2, 2, 1, 0, 0, 1, 2, 0, 1, 1]);
    const other = gaps([2, 1, 1, 0, 0, 1, 2, 1, 1, 0]);
    const d = differenceOf(one, other);
    assert.isDefined(d);
    assert.closeTo(d?.difference ?? 1, 1 / 20, 1e-9);
    assert.isAtMost(d?.low ?? 1, 0);
    assert.isAtLeast(d?.high ?? -1, 0);
  });

  it("keeps a difference every gap makes clear of 0", () => {
    const d = differenceOf(
      gaps([2, 2, 2, 2, 2, 2, 2, 2]),
      gaps([1, 0, 1, 0, 1, 0, 1, 0])
    );
    assert.isAbove(d?.low ?? 0, 0);
  });

  it("writes shares, intervals and differences in whole points", () => {
    assert.strictEqual(percent(60 / 102), "59%");
    assert.strictEqual(showInterval({ high: 0.684, low: 0.49 }), "49–68%");
    assert.strictEqual(points(0.118), "+12");
    assert.strictEqual(points(-0.03), "−3");
    assert.strictEqual(points(0.001), "0");
  });
});
