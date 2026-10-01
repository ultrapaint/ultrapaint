/**
 * Keys as this platform names them. Shortcuts are written once, the Mac way (`⇧⌘Z`), and shown
 * as the platform writes them: the same on a Mac, `Ctrl+Shift+Z` elsewhere, where ⌘ is Ctrl.
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

/** The modifiers a Mac shortcut is written with, in the order other platforms write them. */
const MODIFIERS: readonly (readonly [symbol: string, name: string])[] = [
  ["⌃", "Ctrl"],
  ["⌘", "Ctrl"],
  ["⌥", "Alt"],
  ["⇧", "Shift"],
];

const KEYS: Readonly<Record<string, string>> = {
  "↩": "Enter",
  "⌫": "Backspace",
  "⏎": "Enter",
};

/** A shortcut written the Mac way, as the platform writes it. */
export const shortcutLabel = (mac: string, onMac = isMac): string => {
  if (onMac) {
    return mac;
  }
  let rest = mac;
  const names: string[] = [];
  for (const [symbol, name] of MODIFIERS) {
    if (rest.includes(symbol)) {
      rest = rest.replaceAll(symbol, "");
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  const key = KEYS[rest] ?? rest;
  return [...names, key].filter(Boolean).join("+");
};

/**
 * The modifier that jumps to a workspace with 1–3: Control on a Mac, where ⌘ is the browser's
 * for its tabs, and Alt elsewhere, where Ctrl+1–3 are the browser's tabs and never reach the page.
 */
export const workspaceModifier = isMac ? "Control" : "Alt";

/** Whether an event holds the workspace modifier alone. */
export const holdsWorkspaceModifier = (e: KeyboardEvent) =>
  isMac
    ? e.ctrlKey && !(e.metaKey || e.altKey || e.shiftKey)
    : e.altKey && !(e.metaKey || e.ctrlKey || e.shiftKey);

/** How the switcher writes the key of a workspace. */
export const workspaceKeyLabel = (digit: number) =>
  shortcutLabel(`${isMac ? "⌃" : "⌥"}${digit}`);
