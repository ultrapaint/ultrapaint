import { describe, expect, it } from "vitest";
import { cn } from "./cn.ts";

describe("cn", () => {
  it("drops the weight, line height and tracking a later type token sets", () => {
    expect(cn("font-body font-medium", "font-heading-xsmall")).toBe(
      "font-heading-xsmall"
    );
    expect(cn("font-body-small leading-4 tracking-wide", "font-body")).toBe(
      "font-body"
    );
  });

  it("keeps a weight after a token, as its emphasis", () => {
    expect(cn("font-body", "font-semibold")).toBe("font-body font-semibold");
    expect(cn("font-body font-medium", "font-body-small font-medium")).toBe(
      "font-body-small font-medium"
    );
  });

  it("keeps one token of two", () => {
    expect(cn("font-heading-small", "font-body")).toBe("font-body");
    expect(cn("font-body", "font-code")).toBe("font-code");
  });
});
