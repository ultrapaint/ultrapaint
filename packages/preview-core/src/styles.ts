/**
 * The stylesheets every frame of the editor's page adopts (ADR 0034): the application's, as its
 * dev server loads them, and the design's (the tokens' values and the component specs, ADR 0028
 * and 0029). Each is parsed once and shared by every frame. Vite's client hands the
 * application's stylesheets here instead of the editor's head (`installHooks`), keeps them up to
 * date as they change, and asks here before it reloads the page.
 */
import { BODY_ATTRIBUTE, FRAME_CONTAINER, frameCss } from "./frame-css.ts";

interface Hooks {
  readonly remove: (id: string) => void;
  readonly update: (id: string, css: string) => void;
}

interface HookedGlobal {
  __edReload?: () => void;
  __edStyles?: Hooks;
}

/** The application's stylesheets, by the module that loads each, as frames adopt them. */
const parts = new Map<string, { document: string; frame: string }>();
const sheets: {
  app: CSSStyleSheet | null;
  base: CSSStyleSheet | null;
  design: CSSStyleSheet | null;
} = { app: null, base: null, design: null };
let designText = "";
/** What of the design's stylesheet only the document can hold: its font faces. */
let designDocument = "";
let documentStyle: HTMLStyleElement | null = null;
let rebuildScheduled = false;
const reloadListeners = new Set<() => void>();

const SKELETON_CSS = `
[data-ed-skeleton] {
  color: transparent !important;
  background: linear-gradient(90deg, rgba(128,128,128,.16) 0%, rgba(128,128,128,.34) 50%, rgba(128,128,128,.16) 100%) 0 0 / 200% 100% !important;
  border-color: transparent !important;
  border-radius: 6px;
  animation: ed-skeleton 1.4s linear infinite;
}
[data-ed-skeleton] * { visibility: hidden !important; }
img[data-ed-skeleton] { opacity: 0.35; }
@keyframes ed-skeleton { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { [data-ed-skeleton] { animation: none; } }
`;

/**
 * What a frame is before any page's stylesheet: a window of its own size that scrolls without
 * scrollbars, which nothing of the editor's styles reaches. A page frame is a query container
 * of its size and contains what is fixed inside it; a node on the canvas (`fit`) is as big as
 * what it draws.
 */
const BASE_CSS = `
:host {
  all: initial;
  display: block;
  position: relative;
  overflow: auto;
  scrollbar-width: none;
  contain: strict;
  container: ${FRAME_CONTAINER} / size;
}
:host([data-ed-fit]) {
  overflow: visible;
  contain: layout style;
  container: none;
}
[${BODY_ATTRIBUTE}] { display: block; min-height: 100%; }
:host([data-ed-fit]) [${BODY_ATTRIBUTE}] { min-height: 0; }
#root { min-height: 100%; }
:host([data-ed-still]) *, :host([data-ed-still]) *::before, :host([data-ed-still]) *::after {
  transition: none !important;
  animation-duration: 0s !important;
  animation-delay: 0s !important;
}
${SKELETON_CSS}
`;

const sheet = (key: keyof typeof sheets): CSSStyleSheet => {
  let found = sheets[key];
  if (!found) {
    found = new CSSStyleSheet();
    if (key === "base") {
      found.replaceSync(BASE_CSS);
    }
    sheets[key] = found;
  }
  return found;
};

/** The sheets a frame adopts, in the order they apply: the design's last, so it wins. */
export const frameSheets = (): CSSStyleSheet[] => [
  sheet("base"),
  sheet("app"),
  sheet("design"),
];

const rebuild = () => {
  rebuildScheduled = false;
  const all = [...parts.values()];
  sheet("app").replaceSync(all.map((p) => p.frame).join("\n"));
  if (!documentStyle) {
    documentStyle = document.createElement("style");
    documentStyle.setAttribute("data-ed-preview", "");
    document.head.append(documentStyle);
  }
  const lifted = all.map((p) => p.document).filter(Boolean);
  documentStyle.textContent = [...lifted, designDocument].join("\n");
};

const schedule = () => {
  if (!rebuildScheduled) {
    rebuildScheduled = true;
    queueMicrotask(rebuild);
  }
};

const hooks: Hooks = {
  remove: (id) => {
    if (parts.delete(id)) {
      schedule();
    }
  },
  update: (id, css) => {
    parts.set(id, frameCss(css));
    schedule();
  },
};

/**
 * Put in place before the application's stylesheets load: Vite's client, patched by the
 * preview's server, calls them instead of writing `<style>` into the editor's head and instead
 * of reloading the editor.
 */
export const installHooks = () => {
  const global = globalThis as HookedGlobal;
  global.__edStyles = hooks;
  global.__edReload = () => {
    if (reloadListeners.size === 0) {
      location.reload();
      return;
    }
    for (const listener of reloadListeners) {
      listener();
    }
  };
};

/**
 * Hears when the dev server can only bring the page up to date by loading it again: its
 * dependencies were bundled anew, or it started again. The modules the editor's page holds are
 * then out of date, which only loading the page again changes.
 */
export const onReloadRequest = (listener: () => void) => {
  reloadListeners.add(listener);
  return () => {
    reloadListeners.delete(listener);
  };
};

/** The design's stylesheet, the same for every frame: written again only when it changed. */
export const setDesignCss = (css: string) => {
  if (css === designText) {
    return;
  }
  designText = css;
  const made = css ? frameCss(css) : { document: "", frame: "" };
  designDocument = made.document;
  sheet("design").replaceSync(made.frame);
  schedule();
};

/** Every rule the frames adopt, for what reads the stylesheets: the tokens. */
export const adoptedSheets = (): CSSStyleSheet[] => [
  sheet("app"),
  sheet("design"),
];
