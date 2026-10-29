import { describe, expect, it } from "vitest";
import { setupNeedOf } from "./setup-need.ts";

describe("what an edit is asked about", () => {
  it("asks for a repository before anything else", () => {
    expect(setupNeedOf({ configured: false })).toBe("configure");
  });

  it("lets an edit through once a project is open, design system or not", () => {
    expect(setupNeedOf({ configured: true })).toBeNull();
  });
});
