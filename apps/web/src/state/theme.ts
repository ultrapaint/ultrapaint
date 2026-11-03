/**
 * The editor's own theme: light, dark, or the system's. A preference of the person rather than of
 * the project, kept in the browser as the grid's is. It colours the editor's chrome only; the
 * designs on the canvas keep the themes of their own design system.
 */
import { create } from "zustand";

export type ThemePreference = "system" | "light" | "dark";

const KEY = "ultrapaint:theme";

const saved = (): ThemePreference => {
  const value = localStorage.getItem(KEY);
  return value === "light" || value === "dark" ? value : "system";
};

const systemDark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

const resolve = (preference: ThemePreference): "light" | "dark" => {
  if (preference === "system") {
    return systemDark() ? "dark" : "light";
  }
  return preference;
};

interface ThemeStore {
  preference: ThemePreference;
  /** The theme drawn now, the system's answered. */
  resolved: "light" | "dark";
  set: (preference: ThemePreference) => void;
}

const apply = (resolved: "light" | "dark") => {
  document.documentElement.classList.toggle("dark", resolved === "dark");
};

export const useTheme = create<ThemeStore>((set) => ({
  preference: saved(),
  resolved: resolve(saved()),
  set: (preference) => {
    localStorage.setItem(KEY, preference);
    const resolved = resolve(preference);
    apply(resolved);
    set({ preference, resolved });
  },
}));

/** Draws the theme now, and follows the system's while the preference is the system's. */
export const followTheme = () => {
  apply(useTheme.getState().resolved);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const { preference } = useTheme.getState();
    if (preference === "system") {
      const resolved = resolve(preference);
      apply(resolved);
      useTheme.setState({ resolved });
    }
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
