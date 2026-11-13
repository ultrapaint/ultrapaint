/**
 * The person's preferences kept in their profile (ADR 0093): the theme, the send key, the grid
 * and the comments shown, Appearance's preferences and the shortcuts they changed. The browser
 * keeps each too, so the editor draws them before the server answers; but in the desktop app each
 * project's editor is a page of its own (another port, another browser storage), so the profile,
 * in the person's folder, is what carries them from one project to the next.
 *
 * As the editor starts, what the profile holds is taken into the stores, except what the person
 * changed meanwhile; after that, each change is saved to the profile, a moment later.
 */

import type { UserProfile } from "@ultrapaint/contracts/settings";
import { useCanvasGrid } from "./canvas-grid.ts";
import { useComments } from "./comments.ts";
import { api } from "./connection.ts";
import { overridesOf, useKeybindings } from "./keybindings.ts";
import {
  preferencesNow,
  preferencesOf,
  usePreferences,
} from "./preferences.ts";
import { reportError } from "./project.ts";
import { type SendKey, useSendKey } from "./send-key.ts";
import { follow } from "./server-data.ts";
import { type ThemePreference, useTheme } from "./theme.ts";

/** One preference: what it is now, how a kept value is taken in, and when it changes. */
interface Kept {
  readonly current: () => unknown;
  readonly subscribe: (listener: () => void) => () => void;
  /** Takes a value from the profile, checked as the store checks its own. */
  readonly take: (value: unknown) => void;
}

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];
const SEND_KEYS: readonly SendKey[] = ["enter", "modEnter"];

/** Subscribes to one part of a store: the listener hears only when that part changes. */
const watching =
  <S, T>(
    store: {
      getState: () => S;
      subscribe: (l: (s: S, p: S) => void) => () => void;
    },
    pick: (s: S) => T
  ) =>
  (listener: () => void) =>
    store.subscribe((s, p) => {
      if (pick(s) !== pick(p)) {
        listener();
      }
    });

/** The preferences, by the names the profile keeps them under. */
export const KEPT: Readonly<Record<string, Kept>> = {
  appearance: {
    current: preferencesNow,
    // Any of Appearance's values changing is one change of the whole.
    subscribe: (listener) =>
      usePreferences.subscribe((s, p) => {
        if (
          (Object.keys(preferencesOf({})) as (keyof typeof s)[]).some(
            (key) => s[key] !== p[key]
          )
        ) {
          listener();
        }
      }),
    take: (value) => usePreferences.getState().setAll(preferencesOf(value)),
  },
  comments: {
    current: () => useComments.getState().visible,
    subscribe: watching(useComments, (s) => s.visible),
    take: (value) => {
      if (
        typeof value === "boolean" &&
        value !== useComments.getState().visible
      ) {
        useComments.getState().toggleVisible();
      }
    },
  },
  grid: {
    current: () => useCanvasGrid.getState().visible,
    subscribe: watching(useCanvasGrid, (s) => s.visible),
    take: (value) => {
      if (
        typeof value === "boolean" &&
        value !== useCanvasGrid.getState().visible
      ) {
        useCanvasGrid.getState().toggle();
      }
    },
  },
  keybindings: {
    current: () => useKeybindings.getState().overrides,
    subscribe: watching(useKeybindings, (s) => s.overrides),
    take: (value) => useKeybindings.getState().setAll(overridesOf(value)),
  },
  sendKey: {
    current: () => useSendKey.getState().sendKey,
    subscribe: watching(useSendKey, (s) => s.sendKey),
    take: (value) => {
      if (SEND_KEYS.includes(value as SendKey)) {
        useSendKey.getState().setSendKey(value as SendKey);
      }
    },
  },
  theme: {
    current: () => useTheme.getState().preference,
    subscribe: watching(useTheme, (s) => s.preference),
    take: (value) => {
      if (THEMES.includes(value as ThemePreference)) {
        useTheme.getState().set(value as ThemePreference);
      }
    },
  },
};

/** How long after a change the profile is written: a run of changes is one write. */
const SAVE_AFTER_MS = 400;

/**
 * Takes the profile's preferences into the stores, then saves the stores' changes to the profile
 * for the rest of the editor's life. Returns what stops it.
 */
export const followPersonPreferences = () => {
  /** Changed since the editor started: the profile's older value is not taken over it. */
  const changed = new Set<string>();
  let taking = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    const preferences = Object.fromEntries(
      [...changed].map((name) => [name, KEPT[name]?.current()])
    );
    api().request("profile.set", { preferences }).catch(reportError);
  };
  const stops = Object.entries(KEPT).map(([name, kept]) =>
    kept.subscribe(() => {
      if (taking) {
        return;
      }
      changed.add(name);
      clearTimeout(timer);
      timer = setTimeout(save, SAVE_AFTER_MS);
    })
  );
  const taken = follow({
    apply: (profile: UserProfile) => {
      taking = true;
      try {
        for (const [name, value] of Object.entries(profile.preferences ?? {})) {
          if (!changed.has(name)) {
            KEPT[name]?.take(value);
          }
        }
      } finally {
        taking = false;
      }
    },
    // Read once the server answers, and again at each reconnection: never before.
    atOpen: () => true,
    read: () => api().request("profile.get", undefined),
  });
  return () => {
    taken.stop();
    clearTimeout(timer);
    for (const stop of stops) {
      stop();
    }
  };
};
