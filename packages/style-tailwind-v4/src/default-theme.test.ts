import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "./default-theme.ts";
import { tailwindTheme } from "./testing.ts";

const DECLARATION_RE = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
const SPACES_RE = /\s+/g;

describe("Tailwind's default theme", () => {
  it("holds each value as the installed stylesheet declares it", () => {
    const declared = new Map(
      Array.from(
        tailwindTheme().matchAll(DECLARATION_RE),
        ([, n = "", v = ""]) => [n, v.replace(SPACES_RE, " ").trim()]
      )
    );
    const differing = [...DEFAULT_THEME].filter(
      ([name, value]) => declared.get(name) !== value
    );
    expect(differing).toEqual([]);
  });
});
