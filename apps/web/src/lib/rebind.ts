/**
 * Changing a command's keys (ADR 0090): what Settings › Shortcuts lists, the chords it refuses
 * and why, and what a change saves. The keys themselves are kept by `state/keybindings.ts`; the
 * defaults are the command list's (`commands.ts`).
 *
 * A chord is refused when another command whose keys are reached together with this one's
 * already has it (the window's scopes are reached together; what has the focus, a row of the
 * Layers panel, is reached alone and goes first), when the browser or the system keeps it, or
 * when the command works in a text field and the chord would type there.
 */
import { type Overrides, useKeybindings } from "../state/keybindings.ts";
import {
  type Binding,
  bindings,
  type CommandGroup,
  chordsNow,
  commandGroups,
  focusBindings,
  keysNow,
} from "./commands.ts";
import {
  chordLabel,
  chordText,
  isMac,
  type Keys,
  parseChord,
  sameChord,
} from "./keys.ts";

/** A command as Settings › Shortcuts lists it. */
export interface ShortcutRow {
  binding: Binding;
  /** Its keys are not its default ones. */
  changed: boolean;
  /** Its keys cannot be changed: the browser's clipboard, or keys it reads (the arrows). */
  fixed: boolean;
  /** Its keys now. */
  keys: readonly Keys[];
}

const isFixed = (b: Binding) => b.fixed === true || b.clipboard !== undefined;

const rowOf = (binding: Binding, overrides: Overrides): ShortcutRow => ({
  binding,
  changed: overrides[binding.id] !== undefined,
  fixed: isFixed(binding),
  keys: keysNow(binding),
});

/** Every command that has keys or may be given some, in the palette's groups. */
export const shortcutRows = (): ShortcutRow[] => {
  const { overrides } = useKeybindings.getState();
  const all = bindings().map((b) => rowOf(b, overrides));
  return commandGroups.flatMap((g) => all.filter((r) => r.binding.group === g));
};

/** The rows of each group that has any, in the palette's order. */
export const rowsByGroup = (
  rows: readonly ShortcutRow[]
): { group: CommandGroup; rows: ShortcutRow[] }[] =>
  commandGroups.flatMap((group) => {
    const of = rows.filter((r) => r.binding.group === group);
    return of.length > 0 ? [{ group, rows: of }] : [];
  });

const SPACES_RE = /\s+/;

/** A row's chords as this platform shows them (`⌘Z`) and as the list writes them (`mod+z`). */
const spellings = (r: ShortcutRow, mac: boolean) =>
  r.keys.flatMap((k) => {
    const text = chordText(k, mac);
    return [chordLabel(text, mac).toLowerCase(), text.toLowerCase()];
  });

/**
 * The rows a query finds: every word of it in the command's name or its keys, written as this
 * platform shows them (`⌘Z`, `Ctrl+Z`) or as the list writes them (`mod+z`). The rows whose
 * keys are what was typed come first: `⌘Z` is Undo's before it is a part of Redo's `⇧⌘Z`.
 */
export const searchShortcuts = (
  rows: readonly ShortcutRow[],
  query: string,
  mac = isMac
): ShortcutRow[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...rows];
  }
  const words = q.split(SPACES_RE);
  const found = rows.filter((r) => {
    const hay =
      `${r.binding.title} ${spellings(r, mac).join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const exact = (r: ShortcutRow) => spellings(r, mac).includes(q);
  return [...found.filter(exact), ...found.filter((r) => !exact(r))];
};

/** The window's scopes are reached together; a focus scope alone. */
const reachOf = (b: Binding) => (b.scope in focusBindings ? b.scope : "window");

/** Kept by the browser or the system: closing, quitting, a new tab or window, the address, reload. */
const RESERVED: readonly { chord: string; by: "browser" | "system" }[] = [
  { by: "browser", chord: "mod+w" },
  { by: "system", chord: "mod+q" },
  { by: "browser", chord: "mod+t" },
  { by: "browser", chord: "mod+n" },
  { by: "browser", chord: "mod+l" },
  { by: "browser", chord: "mod+r" },
];

const F_KEY_RE = /^F([1-9]|1[0-2])$/;

/** Why a chord was not given to a command. */
export type Refusal =
  | {
      /** The other command whose keys it is. */
      by: Binding;
      chord: string;
      kind: "taken";
    }
  | { by: "browser" | "system"; chord: string; kind: "reserved" }
  | { chord: string; kind: "typing" };

/** The other commands reached with this one that a chord is a key of now. */
const ownersOf = (binding: Binding, chord: string, mac: boolean) =>
  bindings().filter(
    (b) =>
      b.id !== binding.id &&
      reachOf(b) === reachOf(binding) &&
      chordsNow(b).some((k) => sameChord(k, chord, mac))
  );

/** Why a chord can't be this command's key, or null when it can. */
export const refusalOf = (
  binding: Binding,
  chord: string,
  mac = isMac
): Refusal | null => {
  const reserved = RESERVED.find((r) => sameChord(r.chord, chord, mac));
  if (reserved) {
    return { by: reserved.by, chord, kind: "reserved" };
  }
  const { alt, ctrl, key, mod } = parseChord(chord);
  // A key that works in a text field and types there would no longer type.
  if (
    binding.scope === "always" &&
    !(alt || ctrl || mod || F_KEY_RE.test(key))
  ) {
    return { chord, kind: "typing" };
  }
  const [owner] = ownersOf(binding, chord, mac);
  return owner ? { by: owner, chord, kind: "taken" } : null;
};

/** Whether the other command's keys can be taken from it: not a fixed one's. */
export const canTake = (refusal: Refusal) =>
  refusal.kind === "taken" && !isFixed(refusal.by);

/** The refusal as the row says it. */
export const refusalText = (refusal: Refusal, mac = isMac): string => {
  const label = chordLabel(refusal.chord, mac);
  if (refusal.kind === "taken") {
    return `${label} is ${refusal.by.title}’s shortcut.`;
  }
  if (refusal.kind === "reserved") {
    return `${label} is the ${refusal.by}’s shortcut.`;
  }
  return mac
    ? "Add ⌘, ⌃ or ⌥: this shortcut works while you type."
    : "Add Ctrl or Alt: this shortcut works while you type.";
};

const sameKeys = (a: readonly Keys[], b: readonly Keys[], mac: boolean) =>
  a.length === b.length && a.every((k, i) => sameChord(k, b[i] ?? "", mac));

/** Saves a command's keys: none kept when they are its default ones. */
const save = (binding: Binding, keys: readonly Keys[], mac: boolean) => {
  const store = useKeybindings.getState();
  if (!binding.also && sameKeys(keys, binding.keys ?? [], mac)) {
    store.reset(binding.id);
  } else {
    store.set(binding.id, keys);
  }
};

/** Gives a command this chord as its one key, unless it is refused, and says why then. */
export const recordKeys = (
  binding: Binding,
  chord: string,
  mac = isMac
): Refusal | null => {
  const refusal = refusalOf(binding, chord, mac);
  if (!refusal) {
    save(binding, [chord], mac);
  }
  return refusal;
};

/** Gives a command a chord another one has, which that one loses. */
export const takeKeys = (binding: Binding, chord: string, mac = isMac) => {
  for (const owner of ownersOf(binding, chord, mac)) {
    save(
      owner,
      keysNow(owner).filter((k) => !sameChord(k, chord, mac)),
      mac
    );
  }
  save(binding, [chord], mac);
};

/** Takes every key away from a command. */
export const removeKeys = (binding: Binding, mac = isMac) => {
  save(binding, [], mac);
};

/**
 * Puts a command's default keys back, unless another command has one of them now: the person
 * gave it that one, and is told so as when they record it.
 */
export const resetKeys = (binding: Binding, mac = isMac): Refusal | null => {
  for (const chord of [...(binding.keys ?? []), ...(binding.also ?? [])]) {
    const text = chordText(chord, mac);
    const [owner] = ownersOf(binding, text, mac);
    if (owner) {
      return { by: owner, chord: text, kind: "taken" };
    }
  }
  useKeybindings.getState().reset(binding.id);
  return null;
};
