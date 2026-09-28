import { describe, expect, it } from "vitest";
import { type SetupFacts, setupNeedOf } from "./setup-need.ts";

const ready: SetupFacts = {
  configured: true,
  designSystem: "imported",
  dismissed: false,
};

describe("what an edit is asked about", () => {
  it("asks for a repository before anything else", () => {
    expect(
      setupNeedOf({ ...ready, configured: false, designSystem: "missing" })
    ).toBe("configure");
    expect(setupNeedOf({ ...ready, configured: false, dismissed: true })).toBe(
      "configure"
    );
  });

  it("offers /init while the design system is not imported", () => {
    expect(setupNeedOf({ ...ready, designSystem: "missing" })).toBe("init");
  });

  it("asks about /init only until the user says not now", () => {
    expect(
      setupNeedOf({ ...ready, designSystem: "missing", dismissed: true })
    ).toBeNull();
  });

  it("lets an edit through while the design system is still being read", () => {
    expect(setupNeedOf({ ...ready, designSystem: "loading" })).toBeNull();
  });

  it("lets an edit through once everything is in place", () => {
    expect(setupNeedOf(ready)).toBeNull();
  });
});
