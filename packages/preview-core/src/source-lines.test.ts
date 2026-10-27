import { describe, expect, it } from "vitest";
import { decodeMappings, sourceLineIn } from "./source-lines.ts";

describe("source lines", () => {
  // Line 1 from source line 1; line 2 empty; line 3 from source lines 5 then 7 (at column 10).
  const lines = decodeMappings("AAAA;;AAIA,UAEA");

  it("follows a module's line back to its source's", () => {
    expect(sourceLineIn(lines, 1, 1)).toBe(1);
    expect(sourceLineIn(lines, 3, 1)).toBe(5);
    expect(sourceLineIn(lines, 3, 11)).toBe(7);
  });

  it("does not say when the map does not", () => {
    expect(sourceLineIn(lines, 2, 1)).toBeNull();
    expect(sourceLineIn(lines, 9, 1)).toBeNull();
  });
});
