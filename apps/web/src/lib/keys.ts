/**
 * Keys as the editor writes them and hears them. A chord is written once, in words
 * (`mod+shift+z`, `shift+1`, `?`, `f2`), and the same text is shown the way the platform writes
 * it (`⇧⌘Z` on a Mac, `Ctrl+Shift+Z` elsewhere) and matched against a key pressed.
 *
 * - `mod` is ⌘ on a Mac and Ctrl elsewhere, as it is shown; either is taken for it when pressed,
 *   as the editor always did. `ctrl` is ⌃ itself, `alt` is ⌥, `shift` is ⇧.
 * - A letter is matched by what it types, so a layout's own letters keep their place; with Alt,
 *   which types another character on a Mac, by where it sits too.
 * - A digit is matched by where it sits (`Digit1`): Shift or Alt types another character there
 *   (`⇧1` is `!` on one layout and `1` on another).
 * - A symbol (`?`, `=`, `-`, `'`, `\`, `plus`) is matched by what it types, whatever Shift did to
 *   type it: `?` takes Shift on most layouts. `'` and `\` are matched by where they sit too,
 *   with Shift as written, for a layout that types something else there.
 * - Named keys: `enter`, `escape`, `backspace`, `delete`, `space`, `tab`, `home`, `end`, the four
 *   `arrow…`, `contextmenu`, `f1`–`f12`.
 * - Every modifier the chord does not name must be up: `c` is not `⇧C`.
 *
 * A chord that differs by platform is written once for each (`{ mac: "ctrl+1", other: "alt+1" }`):
 * on a Mac ⌘1 is the browser's, elsewhere Ctrl+1 never reaches the page.
 */

const MAC_RE = /Mac|iPhone|iPad|iPod/;

export const isMac =
  typeof navigator !== "undefined" &&
  MAC_RE.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent
  );

/** A key and the modifiers held with it. */
export interface Chord {
  alt: boolean;
  /** ⌃ itself, which only a Mac tells from `mod`. */
  ctrl: boolean;
  /**
   * The key: a lower-case letter, a digit, a symbol as it is typed (`?`, `+`), or the
   * `KeyboardEvent.key` of a named key (`Enter`, `F2`, `ArrowUp`).
   */
  key: string;
  /** ⌘ on a Mac, Ctrl elsewhere. */
  mod: boolean;
  shift: boolean;
}

/** A chord as written, or one for each platform. */
export type Keys = string | { readonly mac: string; readonly other: string };

/** The named keys: what the event calls them, and how each platform writes them. */
const NAMED: Readonly<
  Record<string, { key: string; mac: string; other: string }>
> = {
  arrowdown: { key: "ArrowDown", mac: "↓", other: "↓" },
  arrowleft: { key: "ArrowLeft", mac: "←", other: "←" },
  arrowright: { key: "ArrowRight", mac: "→", other: "→" },
  arrowup: { key: "ArrowUp", mac: "↑", other: "↑" },
  backspace: { key: "Backspace", mac: "⌫", other: "Backspace" },
  contextmenu: { key: "ContextMenu", mac: "Menu", other: "Menu" },
  delete: { key: "Delete", mac: "⌦", other: "Delete" },
  end: { key: "End", mac: "End", other: "End" },
  enter: { key: "Enter", mac: "↩", other: "Enter" },
  escape: { key: "Escape", mac: "Esc", other: "Esc" },
  home: { key: "Home", mac: "Home", other: "Home" },
  space: { key: " ", mac: "Space", other: "Space" },
  tab: { key: "Tab", mac: "⇥", other: "Tab" },
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => {
      const name = `F${i + 1}`;
      return [name.toLowerCase(), { key: name, mac: name, other: name }];
    })
  ),
};

/** `+` separates a chord's parts, so the key is written `plus`. */
const SYMBOL_NAMES: Readonly<Record<string, string>> = { plus: "+" };

/** Symbols also matched by where they sit, for a layout that types something else there. */
const SYMBOL_CODES: Readonly<Record<string, string>> = {
  "'": "Quote",
  "\\": "Backslash",
};

const LETTER_RE = /^[a-z]$/;
const DIGIT_RE = /^[0-9]$/;
const SYMBOL_RE = /^[^\sa-zA-Z0-9+]$/;

const keyOf = (name: string, text: string): string => {
  const named = NAMED[name];
  if (named) {
    return named.key;
  }
  const symbol = SYMBOL_NAMES[name];
  if (symbol) {
    return symbol;
  }
  if (LETTER_RE.test(name) || DIGIT_RE.test(name) || SYMBOL_RE.test(name)) {
    return name;
  }
  throw new Error(`No key "${name}" in the chord "${text}"`);
};

/** A chord as written (`mod+shift+z`); an unknown key or modifier is a mistake in the list. */
export const parseChord = (text: string): Chord => {
  const parts = text.toLowerCase().split("+");
  const name = parts.pop() ?? "";
  const chord: Chord = {
    alt: false,
    ctrl: false,
    key: keyOf(name, text),
    mod: false,
    shift: false,
  };
  for (const part of parts) {
    if (
      part !== "alt" &&
      part !== "ctrl" &&
      part !== "mod" &&
      part !== "shift"
    ) {
      throw new Error(`No modifier "${part}" in the chord "${text}"`);
    }
    chord[part] = true;
  }
  return chord;
};

/** The chord this platform presses. */
export const chordText = (keys: Keys, mac = isMac): string =>
  typeof keys === "string" ? keys : keys[mac ? "mac" : "other"];

const NAMED_BY_KEY = new Map(Object.values(NAMED).map((n) => [n.key, n]));

/** A chord as the platform writes it: `⇧⌘Z` on a Mac, `Ctrl+Shift+Z` elsewhere. */
export const chordLabel = (text: string, mac = isMac): string => {
  const chord = parseChord(text);
  const named = NAMED_BY_KEY.get(chord.key);
  const key = named ? named[mac ? "mac" : "other"] : chord.key.toUpperCase();
  if (mac) {
    // Apple's order: ⌃ ⌥ ⇧ ⌘.
    return `${chord.ctrl ? "⌃" : ""}${chord.alt ? "⌥" : ""}${chord.shift ? "⇧" : ""}${chord.mod ? "⌘" : ""}${key}`;
  }
  return [
    chord.ctrl || chord.mod ? "Ctrl" : "",
    chord.alt ? "Alt" : "",
    chord.shift ? "Shift" : "",
    key,
  ]
    .filter(Boolean)
    .join("+");
};

/** Chords as the platform writes them, side by side: `↑ ↓`. */
export const keysLabel = (keys: readonly Keys[], mac = isMac): string =>
  keys.map((k) => chordLabel(chordText(k, mac), mac)).join(" ");

/** The part of a key event a chord is matched against. */
export type KeyPress = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

/** ⌘ or Ctrl for `mod`, ⌃ alone for `ctrl`, neither for a chord without them. */
const holdsMod = (chord: Chord, e: KeyPress) => {
  if (chord.mod) {
    return e.metaKey || e.ctrlKey;
  }
  if (chord.ctrl) {
    return e.ctrlKey && !e.metaKey;
  }
  return !(e.metaKey || e.ctrlKey);
};

/** Whether the key is the chord's, and Shift is as the chord says or what typed a symbol. */
const isKey = (chord: Chord, e: KeyPress) => {
  const { key } = chord;
  const shift = e.shiftKey === chord.shift;
  if (LETTER_RE.test(key)) {
    const placed = e.altKey && e.code === `Key${key.toUpperCase()}`;
    return shift && (e.key.toLowerCase() === key || placed);
  }
  if (DIGIT_RE.test(key)) {
    return shift && e.code === `Digit${key}`;
  }
  if (NAMED_BY_KEY.has(key)) {
    return shift && e.key === key;
  }
  return e.key === key || (shift && SYMBOL_CODES[key] === e.code);
};

/** Whether a key pressed is the chord. */
export const matchesChord = (chord: Chord, e: KeyPress): boolean =>
  holdsMod(chord, e) && e.altKey === chord.alt && isKey(chord, e);

/**
 * Dialogs, menus and select popups are not page-blocking the way native confirm/prompt were, so
 * while one is open keys must not reach the canvas (Backspace would delete the selection behind
 * it). They are only mounted while open; focus can stay on the trigger, so the target is no guide.
 */
export const overlayOpen = () =>
  document.querySelector(
    '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'
  ) !== null;

/**
 * The event comes from inside a frame of the canvas, drawn in the editor's page (ADR 0034): a
 * page in the prototype, a text being edited in place. It is the page's, as it was when a frame
 * was an iframe whose events never reached the editor.
 */
export const fromFrame = (e: Event) =>
  e
    .composedPath?.()
    .some(
      (node) =>
        node instanceof Element && node.hasAttribute("data-ed-frame-host")
    ) ?? false;

/** The event is aimed at a field that takes keys of its own: text, a select, an editable node. */
export const isTyping = (e: Event) => {
  if (fromFrame(e)) {
    return true;
  }
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable)
  );
};
