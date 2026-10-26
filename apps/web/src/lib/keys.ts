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
 * The modifier that jumps to a workspace with 1–2: Control on a Mac, where ⌘ is the browser's
 * for its tabs, and Alt elsewhere, where Ctrl+1–2 are the browser's tabs and never reach the page.
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

const WORKSPACE_KEY_RE = /^⌃([1-9])$/;

/**
 * A shortcut written the Mac way, as this platform writes it; the workspace keys (`⌃1`) with
 * the platform's own workspace modifier.
 */
export const keysLabel = (mac: string): string => {
  const match: RegExpExecArray | null = WORKSPACE_KEY_RE.exec(mac);
  return match ? workspaceKeyLabel(Number(match[1])) : shortcutLabel(mac);
};

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
