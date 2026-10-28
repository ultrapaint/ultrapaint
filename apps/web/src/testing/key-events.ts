import { type KeyPress, parseChord } from "../lib/keys.ts";

/** What Shift types on the digits of a US keyboard, by digit. */
const SHIFTED_DIGITS = ")!@#$%^&*(";

/** Where a US keyboard has a symbol; `+` alone is the keypad's. */
const SYMBOL_CODES: Readonly<Record<string, string>> = {
  "-": "Minus",
  "?": "Slash",
  "'": "Quote",
  "\\": "Backslash",
  "+": "NumpadAdd",
  "=": "Equal",
};

const LETTER_RE = /^[a-z]$/;
const DIGIT_RE = /^[0-9]$/;

/**
 * The key event a chord is pressed as on a US keyboard, on a Mac or elsewhere: `mod` is ⌘ on a
 * Mac and Ctrl elsewhere, and Shift types its character (`shift+1` is `!`).
 */
export const keyEventOf = (text: string, mac: boolean): KeyPress => {
  const chord = parseChord(text);
  const { key } = chord;
  const pressed = (() => {
    if (LETTER_RE.test(key)) {
      return {
        code: `Key${key.toUpperCase()}`,
        key: chord.shift ? key.toUpperCase() : key,
      };
    }
    if (DIGIT_RE.test(key)) {
      return {
        code: `Digit${key}`,
        key: chord.shift ? (SHIFTED_DIGITS[Number(key)] ?? key) : key,
      };
    }
    const code = SYMBOL_CODES[key] ?? (key === " " ? "Space" : key);
    return { code, key };
  })();
  return {
    altKey: chord.alt,
    ctrlKey: chord.ctrl || (chord.mod && !mac),
    metaKey: chord.mod && mac,
    shiftKey: chord.shift,
    ...pressed,
  };
};
