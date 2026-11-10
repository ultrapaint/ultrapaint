import { assert, describe, it } from "@effect/vitest";
import { simpleDiff } from "./services/file-diff.ts";

/**
 * The diff as a table over every line of both files gives it: what `simpleDiff` has to say,
 * whatever it leaves out of its own table.
 */
const wholeTableDiff = (file: string, before: string, after: string) => {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      (dp[i] as number[])[j] =
        a[i] === b[j]
          ? (dp[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
    }
  }
  const out: string[] = [`--- a/${file}`, `+++ b/${file}`];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i += 1;
      j += 1;
    } else if (
      j < m &&
      (i >= n || (dp[i]?.[j + 1] ?? 0) >= (dp[i + 1]?.[j] ?? 0))
    ) {
      out.push(`+${b[j]}`);
      j += 1;
    } else {
      out.push(`-${a[i]}`);
      i += 1;
    }
  }
  return out.join("\n");
};

const lines = (...all: string[]) => all.join("\n");

/** Texts of few different lines, so that lines repeat: the same ones on every run. */
const repeatingTexts = (count: number) => {
  let seed = 7;
  const next = (below: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % below;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length: next(9) }, () => "abc"[next(3)]).join("\n")
  );
};

describe("simpleDiff", () => {
  it("says a changed line between the lines two files share", () => {
    assert.strictEqual(
      simpleDiff(
        "a.json",
        lines("{", '  "x": 1,', "}"),
        lines("{", '  "x": 2,', "}")
      ),
      lines(
        "--- a/a.json",
        "+++ b/a.json",
        " {",
        '+  "x": 2,',
        '-  "x": 1,',
        " }"
      )
    );
  });

  it("says what a table over the whole of both files says", () => {
    const cases: [before: string, after: string][] = [
      ["", ""],
      ["", lines("a", "b")],
      [lines("a", "b"), ""],
      [lines("a", "b", "c"), lines("a", "b", "c")],
      [lines("a", "b", "c"), lines("a", "x", "c")],
      [lines("a", "b", "c"), lines("a", "c")],
      [lines("a", "c"), lines("a", "b", "c")],
      [lines("a", "b"), lines("c", "d")],
      // One side runs out where the other's next line is the one both end with.
      [lines("p", "y", "x"), lines("q", "y", "x", "x")],
      [lines("q", "y", "x", "x"), lines("p", "y", "x")],
      [lines("x"), lines("x", "x")],
      [lines("x", "y", "x", "y"), lines("y", "x", "y")],
      [lines("a", "}", "b", "}", "}"), lines("a", "}", "}", "c", "}")],
    ];
    for (const [before, after] of cases) {
      assert.strictEqual(
        simpleDiff("f", before, after),
        wholeTableDiff("f", before, after),
        JSON.stringify([before, after])
      );
    }
  });

  it("says it of files whose lines repeat", () => {
    const texts = repeatingTexts(40);
    for (const before of texts) {
      for (const after of texts) {
        assert.strictEqual(
          simpleDiff("f", before, after),
          wholeTableDiff("f", before, after),
          JSON.stringify([before, after])
        );
      }
    }
  });

  it("tells a long file with one line changed apart", () => {
    const body = Array.from({ length: 20_000 }, (_, i) => `line ${i % 50}`);
    const changed = body.with(10_000, "changed");
    const diff = simpleDiff("f", body.join("\n"), changed.join("\n")).split(
      "\n"
    );
    assert.strictEqual(diff.length, 20_003);
    assert.deepStrictEqual(
      diff.filter((line) => !line.startsWith(" ")),
      ["--- a/f", "+++ b/f", "+changed", "-line 0"]
    );
  });
});
