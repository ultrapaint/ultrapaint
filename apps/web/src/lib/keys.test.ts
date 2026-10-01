import { describe, expect, it } from "vitest";
import { shortcutLabel } from "./keys.ts";

describe("shortcut labels", () => {
  it("are written the Mac way on a Mac", () => {
    expect(shortcutLabel("⇧⌘Z", true)).toBe("⇧⌘Z");
  });

  it("name the keys elsewhere, Ctrl for ⌘", () => {
    expect(shortcutLabel("⇧⌘Z", false)).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel("⌥⌘G", false)).toBe("Ctrl+Alt+G");
    expect(shortcutLabel("⌘↩", false)).toBe("Ctrl+Enter");
    expect(shortcutLabel("⇧1", false)).toBe("Shift+1");
    expect(shortcutLabel("⌫", false)).toBe("Backspace");
    expect(shortcutLabel("C", false)).toBe("C");
  });
});
