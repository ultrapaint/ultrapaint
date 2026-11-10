/**
 * A design system's themes (ADR 0028, 0040): which there are, the default one its plain values
 * are in, a token's value in a theme, the word a theme is put on an element by and the selector
 * its values apply under, and whether a theme is a dark one. Every package asks here rather than
 * reading `themes` itself, so the default, the fallback to it and the selector are one rule
 * wherever a value is shown, drawn or edited.
 */
import type { DesignSystem } from "./design-system.ts";
import { tokenOf } from "./token-table.ts";
import { resolveVars } from "./token-value.ts";

/** The theme a design system that names none has its values in. */
const LIGHT = "light";

/** The themes a design system gives its values in, the default first: `light` when it names none. */
export const themesOf = (ds: DesignSystem): readonly string[] =>
  ds.themes && ds.themes.length > 0 ? ds.themes : [LIGHT];

/** The theme a design system's plain values are in: its first. */
export const defaultTheme = (ds: DesignSystem): string =>
  ds.themes?.[0] ?? LIGHT;

/** A value that names another token as a page does, `$color-blue-600`, as the variable it is. */
const asVar = (value: string) =>
  value.startsWith("$") ? `var(--${value.slice(1)})` : value;

/**
 * A token's value in a theme, the default theme's where it has none of its own; undefined for a
 * token the design system does not have. With `follow`, a value that is another token
 * (`var(--color-blue-600)`, `$color-blue-600`) is followed to that one's in the same theme, as
 * deep as it goes and never round a cycle (`resolveVars`).
 */
export const valueInTheme = (
  ds: DesignSystem,
  name: string,
  theme: string,
  options: { readonly follow?: boolean } = {}
): string | undefined => {
  const first = defaultTheme(ds);
  const own = (n: string) => {
    const token = tokenOf(ds, n);
    if (!token) {
      return;
    }
    return theme === first
      ? token.value
      : (token.values?.[theme] ?? token.value);
  };
  const value = own(name);
  if (value === undefined || !options.follow) {
    return value;
  }
  return resolveVars(`var(--${name})`, (variable) => {
    const found = own(variable.slice(2));
    return found === undefined ? undefined : asVar(found.trim());
  });
};

const THEME_NAME_RE = /[^\w-]/g;

/**
 * The one word a theme goes by where it is put on an element, as its class and its `data-theme`:
 * its name, less what a class cannot hold. `dark` is `dark`, and `dark mode` is `darkmode`, a
 * theme of its own that the `dark` one's values do not reach.
 */
export const themeWord = (theme: string): string =>
  theme.replace(THEME_NAME_RE, "");

/** What a theme's values apply under: its class (`.dark`, Tailwind's) and its `data-theme`. */
export const themeSelector = (theme: string): string => {
  const name = themeWord(theme);
  return `.${name}, [data-theme~="${name}"]`;
};

/** Whether a theme is a dark one, by its name: what a ramp's order and a board's greys follow. */
export const isDarkTheme = (theme: string): boolean =>
  theme.toLowerCase().includes("dark");
