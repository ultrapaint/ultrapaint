/**
 * The primitives' default look (ADR 0040), in a layer of its own so that a spec (unlayered, ADR
 * 0029) and a node's own style win over it. What a part looks like is data: each primitive's
 * default spec (`defaults.ts`), drawn by `specCss` over the design system's tokens, each with a
 * neutral value of its own for a design that does not set it. What a spec cannot say is written
 * here, after it: layout and positioning, a dialog's sheet on a narrow frame, animations, and what
 * a pointer or a state does to a part.
 *
 * What a pointer does (`:hover`, Base UI's `data-highlighted`) shows only in a frame that runs:
 * a designed frame is inert and takes no pointer, and a state shows there only when the design
 * pins it (`data-ed-state`). Responsive parts answer the frame's width (`@container ed-frame`),
 * not the window's. A rule here that changes what a spec sets is as specific as the spec's rule,
 * which it follows.
 */
import { makeStyleContext } from "@ultrapaint/design-document/css";
import { specCss } from "@ultrapaint/design-document/spec";
import { PRIMITIVE_DEFAULTS } from "./defaults.ts";

const t = (name: string) => `var(--${name})`;

const BG = t("color-background");
const FG = t("color-foreground");
const PRIMARY = t("color-primary");
const SECONDARY = t("color-secondary");
const ACCENT = t("color-accent");
const ACCENT_FG = t("color-accent-foreground");
const DESTRUCTIVE = t("color-destructive");
const RING = t("color-ring");
const RADIUS_LG = t("radius-lg");

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

/** The default specs as rules: what each part looks like, over the tokens. */
const DEFAULT_LOOK = specCss(PRIMITIVE_DEFAULTS, makeStyleContext(null));

export const PRIMITIVES_CSS = `
@layer primitives {
${DEFAULT_TOKENS}
${DEFAULT_LOOK}
  [data-primitive] { box-sizing: border-box; font-family: inherit; }
  [data-primitive] *, [data-primitive-positioner] *, [data-primitive-dialog] * { box-sizing: border-box; }

  /* ---- Button ---- */
  [data-primitive="button"] {
    display: inline-flex; align-items: center; justify-content: center;
    line-height: 1; white-space: nowrap; cursor: pointer;
    transition: background-color 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
  }
  [data-primitive="button"]${HOVER}:not(:disabled) { background: color-mix(in oklab, ${PRIMARY} 88%, ${BG}); }
  [data-primitive="button"][data-variant="secondary"]${HOVER}:not(:disabled) { background: color-mix(in oklab, ${SECONDARY} 85%, ${FG}); }
  [data-primitive="button"][data-variant="outline"]${HOVER}:not(:disabled) { background: ${ACCENT}; color: ${ACCENT_FG}; }
  [data-primitive="button"][data-variant="ghost"]:is(${HOVER}, [data-popup-open]):not(:disabled) { background: ${ACCENT}; color: ${ACCENT_FG}; }
  [data-primitive="button"][data-variant="destructive"]${HOVER}:not(:disabled) { background: color-mix(in oklab, ${DESTRUCTIVE} 88%, black); }
  [data-primitive="button"][data-variant="link"] { text-decoration: underline; text-underline-offset: 4px; }
  [data-primitive="button"][data-variant="link"]${HOVER}:not(:disabled) { background: transparent; }
  [data-primitive="button"]:focus-visible { outline: 2px solid ${RING}; outline-offset: 2px; }
  [data-primitive="button"]:disabled { opacity: 0.5; cursor: not-allowed; }
  [data-primitive="button"][data-loading] { opacity: 0.75; cursor: progress; }
  [data-slot="button-spinner"], [data-primitive="spinner"] {
    display: inline-block; width: 0.875rem; height: 0.875rem; border-radius: 50%; flex: none;
    border: 2px solid currentColor; border-right-color: transparent;
    animation: ed-primitive-spin 0.7s linear infinite;
  }
  [data-primitive="spinner"][data-size="sm"] { border-width: 1.5px; }
  @keyframes ed-primitive-spin { to { rotate: 360deg; } }

  /* ---- Badge, Avatar, Separator, Card ---- */
  [data-primitive="badge"] { display: inline-flex; align-items: center; line-height: 1.25rem; white-space: nowrap; }
  [data-primitive="avatar"] { display: inline-flex; align-items: center; justify-content: center; overflow: hidden; flex: none; }
  [data-slot="avatar-image"] { width: 100%; height: 100%; object-fit: cover; }
  [data-primitive="separator"] { display: block; flex: none; border: 0; }
  [data-primitive="separator"][data-orientation="horizontal"] { height: 1px; width: 100%; }
  [data-primitive="separator"][data-orientation="vertical"] { width: 1px; align-self: stretch; }
  [data-primitive="card"] { display: flex; flex-direction: column; }
  [data-slot="card-header"] { display: flex; flex-direction: column; }
  [data-slot="card-title"] { line-height: 1.25; }
  [data-slot="card-content"] { display: flex; flex-direction: column; }
  [data-slot="card-footer"] { display: flex; align-items: center; }

  /* ---- Fields ---- */
  [data-primitive="field"] { display: flex; flex-direction: column; min-width: 0; }
  [data-slot="field-label"] { line-height: 1.25; }
  [data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"] {
    width: 100%; min-width: 0; font: inherit;
    transition: border-color 0.15s, box-shadow 0.15s; outline: none;
  }
  [data-slot="textarea"] { resize: vertical; min-height: 4rem; }
  :is([data-slot="input"], [data-slot="textarea"])::placeholder { color: var(--color-muted-foreground); }
  [data-primitive="field"] :is([data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]):is(:focus-visible, [data-popup-open]) {
    border-color: ${RING}; box-shadow: 0 0 0 3px color-mix(in oklab, ${RING} 35%, transparent);
  }
  [data-primitive="field"] :is([data-slot="input"], [data-slot="textarea"])[aria-invalid="true"] { border-color: ${DESTRUCTIVE}; }
  :is([data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]):disabled,
  [data-slot="select-trigger"][data-disabled] { opacity: 0.5; cursor: not-allowed; }

  [data-slot="select-trigger"] { display: flex; align-items: center; justify-content: space-between; cursor: pointer; text-align: left; }
  [data-slot="select-value"][data-placeholder] { color: var(--color-muted-foreground); }
  [data-slot="select-icon"] { display: flex; color: var(--color-muted-foreground); }
  [data-slot="select-icon"] svg, [data-slot="select-item-indicator"] svg { width: 1rem; height: 1rem; }

  [data-primitive="check"] { display: inline-flex; align-items: center; cursor: pointer; }
  [data-slot="checkbox"] { display: inline-grid; place-items: center; padding: 0; flex: none; cursor: pointer; }
  [data-primitive="check"] [data-slot="checkbox"][data-checked] { background-color: ${PRIMARY}; border-color: ${PRIMARY}; }
  [data-slot="checkbox-indicator"] { display: flex; }
  [data-slot="checkbox-indicator"] svg { width: 0.75rem; height: 0.75rem; }
  [data-slot="switch"] {
    position: relative; display: inline-flex; align-items: center; flex: none;
    border: 0; cursor: pointer; transition: background-color 0.15s;
  }
  [data-primitive="check"] [data-slot="switch"][data-checked] { background-color: ${PRIMARY}; }
  [data-slot="switch-thumb"] { display: block; transition: translate 0.15s; }
  [data-slot="switch-thumb"][data-checked] { translate: 1rem 0; }
  :is([data-slot="checkbox"], [data-slot="switch"])[data-disabled] { opacity: 0.5; cursor: not-allowed; }

  /* ---- Tabs ---- */
  [data-primitive="tabs"] { display: flex; flex-direction: column; }
  [data-slot="tabs-list"] { position: relative; display: flex; }
  [data-slot="tab"] { border: 0; background: none; font: inherit; cursor: pointer; }
  [data-primitive="tabs"] [data-slot="tab"]:is(${HOVER}, [data-active]) { color: ${FG}; }
  [data-slot="tabs-indicator"] {
    position: absolute; bottom: -1px; left: var(--active-tab-left); width: var(--active-tab-width);
    transition: left 0.2s, width 0.2s;
  }
  [data-slot="tab-panel"] { display: flex; flex-direction: column; }

  /* ---- Triggers and popups ---- */
  [data-primitive="trigger"] { display: inline-flex; align-items: center; gap: 0.5rem; }
  [data-primitive-positioner] { z-index: 50; outline: 0; }
  [data-primitive-popup] {
    min-width: max(var(--anchor-width, 0px), 10rem); max-height: min(var(--available-height, 20rem), 20rem); overflow: auto;
    outline: 0; transform-origin: var(--transform-origin); transition: opacity 0.14s, scale 0.14s;
  }
  [data-primitive-popup]:is([data-starting-style], [data-ending-style]) { opacity: 0; scale: 0.96; }
  :is([data-slot="select-item"], [data-slot="menu-item"]) {
    display: flex; align-items: center; cursor: default; outline: 0; user-select: none; position: relative;
  }
  [data-primitive-positioner] :is([data-slot="select-item"], [data-slot="menu-item"]):is([data-ed-live] [data-highlighted], [data-ed-state~="highlighted"]) {
    background: ${ACCENT}; color: ${ACCENT_FG};
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
  [data-primitive-toasts] { position: fixed; right: 1rem; bottom: 1rem; z-index: 60; width: 22rem; max-width: calc(100% - 2rem); }
  [data-primitive="toast"] { display: flex; flex-direction: column; }
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
  [data-primitive-dialog] [data-slot="dialog-close"]${HOVER} { background: ${ACCENT}; color: ${ACCENT_FG}; }
  @container ed-frame (max-width: 640px) {
    [data-primitive-dialog] [data-slot="dialog"], [data-primitive-dialog] [data-slot="dialog"]:is([data-size="sm"], [data-size="lg"]) {
      top: auto; bottom: 0; left: 0; translate: 0 0; width: 100%; max-height: calc(100% - 2.5rem);
      border-radius: ${RADIUS_LG} ${RADIUS_LG} 0 0; border-bottom-width: 0;
    }
    [data-slot="dialog"]:is([data-starting-style], [data-ending-style]) { opacity: 1; scale: 1; translate: 0 100%; }
    [data-slot="dialog-footer"] { flex-direction: column-reverse; }
    [data-slot="dialog-footer"] > * { width: 100%; }
    [data-primitive-toasts] { left: 0.75rem; right: 0.75rem; bottom: 0.75rem; width: auto; max-width: none; }
  }
}
`;
