/**
 * The stylesheets every frame of the editor's page adopts (ADR 0034): the application's, as its
 * dev server loads them, and the design's (the tokens' values and the component specs, ADR 0028
 * and 0029). Each is parsed once and shared by every frame. Vite's client hands the
 * application's stylesheets here instead of the editor's head (`installHooks`), keeps them up to
 * date as they change, and asks here before it reloads the page.
 */
import {
  installPageRuntime,
  type PageStyles,
  RELOAD_GLOBAL,
  STYLES_GLOBAL,
} from "@ultrapaint/contracts/page-runtime";
import {
  BODY_ATTRIBUTE,
  FRAME_CONTAINER,
  type FrameCss,
  frameCss,
} from "./frame-css.ts";

/** The application's stylesheets, by the module that loads each, as frames adopt them. */
const parts = new Map<string, { document: string; frame: string }>();
const sheets: {
  app: CSSStyleSheet | null;
  base: CSSStyleSheet | null;
  /** What the application's code writes as it runs (`css-in-js.ts`). */
  cssInJs: CSSStyleSheet | null;
  design: CSSStyleSheet | null;
} = { app: null, base: null, cssInJs: null, design: null };
let designText = "";
/** What of the design's stylesheet only the document can hold: its font faces. */
let designDocument = "";
let cssInJsText = "";
/** What of the styles the application's code writes only the document can hold. */
let cssInJsDocument = "";
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
 *
 * The reset is a layer of its own, the frames' first: the application's rules on its document's
 * root (`html`, Tailwind's preflight in `@layer base`) win over it as they win over the browser's
 * defaults. Unlayered, it beat every layered rule, and a page lost its root's line height and
 * type.
 */
const BASE_CSS = `
@layer ed-frame {
  :host { all: initial; }
}
:host {
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

/** Custom properties of the editor's own the frames keep: the camera's zoom above each host. */
const KEPT_VARIABLE_RE = /^--(?:inv$|ed-)/;

/**
 * The editor's own custom properties, set back to nothing in every frame. They inherit through
 * the host, which `all: initial` does not stop: a page whose stylesheets do not define `--primary`
 * would draw with the editor's. In the frames' first layer, so whatever the page defines wins.
 */
const editorVariablesReset = (): string => {
  const names = new Set<string>();
  for (const el of [document.documentElement, document.body]) {
    for (const name of Array.from(getComputedStyle(el))) {
      if (name.startsWith("--") && !KEPT_VARIABLE_RE.test(name)) {
        names.add(name);
      }
    }
  }
  if (names.size === 0) {
    return "";
  }
  const reset = [...names].map((name) => `${name}: initial;`).join(" ");
  return `@layer ed-frame {\n  :host { ${reset} }\n}\n`;
};

const sheet = (key: keyof typeof sheets): CSSStyleSheet => {
  let found = sheets[key];
  if (!found) {
    found = new CSSStyleSheet();
    if (key === "base") {
      found.replaceSync(`${BASE_CSS}\n${editorVariablesReset()}`);
    }
    sheets[key] = found;
  }
  return found;
};

/**
 * The sheets a frame adopts, in the order they apply: what the application's code writes as it
 * runs after its stylesheets, as its library appends it to the head after them; the design's
 * last, so it wins.
 */
export const frameSheets = (): CSSStyleSheet[] => [
  sheet("base"),
  sheet("app"),
  sheet("cssInJs"),
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
  documentStyle.textContent = [...lifted, cssInJsDocument, designDocument]
    .filter(Boolean)
    .join("\n");
};

const schedule = () => {
  if (!rebuildScheduled) {
    rebuildScheduled = true;
    queueMicrotask(rebuild);
  }
};

const hooks: PageStyles = {
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
  installPageRuntime({
    [RELOAD_GLOBAL]: () => {
      if (reloadListeners.size === 0) {
        location.reload();
        return;
      }
      for (const listener of reloadListeners) {
        listener();
      }
    },
    [STYLES_GLOBAL]: hooks,
  });
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

/** What the application's code writes as it runs, for every frame: written again when it changed. */
export const setCssInJs = (css: FrameCss) => {
  if (css.frame !== cssInJsText) {
    cssInJsText = css.frame;
    sheet("cssInJs").replaceSync(css.frame);
  }
  if (css.document !== cssInJsDocument) {
    cssInJsDocument = css.document;
    schedule();
  }
};

/** Every rule the frames adopt, for what reads the stylesheets: the tokens. */
export const adoptedSheets = (): CSSStyleSheet[] => [
  sheet("app"),
  sheet("cssInJs"),
  sheet("design"),
];
