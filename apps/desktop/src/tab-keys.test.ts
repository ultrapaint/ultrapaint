import { describe, expect, it } from "vitest";
import { type KeyInput, tabKey } from "./tab-keys.ts";

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  alt: false,
  control: false,
  key: k,
  meta: false,
  shift: false,
  type: "keyDown",
  ...mods,
});

describe("tabKey", () => {
  it("shows a tab on ⌘1–9 on a Mac, and on Ctrl+1–9 elsewhere", () => {
    expect(tabKey(key("1", { meta: true }), true)).toBe(1);
    expect(tabKey(key("9", { meta: true }), true)).toBe(9);
    expect(tabKey(key("3", { control: true }), false)).toBe(3);
    // The other platform's modifier is not it.
    expect(tabKey(key("3", { control: true }), true)).toBeNull();
    expect(tabKey(key("3", { meta: true }), false)).toBeNull();
  });

  it("leaves every other key to the page", () => {
    expect(tabKey(key("0", { meta: true }), true)).toBeNull();
    expect(tabKey(key("1"), true)).toBeNull();
    expect(tabKey(key("1", { meta: true, shift: true }), true)).toBeNull();
    expect(tabKey(key("1", { alt: true, meta: true }), true)).toBeNull();
    expect(tabKey(key("1", { meta: true, type: "keyUp" }), true)).toBeNull();
  });
});
