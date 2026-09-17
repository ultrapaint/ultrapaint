/** LCS lengths on lines: `dp[i][j]` is the LCS of `a[i..]` and `b[j..]`. */
const lcsTable = (a: string[], b: string[]): number[][] => {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i] as number[];
    const next = dp[i + 1] as number[];
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] ?? 0) + 1
          : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return dp;
};

/** Line-based unified-ish diff good enough for review; git is not involved for snapshots. */
export const simpleDiff = (
  file: string,
  before: string,
  after: string
): string => {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: string[] = [`--- a/${file}`, `+++ b/${file}`];
  const n = a.length;
  const m = b.length;
  const dp = lcsTable(a, b);
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
