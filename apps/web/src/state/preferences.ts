/**
 * The person's own preferences for how the editor looks and behaves, in every project: kept in
 * the browser, as the theme and the send key are, and drawn on the document's root as data
 * attributes the stylesheet reads. They colour and size the editor's chrome only; the designs on
 * the canvas keep their own look.
 */
import { Notifications as NotificationsChoice } from "@ultrapaint/contracts/settings";
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { CHAT_GROUPINGS, type ChatGrouping } from "../lib/chat-groups.ts";

/** The editor's accent: what is acted on, a checked control, the focus ring (DESIGN.md). */
export type Accent = "ultramarine" | "teal" | "green" | "orange" | "graphite";
export type TextSize = "small" | "default" | "large";
export type Motion = "system" | "reduced" | "full";
/** How an agent's work is marked on the canvas: a light passing through it, or a still outline. */
export type AgentsAtWork = "animated" | "calm";
/** What a plain mouse wheel does over the canvas; pinch and ⌘/Ctrl+wheel always zoom. */
export type ScrollWheel = "pan" | "zoom";
/** How the editor tells of an agent that finished or asks, while the window is away. */
export type Notifications = typeof NotificationsChoice.Type;

export interface Preferences {
  accent: Accent;
  agentsAtWork: AgentsAtWork;
  /** How the chat list groups its chats (ADR 0141): by state, as T3 Code does, by default. */
  chatGrouping: ChatGrouping;
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
  agentsAtWork: "animated",
  chatGrouping: "state",
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
  agentsAtWork: ["animated", "calm"],
  chatGrouping: CHAT_GROUPINGS.map((g) => g.value),
  contrast: [false, true],
  everyStep: [false, true],
  motion: ["system", "reduced", "full"],
  notifications: NotificationsChoice.literals,
  scrollWheel: ["pan", "zoom"],
  textSize: ["small", "default", "large"],
};

/** Preferences from what was kept (the browser's or the profile's), each value checked against its choices: anything else is the default. */
export const preferencesOf = (value: unknown): Preferences => {
  const parsed: Record<string, unknown> =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const out = { ...DEFAULT_PREFERENCES };
  for (const key of Object.keys(CHOICES) as (keyof Preferences)[]) {
    const kept = parsed[key];
    if ((CHOICES[key] as readonly unknown[]).includes(kept)) {
      (out as Record<string, unknown>)[key] = kept;
    }
  }
  return out;
};

/** What the browser kept, as text: unreadable, the defaults. */
export const readPreferences = (raw: string | null): Preferences => {
  try {
    return preferencesOf(JSON.parse(raw ?? "{}"));
  } catch {
    // A value another version wrote, or nothing: the defaults stand.
    return { ...DEFAULT_PREFERENCES };
  }
};

const stored = (): Preferences => {
  try {
    return readPreferences(localStorage.getItem(KEY));
  } catch {
    // Storage the browser refuses (a private window): the defaults, for this visit.
    return { ...DEFAULT_PREFERENCES };
  }
};

/**
 * Draws the preferences on the root, where the stylesheet reads them. Agents at work is not drawn:
 * the canvas's overlays read it (`useAgentSweeps`).
 */
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
  /** Takes every preference at once: the profile's, as the editor starts. */
  setAll: (preferences: Preferences) => void;
}

const valuesOf = (s: PreferencesStore): Preferences => ({
  accent: s.accent,
  agentsAtWork: s.agentsAtWork,
  chatGrouping: s.chatGrouping,
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
    setAll: keep,
  };
});

/** The preferences now, as they are kept. */
export const preferencesNow = () => valuesOf(usePreferences.getState());

/** Draws the kept preferences as the editor starts. */
export const followPreferences = () =>
  applyPreferences(valuesOf(usePreferences.getState()));

const REDUCE = "(prefers-reduced-motion: reduce)";

/** Whether the computer asks for reduced motion; no answer where there is no media query. */
const systemReduces = () =>
  typeof matchMedia !== "undefined" && matchMedia(REDUCE).matches;

/** Hears the computer's setting change. */
const followSystemMotion = (listener: () => void) => {
  if (typeof matchMedia === "undefined") {
    return () => undefined;
  }
  const query = matchMedia(REDUCE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

/** Whether motion is reduced under this choice: by the person's, or by the computer's under System. */
const reducedUnder = (motion: Motion, systemReducesMotion: boolean) =>
  motion === "system" ? systemReducesMotion : motion === "reduced";

/** Whether motion is reduced now: by the person's choice, or by the system's under System. */
export const motionReduced = () =>
  reducedUnder(usePreferences.getState().motion, systemReduces());

/**
 * Whether an agent's work is drawn with a light passing through it: under Animated, with motion
 * not reduced. Otherwise it is a still outline, never a gradient stopped in place.
 */
export const agentSweeps = (
  p: Pick<Preferences, "agentsAtWork" | "motion">,
  systemReducesMotion: boolean
) =>
  p.agentsAtWork === "animated" && !reducedUnder(p.motion, systemReducesMotion);

/** `agentSweeps` now, redrawn when the person's choices or the computer's setting change. */
export const useAgentSweeps = () => {
  const system = useSyncExternalStore(followSystemMotion, systemReduces);
  return usePreferences((s) => agentSweeps(s, system));
};
