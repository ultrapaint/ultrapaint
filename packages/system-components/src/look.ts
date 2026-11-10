/**
 * The system components' default look (ADRs 0040, 0041), in a layer of its own so that the
 * project's looks (unlayered) and a node's own style win over it. What a part looks like is data:
 * each system component's default file (`defaults.ts`), drawn by `lookCss` over the design
 * system's tokens, each with a neutral value of its own for a design that does not set it. What a
 * file cannot say is written here, after it: layout and positioning, a dialog's sheet on a narrow
 * frame, animations and a focus outline. What a state does to a part, in every variant or in one
 * (a button's hover), is the files'.
 *
 * What a pointer does (`:hover`, Base UI's `data-highlighted`) shows only in a frame that runs:
 * a designed frame is inert and takes no pointer, and a state shows there only when the design
 * pins it (`data-ed-state`). Responsive parts answer the frame's width (`@container ed-frame`),
 * not the window's. A rule here that changes what a look sets is as specific as the look's rule,
 * which it follows.
 */

import {
  type ComponentFile,
  systemComponentsIn,
} from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { themeSelector } from "@ultrapaint/contracts/themes";
import { lookCss } from "@ultrapaint/design-document/component-look";
import { makeStyleContext } from "@ultrapaint/design-document/css";
import { designTokenCss } from "@ultrapaint/design-document/tokens";
import { looksOf, SYSTEM_DEFAULTS } from "./defaults.ts";

const t = (name: string) => `var(--${name})`;

const RING = t("color-ring");
const RADIUS_LG = t("radius-lg");

/**
 * The colours every design draws with until it says otherwise, in the light theme and the dark:
 * the neutral palette, which Design system's Color board draws for a project without a design
 * system (ADR 0045).
 */
export const NEUTRAL_COLORS: readonly {
  readonly dark: string;
  readonly light: string;
  readonly name: string;
}[] = [
  { dark: "#09090b", light: "#ffffff", name: "color-background" },
  { dark: "#fafafa", light: "#09090b", name: "color-foreground" },
  { dark: "#fafafa", light: "#18181b", name: "color-primary" },
  { dark: "#18181b", light: "#fafafa", name: "color-primary-foreground" },
  { dark: "#27272a", light: "#f4f4f5", name: "color-secondary" },
  { dark: "#fafafa", light: "#18181b", name: "color-secondary-foreground" },
  { dark: "#27272a", light: "#f4f4f5", name: "color-muted" },
  { dark: "#a1a1aa", light: "#71717a", name: "color-muted-foreground" },
  { dark: "#27272a", light: "#f4f4f5", name: "color-accent" },
  { dark: "#fafafa", light: "#18181b", name: "color-accent-foreground" },
  { dark: "#ef4444", light: "#dc2626", name: "color-destructive" },
  { dark: "#fafafa", light: "#ffffff", name: "color-destructive-foreground" },
  { dark: "#27272a", light: "#e4e4e7", name: "color-border" },
  { dark: "#3f3f46", light: "#e4e4e7", name: "color-input" },
  { dark: "#71717a", light: "#a1a1aa", name: "color-ring" },
  { dark: "#09090b", light: "#ffffff", name: "color-card" },
  { dark: "#fafafa", light: "#09090b", name: "color-card-foreground" },
  { dark: "#18181b", light: "#ffffff", name: "color-popover" },
  { dark: "#fafafa", light: "#09090b", name: "color-popover-foreground" },
];

/**
 * The shadows of the levels until the design says otherwise, which the looks name
 * (`$shadow-lg`, a popup's) and the default look lists (`default-look.ts`).
 */
export const NEUTRAL_SHADOWS: readonly {
  readonly name: string;
  readonly value: string;
}[] = [
  { name: "shadow-sm", value: "0 1px 2px 0 rgb(0 0 0 / 0.05)" },
  {
    name: "shadow-md",
    value: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  },
  {
    name: "shadow-lg",
    value: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  },
];

const neutralIn = (theme: "dark" | "light") =>
  NEUTRAL_COLORS.map((c) => `--${c.name}: ${c[theme]};`).join(" ");

/**
 * What every token the system components and a new canvas draw with is until the design says otherwise:
 * a neutral theme, so a project with no design system yet draws as one, on the frame's root
 * (`:host`). The design's own values (unlayered) win over these.
 */
const DEFAULT_TOKENS = `
  :host {
    ${neutralIn("light")}
    --radius-sm: 0.375rem; --radius-md: 0.5rem; --radius-lg: 0.75rem;
    ${NEUTRAL_SHADOWS.map((s) => `--${s.name}: ${s.value};`).join(" ")}
    --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-family: var(--font-sans); line-height: 1.5; color: var(--color-foreground);
    -webkit-font-smoothing: antialiased;
  }
  ${themeSelector("dark")} {
    ${neutralIn("dark")}
  }
`;

/** The default looks as rules: what each part looks like, over the tokens. */
const DEFAULT_LOOK = lookCss(looksOf(SYSTEM_DEFAULTS), makeStyleContext(null));

export const SYSTEM_COMPONENTS_CSS = `
@layer system-components {
${DEFAULT_TOKENS}
${DEFAULT_LOOK}
  [data-system] { box-sizing: border-box; font-family: inherit; }
  [data-system] *, [data-system-positioner] *, [data-system-dialog] * { box-sizing: border-box; }

  /* ---- Button ---- */
  [data-system="button"] {
    display: inline-flex; align-items: center; justify-content: center;
    line-height: 1; white-space: nowrap; cursor: pointer;
    transition: background-color 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
  }
  [data-system="button"][data-variant="link"] { text-decoration: underline; text-underline-offset: 4px; }
  [data-system="button"]:focus-visible { outline: 2px solid ${RING}; outline-offset: 2px; }
  [data-system="button"]:disabled { cursor: not-allowed; }
  [data-system="button"][data-loading] { opacity: 0.75; cursor: progress; }
  [data-slot="button-spinner"], [data-system="spinner"] {
    display: inline-block; width: 0.875rem; height: 0.875rem; border-radius: 50%; flex: none;
    border: 2px solid currentColor; border-right-color: transparent;
    animation: ed-system-spin 0.7s linear infinite;
  }
  [data-system="spinner"][data-size="sm"] { border-width: 1.5px; }
  @keyframes ed-system-spin { to { rotate: 360deg; } }

  /* ---- Badge, Avatar, Separator, Card ---- */
  [data-system="badge"] { display: inline-flex; align-items: center; line-height: 1.25rem; white-space: nowrap; }
  [data-system="avatar"] { display: inline-flex; align-items: center; justify-content: center; overflow: hidden; flex: none; }
  [data-slot="avatar-image"] { width: 100%; height: 100%; object-fit: cover; }
  [data-system="separator"] { display: block; flex: none; border: 0; }
  [data-system="separator"][data-orientation="horizontal"] { height: 1px; width: 100%; }
  [data-system="separator"][data-orientation="vertical"] { width: 1px; align-self: stretch; }
  [data-system="card"] { display: flex; flex-direction: column; }
  [data-slot="card-header"] { display: flex; flex-direction: column; }
  [data-slot="card-title"] { line-height: 1.25; }
  [data-slot="card-content"] { display: flex; flex-direction: column; }
  [data-slot="card-footer"] { display: flex; align-items: center; }

  /* ---- Fields ---- */
  [data-system="field"] { display: flex; flex-direction: column; min-width: 0; }
  [data-slot="field-label"] { line-height: 1.25; }
  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] {
    width: 100%; min-width: 0; font: inherit;
    transition: border-color 0.15s, box-shadow 0.15s; outline: none;
  }
  [data-slot="textarea"] { resize: vertical; min-height: 4rem; }
  /*
   * An input's icon sits over the start of the input's box, which keeps its border and states:
   * 0.75rem in, centred on the box's height, the text 0.5rem after a 1rem icon. The text's start
   * is the icon's place, so it wins over a look's padding (a look's padding is not readable here).
   */
  [data-system="input-box"] { position: relative; display: flex; flex-direction: column; min-width: 0; }
  [data-slot="input-icon"] {
    position: absolute; inset-block: 0; inset-inline-start: 0.75rem;
    display: flex; align-items: center; gap: 0.25rem;
  }
  [data-slot="input-icon"] > * { flex: none; }
  [data-system="input-box"] > [data-slot="input"] { padding-inline-start: 2.25rem !important; }
  :is([data-slot="input"], [data-slot="textarea"])::placeholder { color: var(--color-muted-foreground); }
  :is([data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]):disabled,
  [data-slot="select-trigger"][data-disabled] { cursor: not-allowed; }

  [data-slot="select-trigger"] { display: flex; align-items: center; justify-content: space-between; cursor: pointer; text-align: left; }
  [data-slot="select-value"][data-placeholder] { color: var(--color-muted-foreground); }
  [data-slot="select-icon"] { display: flex; color: var(--color-muted-foreground); }
  [data-slot="select-icon"] svg, [data-slot="select-item-indicator"] svg { width: 1rem; height: 1rem; }

  [data-system="check"] { display: inline-flex; align-items: center; cursor: pointer; }
  [data-slot="checkbox"] { display: inline-grid; place-items: center; padding: 0; flex: none; cursor: pointer; }
  [data-slot="checkbox-indicator"] { display: flex; }
  [data-slot="checkbox-indicator"] svg { width: 0.75rem; height: 0.75rem; }
  [data-slot="switch"] {
    position: relative; display: inline-flex; align-items: center; flex: none;
    border: 0; cursor: pointer; transition: background-color 0.15s;
  }
  [data-slot="switch-thumb"] { display: block; transition: translate 0.15s; }
  [data-slot="switch-thumb"][data-checked] { translate: 1rem 0; }
  :is([data-slot="checkbox"], [data-slot="switch"])[data-disabled] { cursor: not-allowed; }

  /* ---- Tabs ---- */
  [data-system="tabs"] { display: flex; flex-direction: column; }
  [data-slot="tabs-list"] { position: relative; display: flex; }
  [data-slot="tab"] { border: 0; background: none; font: inherit; cursor: pointer; }
  [data-slot="tabs-indicator"] {
    position: absolute; bottom: -1px; left: var(--active-tab-left); width: var(--active-tab-width);
    transition: left 0.2s, width 0.2s;
  }
  [data-slot="tab-panel"] { display: flex; flex-direction: column; }

  /* ---- Triggers and popups ---- */
  [data-system="trigger"] { display: inline-flex; align-items: center; gap: 0.5rem; }
  [data-system-positioner] { z-index: 50; outline: 0; }
  [data-system-popup] {
    min-width: max(var(--anchor-width, 0px), 10rem); max-height: min(var(--available-height, 20rem), 20rem); overflow: auto;
    outline: 0; transform-origin: var(--transform-origin); transition: opacity 0.14s, scale 0.14s;
  }
  [data-system-popup]:is([data-starting-style], [data-ending-style]) { opacity: 0; scale: 0.96; }
  :is([data-slot="select-item"], [data-slot="menu-item"]) {
    display: flex; align-items: center; cursor: default; outline: 0; user-select: none; position: relative;
  }
  [data-slot="select-item-indicator"] { position: absolute; left: 0.5rem; display: flex; }
  [data-slot="menu-separator"] { margin: 0.25rem -0.25rem; }

  [data-slot="popover"] { outline: 0; transform-origin: var(--transform-origin); transition: opacity 0.14s, scale 0.14s; }
  [data-slot="popover"]:is([data-starting-style], [data-ending-style]) { opacity: 0; scale: 0.96; }
  [data-slot="popover-title"] { margin: 0 0 0.5rem; }
  [data-slot="popover-content"] { display: flex; flex-direction: column; }

  [data-slot="tooltip"] {
    max-width: 16rem; line-height: 1.4;
    transform-origin: var(--transform-origin); transition: opacity 0.12s, scale 0.12s;
  }
  [data-slot="tooltip"]:is([data-starting-style], [data-ending-style]) { opacity: 0; scale: 0.95; }

  /* ---- Toast: the frame's corner, the whole width of a narrow frame ---- */
  [data-system-toasts] { position: fixed; right: 1rem; bottom: 1rem; z-index: 60; width: 22rem; max-width: calc(100% - 2rem); }
  [data-system="toast"] { display: flex; flex-direction: column; }
  [data-slot="toast-action"] { display: flex; margin-top: 0.5rem; }

  /* ---- Dialog: centred on a wide frame, a sheet at the bottom of a narrow one ---- */
  [data-slot="dialog-backdrop"] { position: fixed; inset: 0; z-index: 40; transition: opacity 0.2s; }
  [data-slot="dialog-backdrop"]:is([data-starting-style], [data-ending-style]) { opacity: 0; }
  [data-slot="dialog"] {
    position: fixed; z-index: 41; top: 50%; left: 50%; translate: -50% -50%;
    width: min(32rem, 100% - 2rem); max-height: calc(100% - 3rem); overflow: auto;
    display: flex; flex-direction: column; outline: 0;
    transition: opacity 0.2s, scale 0.2s, translate 0.25s;
  }
  [data-slot="dialog"][data-size="sm"] { width: min(24rem, 100% - 2rem); }
  [data-slot="dialog"][data-size="lg"] { width: min(42rem, 100% - 2rem); }
  [data-slot="dialog"]:is([data-starting-style], [data-ending-style]) { opacity: 0; scale: 0.95; }
  [data-slot="dialog-header"] { display: flex; flex-direction: column; padding-right: 1.5rem; }
  [data-slot="dialog-title"] { margin: 0; line-height: 1.3; }
  [data-slot="dialog-description"] { margin: 0; }
  [data-slot="dialog-content"] { display: flex; flex-direction: column; }
  [data-slot="dialog-footer"] { display: flex; justify-content: flex-end; }
  [data-slot="dialog-close"] {
    position: absolute; top: 1rem; right: 1rem; display: grid; place-items: center;
    padding: 0; border: 0; cursor: pointer;
  }
  [data-slot="dialog-close"] svg { width: 1rem; height: 1rem; }
  @container ed-frame (max-width: 640px) {
    [data-system-dialog] [data-slot="dialog"], [data-system-dialog] [data-slot="dialog"]:is([data-size="sm"], [data-size="lg"]) {
      top: auto; bottom: 0; left: 0; translate: 0 0; width: 100%; max-height: calc(100% - 2.5rem);
      border-radius: ${RADIUS_LG} ${RADIUS_LG} 0 0; border-bottom-width: 0;
    }
    [data-slot="dialog"]:is([data-starting-style], [data-ending-style]) { opacity: 1; scale: 1; translate: 0 100%; }
    [data-slot="dialog-footer"] { flex-direction: column-reverse; }
    [data-slot="dialog-footer"] > * { width: 100%; }
    [data-system-toasts] { left: 0.75rem; right: 0.75rem; bottom: 0.75rem; width: auto; max-width: none; }
  }
}
`;

/**
 * The design's stylesheet (ADRs 0028, 0041): every token's value in every theme, and the looks of
 * the system components the project owns, unlayered over the default ones. Made once per look
 * (`Preview.setLook`), not per frame.
 */
export const designCss = (
  components: readonly ComponentFile[],
  designSystem: DesignSystem | null
): string =>
  [
    designTokenCss(designSystem),
    lookCss(
      looksOf(systemComponentsIn(components)),
      makeStyleContext(designSystem)
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
