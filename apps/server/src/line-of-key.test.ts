import { describe, expect, it } from "vitest";
import { lineOfKey } from "./line-of-key.ts";

const DESIGN_MD = `---
colors:
  background: oklch(0.99 0.001 80)
  primary: oklch(0.53 0.21 263)
components:
  card:
    backgroundColor: "{colors.brand-500}"
---

## Overview
`;

const TOKENS = `{
  "shadow": {
    "card": { "$value": "glow" }
  }
}
`;

describe("the line a path of keys is on", () => {
  it("finds a key under its parent in DESIGN.md's front matter", () => {
    expect(lineOfKey(DESIGN_MD, "colors.primary")).toBe(4);
    expect(lineOfKey(DESIGN_MD, "components.card.backgroundColor")).toBe(7);
  });

  it("finds a key in JSON, its name quoted", () => {
    expect(lineOfKey(TOKENS, "shadow.card")).toBe(3);
  });

  it("stops at the last key it found, and finds none for a path not there", () => {
    expect(lineOfKey(DESIGN_MD, "colors.missing")).toBe(2);
    expect(lineOfKey(DESIGN_MD, "spacing")).toBeUndefined();
  });

  it("looks for a key among its parent's own, not in a block after it", () => {
    const text =
      "colors:\n  secondary: blue\ncomponents:\n  button:\n    primary: red\n";
    expect(lineOfKey(text, "colors.primary")).toBe(1);
  });
});
