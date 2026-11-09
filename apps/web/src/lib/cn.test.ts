import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn, TYPE_TOKENS } from "./cn.ts";

describe("cn", () => {
  it("keeps one type token of two, the later", () => {
    expect(cn("font-body-medium", "font-heading-xsmall")).toBe(
      "font-heading-xsmall"
    );
    expect(
      cn("truncate font-body-medium text-muted-foreground", "font-body")
    ).toBe("truncate text-muted-foreground font-body");
    expect(cn("font-body", "font-code")).toBe("font-code");
  });

  it("knows every token styles.css defines, and no other", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const defined = [...css.matchAll(/@utility font-([\w-]+) \{/g)].map(
      (m) => m[1]
    );
    expect([...TYPE_TOKENS].sort()).toEqual(defined.sort());
  });
});
