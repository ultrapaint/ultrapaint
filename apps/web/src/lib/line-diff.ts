/**
 * The lines an agent's edit changes. Agents send a tool call's diff as the file before and after,
 * so the editor works out itself what moved; git's own diffs come ready-made from the server.
 */

export interface DiffRow {
  readonly kind: "added" | "removed" | "same";
  readonly text: string;
}

/** Above this many lines the table costs more than the picture is worth. */
const MAX_LINES = 2000;

const lines = (text: string) => (text === "" ? [] : text.split("\n"));

const row = (kind: DiffRow["kind"], text: string | undefined): DiffRow => ({
  kind,
  text: text ?? "",
});

/** `common[i][j]` is the length of the longest common subsequence of `a[i:]` and `b[j:]`. */
const commonTable = (a: readonly string[], b: readonly string[]) => {
  const common: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const here = common[i] ?? [];
    const next = common[i + 1] ?? [];
    for (let j = b.length - 1; j >= 0; j -= 1) {
      here[j] =
        a[i] === b[j]
          ? (next[j + 1] ?? 0) + 1
          : Math.max(next[j] ?? 0, here[j + 1] ?? 0);
    }
  }
  return common;
};

/**
 * What moved between two versions of a file: everything on the longest common subsequence stayed,
 * the rest was added or removed. Beyond `MAX_LINES` the file counts as replaced rather than
 * filling a table of millions of cells.
 */
export const lineDiff = (before: string, after: string): DiffRow[] => {
  const a = lines(before);
  const b = lines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text) => row("removed", text)),
      ...b.map((text) => row("added", text)),
    ];
  }

  const common = commonTable(a, b);
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push(row("same", a[i]));
      i += 1;
      j += 1;
    } else if ((common[i + 1]?.[j] ?? 0) >= (common[i]?.[j + 1] ?? 0)) {
      rows.push(row("removed", a[i]));
      i += 1;
    } else {
      rows.push(row("added", b[j]));
      j += 1;
    }
  }
  return [
    ...rows,
    ...a.slice(i).map((text) => row("removed", text)),
    ...b.slice(j).map((text) => row("added", text)),
  ];
};

/**
 * The changed lines with a little of what surrounds them, the way a diff is usually read. Long
 * runs of unchanged lines are dropped.
 */
export const diffHunks = (rows: readonly DiffRow[], context = 2): DiffRow[] => {
  const keep = new Set<number>();
  rows.forEach((r, index) => {
    if (r.kind === "same") {
      return;
    }
    for (let k = index - context; k <= index + context; k += 1) {
      keep.add(k);
    }
  });
  return rows.filter((_, index) => keep.has(index));
};

export const diffCounts = (rows: readonly DiffRow[]) => ({
  added: rows.filter((r) => r.kind === "added").length,
  removed: rows.filter((r) => r.kind === "removed").length,
});
