import { describe, expect, it } from "vitest";
import { isTyping, shortcutLabel } from "./keys.ts";

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

describe("isTyping", () => {
  const aimedAt = (target: Partial<HTMLElement> | null) =>
    ({ target }) as unknown as Event;

  it("holds for fields, selects and editable nodes, so the canvas leaves their keys alone", () => {
    expect(isTyping(aimedAt({ tagName: "INPUT" }))).toBe(true);
    expect(isTyping(aimedAt({ tagName: "TEXTAREA" }))).toBe(true);
    expect(isTyping(aimedAt({ tagName: "SELECT" }))).toBe(true);
    expect(isTyping(aimedAt({ isContentEditable: true, tagName: "DIV" }))).toBe(
      true
    );
  });

  it("does not hold for anything else", () => {
    expect(
      isTyping(aimedAt({ isContentEditable: false, tagName: "DIV" }))
    ).toBe(false);
    expect(isTyping(aimedAt(null))).toBe(false);
  });
});
