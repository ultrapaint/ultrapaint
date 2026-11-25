import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "./default-theme.ts";
import { tailwindTheme } from "./testing.ts";

const DECLARATION_RE = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
const SPACES_RE = /\s+/g;
/** The namespaces `default-theme` holds: those whose tokens a class names. */
const READ_RE =
  /^(?:color|radius|text|leading|tracking|shadow|inset-shadow|container)-|^font-(?:sans|serif|mono)$/;
/** A text's shadow, which no class the reader knows names. */
const NOT_READ_RE = /^text-shadow-/;

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

  it("holds every value the installed stylesheet declares in a namespace the reader names", () => {
    const missing = Array.from(
      tailwindTheme().matchAll(DECLARATION_RE),
      ([, name = ""]) => name
    ).filter(
      (name) =>
        READ_RE.test(name) &&
        !NOT_READ_RE.test(name) &&
        !DEFAULT_THEME.has(name)
    );
    expect(missing).toEqual([]);
  });
});
