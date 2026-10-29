/**
 * The stylesheets every frame of the editor's page adopts (ADR 0034, 0040): the frame's own base,
 * the system components' default look, and the design's (every token's value and the looks the
 * project owns, ADRs 0028, 0041). Each is parsed once and shared by every frame; a frame given a
 * look of its own adopts its own design sheet in place of the shared one (ADR 0042).
 *
 * The editor writes all of it for a frame (ADR 0042): the root is the shadow host (`:host`), the
 * body the frame's body element, the window's size the frame's (`@container ed-frame`, `cqh`).
 */

/** The name the frames' query container goes by: the shadow host. */
export const FRAME_CONTAINER = "ed-frame";

/** The attribute of the element that stands for a page's `<body>`. */
export const BODY_ATTRIBUTE = "data-ed-body";

const sheets: {
  base: CSSStyleSheet | null;
  /** The components' own look: the system components' (ADR 0040). */
  components: CSSStyleSheet | null;
  design: CSSStyleSheet | null;
} = { base: null, components: null, design: null };
let componentsText = "";
let designText = "";

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
 * The reset is a layer of its own, the frames' first: every later rule on the page's root (the
 * system components' layer, the design's tokens) wins over it as it would over the browser's defaults.
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
 * The sheets a frame adopts, in the order they apply: the design's last, so it wins; `own` in
 * place of the shared design sheet.
 */
export const frameSheets = (own?: CSSStyleSheet): CSSStyleSheet[] => [
  sheet("base"),
  sheet("components"),
  own ?? sheet("design"),
];

/** A design sheet of one frame's (a component's unsaved look). */
export const ownDesignSheet = (css: string): CSSStyleSheet => {
  const own = new CSSStyleSheet();
  own.replaceSync(css);
  return own;
};

const write = (key: "components" | "design", css: string) =>
  sheet(key).replaceSync(css);

/** The components' own stylesheet, the same for every frame: written again only when it changed. */
export const setComponentsCss = (css: string) => {
  if (css !== componentsText) {
    componentsText = css;
    write("components", css);
  }
};

/** The design's stylesheet, shared by every frame: written again only when it changed. */
export const setDesignCss = (css: string) => {
  if (css !== designText) {
    designText = css;
    write("design", css);
  }
};
