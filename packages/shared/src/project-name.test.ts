import { describe, expect, it } from "vitest";
import { folderName, initialsOf } from "./project-name.ts";

describe("a project's name when it was given none (ADR 0107)", () => {
  it("is its folder's, on any platform, a trailing separator aside", () => {
    expect(folderName("/work/shop-admin")).toBe("shop-admin");
    expect(folderName("/work/shop-admin/")).toBe("shop-admin");
    expect(folderName("C:\\work\\shop")).toBe("shop");
  });
});

describe("a project's initials (ADR 0107)", () => {
  it("are one letter for a name of one word", () => {
    expect(initialsOf("shop")).toBe("S");
    expect(initialsOf("_shop")).toBe("S");
  });

  it("are the first letters of the first two words of a longer name", () => {
    expect(initialsOf("Pixel Forge")).toBe("PF");
    expect(initialsOf("pixel-forge app")).toBe("PF");
  });

  it("are the first character of a name with no letter, or ? for none", () => {
    expect(initialsOf("🙂")).toBe("🙂");
    expect(initialsOf("  ")).toBe("?");
  });
});
