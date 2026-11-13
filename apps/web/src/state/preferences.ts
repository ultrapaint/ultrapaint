/**
 * The person's own preferences for how the editor looks and behaves, in every project: kept in
 * the browser, as the theme and the send key are, and drawn on the document's root as data
 * attributes the stylesheet reads. They colour and size the editor's chrome only; the designs on
 * the canvas keep their own look.
 */
import { create } from "zustand";

/** The editor's accent: what is acted on, a checked control, the focus ring (DESIGN.md). */
export type Accent = "ultramarine" | "teal" | "green" | "orange" | "graphite";
export type TextSize = "small" | "default" | "large";
export type Motion = "system" | "reduced" | "full";
/** What a plain mouse wheel does over the canvas; pinch and ⌘/Ctrl+wheel always zoom. */
export type ScrollWheel = "pan" | "zoom";
/** How the editor tells of an agent that finished or asks, while the window is away. */
export type Notifications = "off" | "notification" | "sound" | "both";

export interface Preferences {
  accent: Accent;
  contrast: boolean;
  /**
   * A chat shows every step its agent takes, as the agent reports them, rather than each turn's
   * card with its steps folded (ADR 0095).
   */
  everyStep: boolean;
  motion: Motion;
  notifications: Notifications;
  scrollWheel: ScrollWheel;
  textSize: TextSize;
}

export const ACCENTS: readonly { label: string; value: Accent }[] = [
  { label: "Ultramarine", value: "ultramarine" },
  { label: "Teal", value: "teal" },
  { label: "Green", value: "green" },
  { label: "Orange", value: "orange" },
  { label: "Graphite", value: "graphite" },
];

export const DEFAULT_PREFERENCES: Preferences = {
  accent: "ultramarine",
  contrast: false,
  everyStep: false,
  motion: "system",
  notifications: "off",
  scrollWheel: "pan",
  textSize: "default",
};

const KEY = "ultrapaint:preferences";

const CHOICES: { [K in keyof Preferences]: readonly Preferences[K][] } = {
  accent: ACCENTS.map((a) => a.value),
  contrast: [false, true],
  everyStep: [false, true],
  motion: ["system", "reduced", "full"],
  notifications: ["off", "notification", "sound", "both"],
  scrollWheel: ["pan", "zoom"],
  textSize: ["small", "default", "large"],
};

/** What the browser kept, each value checked against its choices: anything else is the default. */
export const readPreferences = (raw: string | null): Preferences => {
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (value && typeof value === "object") {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    // A value another version wrote, or nothing: the defaults stand.
    parsed = {};
  }
  const out = { ...DEFAULT_PREFERENCES };
  for (const key of Object.keys(CHOICES) as (keyof Preferences)[]) {
    const value = parsed[key];
    if ((CHOICES[key] as readonly unknown[]).includes(value)) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
};

const stored = (): Preferences => {
  try {
    return readPreferences(localStorage.getItem(KEY));
  } catch {
    // Storage the browser refuses (a private window): the defaults, for this visit.
    return { ...DEFAULT_PREFERENCES };
  }
};

/** Draws the preferences on the root, where the stylesheet reads them. */
export const applyPreferences = (
  p: Preferences,
  root: HTMLElement = document.documentElement
) => {
  root.dataset.accent = p.accent;
  root.dataset.textSize = p.textSize;
  root.dataset.motion = p.motion;
  if (p.contrast) {
    root.dataset.contrast = "more";
  } else {
    delete root.dataset.contrast;
  }
};

interface PreferencesStore extends Preferences {
  /** Puts one back to its default. */
  reset: (key: keyof Preferences) => void;
  /** Changes one preference, kept at once. */
  set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
}

const valuesOf = (s: PreferencesStore): Preferences => ({
  accent: s.accent,
  contrast: s.contrast,
  everyStep: s.everyStep,
  motion: s.motion,
  notifications: s.notifications,
  scrollWheel: s.scrollWheel,
  textSize: s.textSize,
});

export const usePreferences = create<PreferencesStore>((set, get) => {
  const keep = (next: Preferences) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not kept past this visit; it still applies now.
    }
    applyPreferences(next);
    set(next);
  };
  return {
    ...stored(),
    reset: (key) =>
      keep({ ...valuesOf(get()), [key]: DEFAULT_PREFERENCES[key] }),
    set: (key, value) => keep({ ...valuesOf(get()), [key]: value }),
  };
});

/** Draws the kept preferences as the editor starts. */
export const followPreferences = () =>
  applyPreferences(valuesOf(usePreferences.getState()));

/** Whether motion is reduced now: by the person's choice, or by the system's under System. */
export const motionReduced = () => {
  const { motion } = usePreferences.getState();
  if (motion !== "system") {
    return motion === "reduced";
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};
