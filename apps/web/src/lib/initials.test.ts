import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials.ts";

describe("initialsOf", () => {
  it("takes the first letters of a name's first two words", () => {
    expect(initialsOf("Alessandro Narciso")).toBe("AN");
    expect(initialsOf("Ana Maria Silva")).toBe("AM");
    expect(initialsOf("  claude ")).toBe("C");
  });

  it("is a question mark for no name", () => {
    expect(initialsOf(null)).toBe("?");
    expect(initialsOf("  ")).toBe("?");
  });
});
