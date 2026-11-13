/**
 * The person's own shortcuts: for a command, the keys they gave it in place of its default, or
 * none when they took its keys away (ADR 0090). A preference of the person rather than of the
 * project, kept in the browser as the theme and the send key are. The rules of a change (what
 * is refused, what is taken from another command) are `lib/rebind.ts`'s; this only keeps them.
 */
import { create } from "zustand";
import { type Keys, parseChord } from "../lib/keys.ts";

const KEY = "ultrapaint:keybindings";

/** A command's id and the chords that are its keys now; an empty list for none. */
export type Overrides = Readonly<Record<string, readonly Keys[]>>;

/** A chord as the list writes it, one that `parseChord` reads. */
const isChord = (value: unknown): value is string => {
  if (typeof value !== "string") {
    return false;
  }
  try {
    parseChord(value);
    return true;
  } catch {
    // A chord saved by another version of the editor that this one cannot read: dropped.
    return false;
  }
};

const isKeys = (value: unknown): value is Keys =>
  isChord(value) ||
  (typeof value === "object" &&
    value !== null &&
    isChord((value as { mac?: unknown }).mac) &&
    isChord((value as { other?: unknown }).other));

/** What was saved, each command's keys read on their own: one that cannot be read is dropped. */
/** The person's keys from what was kept (the browser's or the profile's): what can't be read, dropped. */
export const overridesOf = (value: unknown): Overrides => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Keys[]] =>
        Array.isArray(entry[1]) && entry[1].every(isKeys)
    )
  );
};

const saved = (): Overrides => {
  try {
    return overridesOf(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    // Not JSON, or storage the browser refuses: nothing is kept.
    return {};
  }
};

interface KeybindingsStore {
  overrides: Overrides;
  /** Puts back the default keys of a command. */
  reset: (id: string) => void;
  /** Puts back every command's default keys. */
  resetAll: () => void;
  /** Gives a command these keys in place of its own; an empty list takes them away. */
  set: (id: string, keys: readonly Keys[]) => void;
  /** Keeps exactly these: Reset all's Undo. */
  setAll: (overrides: Overrides) => void;
}

const keep = (overrides: Overrides) => {
  try {
    if (Object.keys(overrides).length === 0) {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, JSON.stringify(overrides));
    }
  } catch {
    // Storage the browser refuses (a private window): kept for this visit, and in the profile.
  }
  return { overrides };
};

export const useKeybindings = create<KeybindingsStore>((set, get) => ({
  overrides: saved(),
  reset: (id) => {
    set(
      keep(
        Object.fromEntries(
          Object.entries(get().overrides).filter(([other]) => other !== id)
        )
      )
    );
  },
  resetAll: () => set(keep({})),
  set: (id, keys) => set(keep({ ...get().overrides, [id]: keys })),
  setAll: (overrides) => set(keep(overrides)),
}));

/** The keys a command was given in place of its own, or undefined when it keeps its own. */
export const overrideOf = (id: string): readonly Keys[] | undefined =>
  useKeybindings.getState().overrides[id];
