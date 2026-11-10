/**
 * A file's text before and after, as the diff of a `FileDiff`: how a snapshot or a checkpoint
 * is compared with the designs now (`design-refs.ts`), git being no part of it.
 */

/** The lines `a[from..to)` of one side. */
interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * LCS lengths on the lines of two spans, one row after the other: the cell of `a[i..)` and
 * `b[j..)`, both cut at their span's end, is at `(i - a.from) * (width + 1) + (j - b.from)`.
 */
const lcsTable = (
  a: readonly string[],
  b: readonly string[],
  rows: Span,
  columns: Span
): Uint32Array => {
  const height = rows.to - rows.from;
  const width = columns.to - columns.from;
  const stride = width + 1;
  const dp = new Uint32Array((height + 1) * stride);
  for (let i = height - 1; i >= 0; i -= 1) {
    const row = i * stride;
    const next = row + stride;
    const line = a[rows.from + i];
    for (let j = width - 1; j >= 0; j -= 1) {
      dp[row + j] =
        line === b[columns.from + j]
          ? (dp[next + j + 1] as number) + 1
          : Math.max(dp[next + j] as number, dp[row + j + 1] as number);
    }
  }
  return dp;
};

/** How many lines `a[i..)` and `b[j..)` start with alike. */
const sharedStart = (
  a: readonly string[],
  b: readonly string[],
  i: number,
  j: number
): number => {
  let shared = 0;
  while (
    i + shared < a.length &&
    j + shared < b.length &&
    a[i + shared] === b[j + shared]
  ) {
    shared += 1;
  }
  return shared;
};

/** How many lines `a[i..)` and `b[j..)` end with alike. */
const sharedEnd = (
  a: readonly string[],
  b: readonly string[],
  i: number,
  j: number
): number => {
  let last = a.length - 1;
  let other = b.length - 1;
  while (last >= i && other >= j && a[last] === b[other]) {
    last -= 1;
    other -= 1;
  }
  return a.length - 1 - last;
};

/**
 * Tells two spans apart into `out`, a line each, and answers where it stopped. That is their
 * end, unless both files go on past the spans with the same line (`tailed`) and one span runs
 * out while the other's next line is that one: the two pair up there, and whoever called tells
 * the rest apart from that pair on.
 */
const tellApart = (
  a: readonly string[],
  b: readonly string[],
  rows: Span,
  columns: Span,
  tailed: boolean,
  out: string[]
): readonly [i: number, j: number] => {
  const stride = columns.to - columns.from + 1;
  // Only two lines that differ, with lines left on both sides, are told apart by the table.
  const dp =
    rows.to > rows.from && columns.to > columns.from
      ? lcsTable(a, b, rows, columns)
      : null;
  const lcs = (row: number, column: number) =>
    dp?.[(row - rows.from) * stride + (column - columns.from)] ?? 0;
  let i = rows.from;
  let j = columns.from;
  const meetsTail = () =>
    tailed &&
    ((i === rows.to && b[j] === a[rows.to]) ||
      (j === columns.to && a[i] === b[columns.to]));
  while ((i < rows.to || j < columns.to) && !meetsTail()) {
    if (i < rows.to && j < columns.to && a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i += 1;
      j += 1;
    } else if (
      j < columns.to &&
      (i >= rows.to || lcs(i, j + 1) >= lcs(i + 1, j))
    ) {
      out.push(`+${b[j]}`);
      j += 1;
    } else {
      out.push(`-${a[i]}`);
      i += 1;
    }
  }
  return [i, j];
};

/**
 * Line-based unified-ish diff good enough for review; git is not involved for snapshots.
 *
 * The lines two texts start with and end with alike need no table: an edit to a long file
 * costs the square of what lies between them, not of the file. The lines they end with stand
 * as the end of the diff only when both sides reach them at once (`tellApart`), so the diff is
 * the one a table over the whole of both files gives.
 */
export const simpleDiff = (
  file: string,
  before: string,
  after: string
): string => {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: string[] = [`--- a/${file}`, `+++ b/${file}`];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const start = sharedStart(a, b, i, j);
    for (const line of a.slice(i, i + start)) {
      out.push(` ${line}`);
    }
    i += start;
    j += start;
    const tail = sharedEnd(a, b, i, j);
    [i, j] = tellApart(
      a,
      b,
      { from: i, to: a.length - tail },
      { from: j, to: b.length - tail },
      tail > 0,
      out
    );
  }
  return out.join("\n");
};
