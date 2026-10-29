/**
 * The primitives' default look (ADR 0040): every part by its `data-slot`, drawn with the design
 * system's tokens by their names (`--color-primary`, `--radius-md`), each with a neutral value of
 * its own for a design that does not set it. It is a layer of its own, so a spec (unlayered, ADR
 * 0029) and a node's own style win over it.
 *
 * What a pointer does (`:hover`, Base UI's `data-highlighted`) shows only in a frame that runs:
 * a designed frame is inert and takes no pointer, and a state shows there only when the design
 * pins it (`data-ed-state`). Responsive parts answer the frame's width (`@container ed-frame`),
 * not the window's.
 */

const t = (name: string, fallback: string) => `var(--${name}, ${fallback})`;

const BG = t("color-background", "#ffffff");
const FG = t("color-foreground", "#09090b");
const PRIMARY = t("color-primary", "#18181b");
const PRIMARY_FG = t("color-primary-foreground", "#fafafa");
const SECONDARY = t("color-secondary", "#f4f4f5");
const SECONDARY_FG = t("color-secondary-foreground", "#18181b");
const MUTED_FG = t("color-muted-foreground", "#71717a");
const ACCENT = t("color-accent", "#f4f4f5");
const ACCENT_FG = t("color-accent-foreground", "#18181b");
const DESTRUCTIVE = t("color-destructive", "#dc2626");
const DESTRUCTIVE_FG = t("color-destructive-foreground", "#ffffff");
const BORDER = t("color-border", "#e4e4e7");
const INPUT = t("color-input", "#e4e4e7");
const RING = t("color-ring", "#a1a1aa");
const CARD = t("color-card", "#ffffff");
const CARD_FG = t("color-card-foreground", "#09090b");
const POPOVER = t("color-popover", "#ffffff");
const POPOVER_FG = t("color-popover-foreground", "#09090b");
const RADIUS_SM = t("radius-sm", "0.375rem");
const RADIUS_MD = t("radius-md", "0.5rem");
const RADIUS_LG = t("radius-lg", "0.75rem");
const SHADOW =
  "0 10px 30px -10px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(0 0 0 / 0.06)";

/** A selector for a pointer state: in a running frame, or pinned by the design. */
const pointer = (state: string, pinned: string) =>
  `:is([data-ed-live] :is(${state}), [data-ed-state~="${pinned}"])`;
const HOVER = pointer(":hover", "hover");

/**
 * What every token the primitives and a new canvas draw with is until the design says otherwise:
 * a neutral theme, so a project with no design system yet draws as one. The design's own values
 * (unlayered) win over these.
 */
const DEFAULT_TOKENS = `
  :root {
    --color-background: #ffffff; --color-foreground: #09090b;
    --color-primary: #18181b; --color-primary-foreground: #fafafa;
    --color-secondary: #f4f4f5; --color-secondary-foreground: #18181b;
    --color-muted: #f4f4f5; --color-muted-foreground: #71717a;
    --color-accent: #f4f4f5; --color-accent-foreground: #18181b;
    --color-destructive: #dc2626; --color-destructive-foreground: #ffffff;
    --color-border: #e4e4e7; --color-input: #e4e4e7; --color-ring: #a1a1aa;
    --color-card: #ffffff; --color-card-foreground: #09090b;
    --color-popover: #ffffff; --color-popover-foreground: #09090b;
    --radius-sm: 0.375rem; --radius-md: 0.5rem; --radius-lg: 0.75rem;
    --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-family: var(--font-sans); line-height: 1.5; color: var(--color-foreground);
    -webkit-font-smoothing: antialiased;
  }
  .dark, [data-theme~="dark"] {
    --color-background: #09090b; --color-foreground: #fafafa;
    --color-primary: #fafafa; --color-primary-foreground: #18181b;
    --color-secondary: #27272a; --color-secondary-foreground: #fafafa;
    --color-muted: #27272a; --color-muted-foreground: #a1a1aa;
    --color-accent: #27272a; --color-accent-foreground: #fafafa;
    --color-destructive: #ef4444; --color-destructive-foreground: #fafafa;
    --color-border: #27272a; --color-input: #3f3f46; --color-ring: #71717a;
    --color-card: #09090b; --color-card-foreground: #fafafa;
    --color-popover: #18181b; --color-popover-foreground: #fafafa;
  }
`;

export const PRIMITIVES_CSS = `
@layer primitives {
${DEFAULT_TOKENS}
  [data-primitive] { box-sizing: border-box; font-family: inherit; }
  [data-primitive] *, [data-primitive-positioner] *, [data-primitive-dialog] * { box-sizing: border-box; }

  /* ---- Button ---- */
  [data-primitive="button"] {
    display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
    height: 2.25rem; padding: 0 1rem; border: 1px solid transparent; border-radius: ${RADIUS_MD};
    font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer;
    background: ${PRIMARY}; color: ${PRIMARY_FG};
    transition: background-color 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
  }
  [data-primitive="button"][data-size="sm"] { height: 2rem; padding: 0 0.75rem; font-size: 0.8125rem; }
  [data-primitive="button"][data-size="lg"] { height: 2.75rem; padding: 0 1.5rem; font-size: 0.9375rem; }
  [data-primitive="button"][data-size="icon"] { width: 2.25rem; padding: 0; }
  [data-primitive="button"]${HOVER}:not(:disabled) { background: color-mix(in oklab, ${PRIMARY} 88%, ${BG}); }
  [data-primitive="button"][data-variant="secondary"] { background: ${SECONDARY}; color: ${SECONDARY_FG}; }
  [data-primitive="button"][data-variant="secondary"]${HOVER}:not(:disabled) { background: color-mix(in oklab, ${SECONDARY} 85%, ${FG}); }
  [data-primitive="button"][data-variant="outline"] { background: ${BG}; color: ${FG}; border-color: ${INPUT}; }
  [data-primitive="button"][data-variant="outline"]${HOVER}:not(:disabled) { background: ${ACCENT}; color: ${ACCENT_FG}; }
  [data-primitive="button"][data-variant="ghost"] { background: transparent; color: ${FG}; }
  [data-primitive="button"][data-variant="ghost"]:is(${HOVER.slice(0)}, [data-popup-open]):not(:disabled) { background: ${ACCENT}; color: ${ACCENT_FG}; }
  [data-primitive="button"][data-variant="destructive"] { background: ${DESTRUCTIVE}; color: ${DESTRUCTIVE_FG}; }
  [data-primitive="button"][data-variant="destructive"]${HOVER}:not(:disabled) { background: color-mix(in oklab, ${DESTRUCTIVE} 88%, black); }
  [data-primitive="button"][data-variant="link"] { background: transparent; color: ${PRIMARY}; padding: 0; height: auto; text-decoration: underline; text-underline-offset: 4px; }
  [data-primitive="button"]:focus-visible { outline: 2px solid ${RING}; outline-offset: 2px; }
  [data-primitive="button"]:disabled { opacity: 0.5; cursor: not-allowed; }
  [data-primitive="button"][data-loading] { opacity: 0.75; cursor: progress; }
  [data-slot="button-spinner"], [data-primitive="spinner"] {
    display: inline-block; width: 0.875rem; height: 0.875rem; border-radius: 50%; flex: none;
    border: 2px solid currentColor; border-right-color: transparent;
    animation: ed-primitive-spin 0.7s linear infinite;
  }
  [data-primitive="spinner"] { width: 1rem; height: 1rem; }
  [data-primitive="spinner"][data-size="sm"] { width: 0.75rem; height: 0.75rem; border-width: 1.5px; }
  [data-primitive="spinner"][data-size="lg"] { width: 1.5rem; height: 1.5rem; }
  @keyframes ed-primitive-spin { to { rotate: 360deg; } }

  /* ---- Badge, Avatar, Separator, Card ---- */
  [data-primitive="badge"] {
    display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.125rem 0.625rem;
    border: 1px solid transparent; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; line-height: 1.25rem;
    background: ${PRIMARY}; color: ${PRIMARY_FG}; white-space: nowrap;
  }
  [data-primitive="badge"][data-variant="secondary"] { background: ${SECONDARY}; color: ${SECONDARY_FG}; }
  [data-primitive="badge"][data-variant="outline"] { background: transparent; color: ${FG}; border-color: ${BORDER}; }
  [data-primitive="badge"][data-variant="destructive"] { background: ${DESTRUCTIVE}; color: ${DESTRUCTIVE_FG}; }

  [data-primitive="avatar"] {
    display: inline-flex; align-items: center; justify-content: center; overflow: hidden; flex: none;
    width: 2.5rem; height: 2.5rem; border-radius: 9999px; background: ${SECONDARY}; color: ${SECONDARY_FG};
    font-size: 0.875rem; font-weight: 500;
  }
  [data-primitive="avatar"][data-size="sm"] { width: 2rem; height: 2rem; font-size: 0.75rem; }
  [data-primitive="avatar"][data-size="lg"] { width: 3.5rem; height: 3.5rem; font-size: 1.125rem; }
  [data-slot="avatar-image"] { width: 100%; height: 100%; object-fit: cover; }

  [data-primitive="separator"] { display: block; flex: none; background: ${BORDER}; border: 0; }
  [data-primitive="separator"][data-orientation="horizontal"] { height: 1px; width: 100%; }
  [data-primitive="separator"][data-orientation="vertical"] { width: 1px; align-self: stretch; }

  [data-primitive="card"] {
    display: flex; flex-direction: column; gap: 1.5rem; padding: 1.5rem 0;
    background: ${CARD}; color: ${CARD_FG}; border: 1px solid ${BORDER}; border-radius: ${RADIUS_LG};
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  }
  [data-slot="card-header"] { display: flex; flex-direction: column; gap: 0.375rem; padding: 0 1.5rem; }
  [data-slot="card-title"] { font-size: 1rem; font-weight: 600; line-height: 1.25; }
  [data-slot="card-description"] { font-size: 0.875rem; color: ${MUTED_FG}; }
  [data-slot="card-content"] { display: flex; flex-direction: column; gap: 0.75rem; padding: 0 1.5rem; }
  [data-slot="card-footer"] { display: flex; align-items: center; gap: 0.5rem; padding: 0 1.5rem; }

  /* ---- Fields ---- */
  [data-primitive="field"] { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
  [data-slot="field-label"] { font-size: 0.875rem; font-weight: 500; line-height: 1.25; color: ${FG}; }
  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] {
    width: 100%; min-width: 0; border: 1px solid ${INPUT}; border-radius: ${RADIUS_MD};
    background: transparent; color: ${FG}; font: inherit; font-size: 0.875rem;
    transition: border-color 0.15s, box-shadow 0.15s; outline: none;
  }
  [data-slot="input"] { height: 2.25rem; padding: 0 0.75rem; }
  [data-slot="input"][data-size="sm"] { height: 2rem; }
  [data-slot="input"][data-size="lg"] { height: 2.75rem; }
  [data-slot="textarea"] { padding: 0.5rem 0.75rem; resize: vertical; min-height: 4rem; }
  :is([data-slot="input"], [data-slot="textarea"])::placeholder { color: ${MUTED_FG}; }
  :is([data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]):is(:focus-visible, [data-popup-open]) {
    border-color: ${RING}; box-shadow: 0 0 0 3px color-mix(in oklab, ${RING} 35%, transparent);
  }
  :is([data-slot="input"], [data-slot="textarea"])[aria-invalid="true"] { border-color: ${DESTRUCTIVE}; }
  :is([data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]):disabled,
  [data-slot="select-trigger"][data-disabled] { opacity: 0.5; cursor: not-allowed; }

  [data-slot="select-trigger"] {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    height: 2.25rem; padding: 0 0.75rem; cursor: pointer; text-align: left;
  }
  [data-slot="select-value"][data-placeholder] { color: ${MUTED_FG}; }
  [data-slot="select-icon"] { display: flex; color: ${MUTED_FG}; }
  [data-slot="select-icon"] svg, [data-slot="select-item-indicator"] svg { width: 1rem; height: 1rem; }

  [data-primitive="check"] { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer; }
  [data-slot="checkbox"] {
    display: inline-grid; place-items: center; width: 1rem; height: 1rem; padding: 0; flex: none;
    border: 1px solid ${INPUT}; border-radius: 0.25rem; background: transparent; color: ${PRIMARY_FG}; cursor: pointer;
  }
  [data-slot="checkbox"][data-checked] { background: ${PRIMARY}; border-color: ${PRIMARY}; }
  [data-slot="checkbox-indicator"] { display: flex; }
  [data-slot="checkbox-indicator"] svg { width: 0.75rem; height: 0.75rem; }
  [data-slot="switch"] {
    position: relative; display: inline-flex; align-items: center; width: 2.25rem; height: 1.25rem; padding: 2px; flex: none;
    border: 0; border-radius: 9999px; background: ${INPUT}; cursor: pointer; transition: background-color 0.15s;
  }
  [data-slot="switch"][data-checked] { background: ${PRIMARY}; }
  [data-slot="switch-thumb"] {
    display: block; width: 1rem; height: 1rem; border-radius: 9999px; background: ${BG};
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.2); transition: translate 0.15s;
  }
  [data-slot="switch-thumb"][data-checked] { translate: 1rem 0; }
  :is([data-slot="checkbox"], [data-slot="switch"])[data-disabled] { opacity: 0.5; cursor: not-allowed; }

  /* ---- Tabs ---- */
  [data-primitive="tabs"] { display: flex; flex-direction: column; gap: 1rem; }
  [data-slot="tabs-list"] { position: relative; display: flex; gap: 0.25rem; border-bottom: 1px solid ${BORDER}; }
  [data-slot="tab"] {
    border: 0; background: none; padding: 0.5rem 0.75rem; font: inherit; font-size: 0.875rem; font-weight: 500;
    color: ${MUTED_FG}; cursor: pointer;
  }
  [data-slot="tab"]${HOVER} { color: ${FG}; }
  [data-slot="tab"][data-active] { color: ${FG}; }
  [data-slot="tabs-indicator"] {
    position: absolute; bottom: -1px; left: var(--active-tab-left); width: var(--active-tab-width);
    height: 2px; background: ${PRIMARY}; transition: left 0.2s, width 0.2s;
  }
  [data-slot="tab-panel"] { display: flex; flex-direction: column; gap: 0.75rem; }

  /* ---- Triggers and popups ---- */
  [data-primitive="trigger"] { display: inline-flex; align-items: center; gap: 0.5rem; }
  [data-primitive-positioner] { z-index: 50; outline: 0; }
  [data-primitive-popup] {
    min-width: max(var(--anchor-width, 0px), 10rem); max-height: min(var(--available-height, 20rem), 20rem); overflow: auto;
    padding: 0.25rem; outline: 0; background: ${POPOVER}; color: ${POPOVER_FG};
    border-radius: ${RADIUS_MD}; box-shadow: ${SHADOW}; font-size: 0.875rem;
    transform-origin: var(--transform-origin); transition: opacity 0.14s, scale 0.14s;
  }
  [data-primitive-popup]:is([data-starting-style], [data-ending-style]) { opacity: 0; scale: 0.96; }
  :is([data-slot="select-item"], [data-slot="menu-item"]) {
    display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem; border-radius: ${RADIUS_SM};
    cursor: default; outline: 0; user-select: none; position: relative;
  }
  [data-slot="select-item"] { padding-left: 1.75rem; }
  :is([data-slot="select-item"], [data-slot="menu-item"]):is([data-ed-live] [data-highlighted], [data-ed-state~="highlighted"]) {
    background: ${ACCENT}; color: ${ACCENT_FG};
  }
  [data-slot="select-item-indicator"] { position: absolute; left: 0.5rem; display: flex; }
  [data-slot="menu-separator"] { height: 1px; margin: 0.25rem -0.25rem; background: ${BORDER}; }

  [data-slot="popover"] {
    width: 18rem; padding: 1rem; outline: 0; background: ${POPOVER}; color: ${POPOVER_FG};
    border-radius: ${RADIUS_MD}; box-shadow: ${SHADOW}; font-size: 0.875rem;
    transform-origin: var(--transform-origin); transition: opacity 0.14s, scale 0.14s;
  }
  [data-slot="popover"]:is([data-starting-style], [data-ending-style]) { opacity: 0; scale: 0.96; }
  [data-slot="popover-title"] { margin: 0 0 0.5rem; font-size: 0.9375rem; font-weight: 600; }
  [data-slot="popover-content"] { display: flex; flex-direction: column; gap: 0.5rem; }

  [data-slot="tooltip"] {
    max-width: 16rem; padding: 0.375rem 0.625rem; border-radius: ${RADIUS_SM};
    background: ${PRIMARY}; color: ${PRIMARY_FG}; font-size: 0.75rem; line-height: 1.4;
    transform-origin: var(--transform-origin); transition: opacity 0.12s, scale 0.12s;
  }
  [data-slot="tooltip"]:is([data-starting-style], [data-ending-style]) { opacity: 0; scale: 0.95; }

  /* ---- Toast: the frame's corner, the whole width of a narrow frame ---- */
  [data-primitive-toasts] { position: fixed; right: 1rem; bottom: 1rem; z-index: 60; width: 22rem; max-width: calc(100% - 2rem); }
  [data-primitive="toast"] {
    display: flex; flex-direction: column; gap: 0.25rem; padding: 0.875rem 1rem;
    background: ${POPOVER}; color: ${POPOVER_FG}; border: 1px solid ${BORDER}; border-radius: ${RADIUS_LG};
    box-shadow: ${SHADOW}; font-size: 0.875rem;
  }
  [data-primitive="toast"][data-variant="destructive"] { background: ${DESTRUCTIVE}; color: ${DESTRUCTIVE_FG}; border-color: transparent; }
  [data-slot="toast-title"] { font-weight: 600; }
  [data-slot="toast-description"] { opacity: 0.85; }
  [data-slot="toast-action"] { display: flex; gap: 0.5rem; margin-top: 0.5rem; }

  /* ---- Dialog: centred on a wide frame, a sheet at the bottom of a narrow one ---- */
  [data-slot="dialog-backdrop"] { position: fixed; inset: 0; z-index: 40; background: rgb(0 0 0 / 0.5); transition: opacity 0.2s; }
  [data-slot="dialog-backdrop"]:is([data-starting-style], [data-ending-style]) { opacity: 0; }
  [data-slot="dialog"] {
    position: fixed; z-index: 41; top: 50%; left: 50%; translate: -50% -50%;
    width: min(32rem, 100% - 2rem); max-height: calc(100% - 3rem); overflow: auto;
    display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; outline: 0;
    background: ${BG}; color: ${FG}; border: 1px solid ${BORDER}; border-radius: ${RADIUS_LG}; box-shadow: ${SHADOW};
    transition: opacity 0.2s, scale 0.2s, translate 0.25s;
  }
  [data-slot="dialog"][data-size="sm"] { width: min(24rem, 100% - 2rem); }
  [data-slot="dialog"][data-size="lg"] { width: min(42rem, 100% - 2rem); }
  [data-slot="dialog"]:is([data-starting-style], [data-ending-style]) { opacity: 0; scale: 0.95; }
  [data-slot="dialog-header"] { display: flex; flex-direction: column; gap: 0.5rem; padding-right: 1.5rem; }
  [data-slot="dialog-title"] { margin: 0; font-size: 1.125rem; font-weight: 600; line-height: 1.3; }
  [data-slot="dialog-description"] { margin: 0; font-size: 0.875rem; color: ${MUTED_FG}; }
  [data-slot="dialog-content"] { display: flex; flex-direction: column; gap: 0.75rem; }
  [data-slot="dialog-footer"] { display: flex; justify-content: flex-end; gap: 0.5rem; }
  [data-slot="dialog-close"] {
    position: absolute; top: 1rem; right: 1rem; display: grid; place-items: center; width: 1.75rem; height: 1.75rem;
    padding: 0; border: 0; border-radius: ${RADIUS_SM}; background: none; color: ${MUTED_FG}; cursor: pointer;
  }
  [data-slot="dialog-close"] svg { width: 1rem; height: 1rem; }
  [data-slot="dialog-close"]${HOVER} { background: ${ACCENT}; color: ${ACCENT_FG}; }
  @container ed-frame (max-width: 640px) {
    [data-slot="dialog"], [data-slot="dialog"]:is([data-size="sm"], [data-size="lg"]) {
      top: auto; bottom: 0; left: 0; translate: 0 0; width: 100%; max-height: calc(100% - 2.5rem);
      border-radius: ${RADIUS_LG} ${RADIUS_LG} 0 0; border-bottom: 0;
    }
    [data-slot="dialog"]:is([data-starting-style], [data-ending-style]) { opacity: 1; scale: 1; translate: 0 100%; }
    [data-slot="dialog-footer"] { flex-direction: column-reverse; }
    [data-slot="dialog-footer"] > * { width: 100%; }
    [data-primitive-toasts] { left: 0.75rem; right: 0.75rem; bottom: 0.75rem; width: auto; max-width: none; }
  }
}
`;
