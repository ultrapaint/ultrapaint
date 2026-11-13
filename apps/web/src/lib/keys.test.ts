import { describe, expect, it } from "vitest";
import { keyEventOf } from "../testing/key-events.ts";
import {
  chordLabel,
  chordOf,
  chordParts,
  chordText,
  isTyping,
  type KeyPress,
  keysLabel,
  matchesChord,
  parseChord,
  sameChord,
} from "./keys.ts";

const press = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({
  altKey: false,
  code: "",
  ctrlKey: false,
  key,
  metaKey: false,
  shiftKey: false,
  ...more,
});

const matches = (text: string, e: KeyPress) =>
  matchesChord(parseChord(text), e);

describe("chord labels", () => {
  it("are written the Mac way on a Mac, in Apple's order of modifiers", () => {
    expect(chordLabel("mod+shift+z", true)).toBe("⇧⌘Z");
    expect(chordLabel("mod+alt+g", true)).toBe("⌥⌘G");
    expect(chordLabel("ctrl+1", true)).toBe("⌃1");
    expect(chordLabel("shift+1", true)).toBe("⇧1");
    expect(chordLabel("backspace", true)).toBe("⌫");
    expect(chordLabel("enter", true)).toBe("↩");
    expect(chordLabel("escape", true)).toBe("Esc");
    expect(chordLabel("shift+f10", true)).toBe("⇧F10");
    expect(chordLabel("mod+\\", true)).toBe("⌘\\");
    expect(chordLabel("?", true)).toBe("?");
  });

  it("name the keys elsewhere, Ctrl for mod", () => {
    expect(chordLabel("mod+shift+z", false)).toBe("Ctrl+Shift+Z");
    expect(chordLabel("mod+alt+g", false)).toBe("Ctrl+Alt+G");
    expect(chordLabel("mod+enter", false)).toBe("Ctrl+Enter");
    expect(chordLabel("alt+1", false)).toBe("Alt+1");
    expect(chordLabel("shift+1", false)).toBe("Shift+1");
    expect(chordLabel("backspace", false)).toBe("Backspace");
    expect(chordLabel("c", false)).toBe("C");
    expect(chordLabel("mod+plus", false)).toBe("Ctrl++");
  });

  it("put several chords side by side", () => {
    expect(keysLabel(["arrowup", "arrowdown"], true)).toBe("↑ ↓");
  });

  it("take each platform's own chord when it has one", () => {
    const keys = { mac: "ctrl+1", other: "alt+1" };
    expect(chordText(keys, true)).toBe("ctrl+1");
    expect(chordText(keys, false)).toBe("alt+1");
    expect(keysLabel([keys], true)).toBe("⌃1");
    expect(keysLabel([keys], false)).toBe("Alt+1");
  });
});

describe("parseChord", () => {
  it("reads the modifiers and the key", () => {
    expect(parseChord("mod+shift+Z")).toEqual({
      alt: false,
      ctrl: false,
      key: "z",
      mod: true,
      shift: true,
    });
    expect(parseChord("f2").key).toBe("F2");
    expect(parseChord("space").key).toBe(" ");
    expect(parseChord("mod+plus").key).toBe("+");
  });

  it("refuses a key or a modifier it does not know", () => {
    expect(() => parseChord("mod+banana")).toThrow("banana");
    expect(() => parseChord("hyper+k")).toThrow("hyper");
  });
});

describe("matchesChord", () => {
  it("takes ⌘ for mod on a Mac and Ctrl elsewhere, as either was always taken", () => {
    expect(matches("mod+z", keyEventOf("mod+z", true))).toBe(true);
    expect(matches("mod+z", keyEventOf("mod+z", false))).toBe(true);
    expect(matches("mod+z", press("z", { ctrlKey: true }))).toBe(true);
    expect(matches("mod+z", press("z"))).toBe(false);
  });

  it("tells ⌃ from ⌘", () => {
    expect(matches("ctrl+1", keyEventOf("ctrl+1", true))).toBe(true);
    expect(
      matches("ctrl+1", press("1", { code: "Digit1", metaKey: true }))
    ).toBe(false);
  });

  it("wants every modifier it does not name up", () => {
    expect(matches("c", press("C", { shiftKey: true }))).toBe(false);
    expect(matches("shift+c", press("C", { shiftKey: true }))).toBe(true);
    expect(matches("c", press("c", { metaKey: true }))).toBe(false);
    expect(matches("mod+z", keyEventOf("mod+shift+z", true))).toBe(false);
    expect(
      matches(
        "alt+1",
        press("¡", { altKey: true, code: "Digit1", ctrlKey: true })
      )
    ).toBe(false);
  });

  it("finds a digit by where it sits, whatever Shift or Alt typed there", () => {
    expect(
      matches("shift+1", press("!", { code: "Digit1", shiftKey: true }))
    ).toBe(true);
    // AZERTY types the digit itself with Shift; ⇧0 is `)` on a US keyboard.
    expect(
      matches("shift+1", press("1", { code: "Digit1", shiftKey: true }))
    ).toBe(true);
    expect(
      matches("shift+0", press(")", { code: "Digit0", shiftKey: true }))
    ).toBe(true);
    expect(matches("alt+2", press("™", { altKey: true, code: "Digit2" }))).toBe(
      true
    );
  });

  it("finds a letter by what it types, and by where it sits when Alt types another", () => {
    expect(
      matches(
        "mod+alt+g",
        press("©", { altKey: true, code: "KeyG", metaKey: true })
      )
    ).toBe(true);
    // Dvorak's G sits where QWERTY has I.
    expect(matches("g", press("g", { code: "KeyI" }))).toBe(true);
    expect(matches("i", press("g", { code: "KeyI" }))).toBe(false);
  });

  it("takes a symbol whatever Shift did to type it", () => {
    expect(matches("?", press("?", { code: "Slash", shiftKey: true }))).toBe(
      true
    );
    expect(
      matches("mod+plus", press("+", { ctrlKey: true, shiftKey: true }))
    ).toBe(true);
    expect(matches("mod+=", press("=", { ctrlKey: true }))).toBe(true);
    expect(
      matches("mod+=", press("+", { ctrlKey: true, shiftKey: true }))
    ).toBe(false);
  });

  it("finds ' and \\ by where they sit too, for a layout that types another there", () => {
    expect(matches("mod+'", press("ä", { code: "Quote", ctrlKey: true }))).toBe(
      true
    );
    expect(
      matches(
        "mod+'",
        press("Ä", { code: "Quote", ctrlKey: true, shiftKey: true })
      )
    ).toBe(false);
    expect(
      matches("mod+\\", press("#", { code: "Backslash", metaKey: true }))
    ).toBe(true);
  });

  it("tells Backspace from Delete and names the rest by the event's key", () => {
    expect(matches("backspace", press("Backspace"))).toBe(true);
    expect(matches("backspace", press("Delete"))).toBe(false);
    expect(matches("f2", press("F2"))).toBe(true);
    expect(matches("shift+f10", press("F10", { shiftKey: true }))).toBe(true);
    expect(matches("arrowup", press("ArrowUp"))).toBe(true);
    expect(matches("space", press(" ", { code: "Space" }))).toBe(true);
  });
});

describe("chord parts", () => {
  it("are the keys of a chord one by one, as the label writes them together", () => {
    expect(chordParts("mod+shift+z", true)).toEqual(["⇧", "⌘", "Z"]);
    expect(chordParts("mod+shift+z", false)).toEqual(["Ctrl", "Shift", "Z"]);
    expect(chordParts("backspace", true)).toEqual(["⌫"]);
  });
});

describe("chordOf, a key pressed written as a chord", () => {
  const DEFAULTS = [
    "mod+z",
    "mod+shift+z",
    "mod+alt+g",
    "shift+1",
    "shift+c",
    "?",
    "mod+=",
    "mod+-",
    "mod+'",
    "mod+\\",
    "f2",
    "shift+f10",
    "backspace",
    "mod+backspace",
    "enter",
    "space",
    "arrowup",
    "ctrl+1",
    "alt+1",
  ];

  it.each([true, false])(
    "matches what was pressed, on a US keyboard (on a Mac: %s)",
    (mac) => {
      for (const text of DEFAULTS) {
        const e = keyEventOf(text, mac);
        const chord = chordOf(e, mac);
        expect(chord, text).not.toBeNull();
        expect(matches(chord ?? "", e), text).toBe(true);
      }
    }
  );

  it("writes ⌘ as mod on a Mac and Ctrl as mod elsewhere, and ⌃ as ctrl on a Mac", () => {
    expect(chordOf(press("z", { metaKey: true }), true)).toBe("mod+z");
    expect(chordOf(press("z", { ctrlKey: true }), false)).toBe("mod+z");
    expect(chordOf(press("1", { code: "Digit1", ctrlKey: true }), true)).toBe(
      "ctrl+1"
    );
  });

  it("takes a letter typed with ⌥ by where it sits, a digit by where it sits", () => {
    expect(
      chordOf(press("©", { altKey: true, code: "KeyG", metaKey: true }), true)
    ).toBe("mod+alt+g");
    expect(chordOf(press("!", { code: "Digit1", shiftKey: true }), true)).toBe(
      "shift+1"
    );
  });

  it("leaves out the Shift that typed a symbol, and writes + as plus", () => {
    expect(chordOf(press("?", { code: "Slash", shiftKey: true }), true)).toBe(
      "?"
    );
    expect(chordOf(press("+", { metaKey: true, shiftKey: true }), true)).toBe(
      "mod+plus"
    );
  });

  it("is nothing while only modifiers are down, or for a dead key", () => {
    expect(chordOf(press("Shift", { shiftKey: true }), true)).toBeNull();
    expect(chordOf(press("Meta", { metaKey: true }), true)).toBeNull();
    expect(chordOf(press("Dead", { altKey: true }), true)).toBeNull();
  });
});

describe("sameChord", () => {
  it("holds for chords pressed the same, whatever their spelling", () => {
    expect(sameChord("mod+shift+z", "shift+mod+z", true)).toBe(true);
    expect(sameChord("mod+z", "mod+shift+z", true)).toBe(false);
    expect(sameChord({ mac: "ctrl+1", other: "alt+1" }, "ctrl+1", true)).toBe(
      true
    );
    expect(sameChord({ mac: "ctrl+1", other: "alt+1" }, "ctrl+1", false)).toBe(
      false
    );
  });

  it("tells ⌃ from ⌘ on a Mac only", () => {
    expect(sameChord("ctrl+k", "mod+k", true)).toBe(false);
    expect(sameChord("ctrl+k", "mod+k", false)).toBe(true);
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
