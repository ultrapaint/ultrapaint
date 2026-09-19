import { describe, expect, it } from "vitest";
import { diffCounts, diffHunks, lineDiff } from "./line-diff.ts";

const text = (rows: ReturnType<typeof lineDiff>) =>
  rows.map((r) => `${r.kind[0]} ${r.text}`);

describe("lineDiff", () => {
  it("keeps what did not move and marks what did", () => {
    expect(text(lineDiff("a\nb\nc", "a\nB\nc"))).toEqual([
      "s a",
      "r b",
      "a B",
      "s c",
    ]);
  });

  it("reads an added line as added, not as a replacement", () => {
    expect(text(lineDiff("a\nc", "a\nb\nc"))).toEqual(["s a", "a b", "s c"]);
    expect(diffCounts(lineDiff("a\nc", "a\nb\nc"))).toEqual({
      added: 1,
      removed: 0,
    });
  });

  it("handles an empty file on either side", () => {
    expect(text(lineDiff("", "a"))).toEqual(["a a"]);
    expect(text(lineDiff("a", ""))).toEqual(["r a"]);
  });
});

describe("diffHunks", () => {
  it("drops the long stretches nobody reads", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n");
    const after = ["1", "2", "3", "4", "5", "6", "7", "X"].join("\n");
    expect(text(diffHunks(lineDiff(before, after)))).toEqual([
      "s 6",
      "s 7",
      "r 8",
      "a X",
    ]);
  });
});
