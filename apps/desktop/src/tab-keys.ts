/**
 * The keys that show a tab (ADR 0107): ⌘1–⌘9 on a Mac, Ctrl+1–9 elsewhere, wherever the focus is
 * in the window, the main process reading them before any page does.
 */

/** A key as Electron's `before-input-event` gives it. */
export interface KeyInput {
  readonly alt: boolean;
  readonly control: boolean;
  readonly key: string;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly type: string;
}

const DIGIT_RE = /^[1-9]$/;

/** Which tab a key shows, 1 to 9 (`OpenProjects.showAt`); null for any other key. */
export const tabKey = (input: KeyInput, mac: boolean): number | null => {
  const mod = mac ? input.meta && !input.control : input.control && !input.meta;
  if (
    input.type !== "keyDown" ||
    !mod ||
    input.alt ||
    input.shift ||
    !DIGIT_RE.test(input.key)
  ) {
    return null;
  }
  return Number(input.key);
};
