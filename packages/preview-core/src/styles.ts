/**
 * The stylesheets every frame of the editor's page adopts (ADR 0034, 0040): the frame's own base,
 * the system components' default look, and the design's (every token's value and the looks the
 * project owns, ADRs 0028, 0041). Each is parsed once and shared by every frame; a frame given a
 * look of its own adopts its own design sheet in place of the shared one (ADR 0042).
 */
import {
  BODY_ATTRIBUTE,
  FRAME_CONTAINER,
  type FrameCss,
  frameCss,
} from "./frame-css.ts";

const sheets: {
  base: CSSStyleSheet | null;
  /** The components' own look: the system components' (ADR 0040). */
  components: CSSStyleSheet | null;
  design: CSSStyleSheet | null;
} = { base: null, components: null, design: null };
let componentsText = "";
let designText = "";
/** What of the stylesheets only the document can hold: their font faces. */
let lifted: { components: string; design: string } = {
  components: "",
  design: "",
};
let documentStyle: HTMLStyleElement | null = null;

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

/**
 * A design sheet of one frame's (a component's unsaved look): its font faces are the design's,
 * which the shared sheet lifts to the document already.
 */
export const ownDesignSheet = (css: string): CSSStyleSheet => {
  const own = new CSSStyleSheet();
  own.replaceSync(css ? frameCss(css).frame : "");
  return own;
};

/** Font faces and registered properties go to the editor's document, where the frames see them. */
const liftToDocument = () => {
  if (!documentStyle) {
    documentStyle = document.createElement("style");
    documentStyle.setAttribute("data-ed-preview", "");
    document.head.append(documentStyle);
  }
  documentStyle.textContent = [lifted.components, lifted.design]
    .filter(Boolean)
    .join("\n");
};

const write = (key: "components" | "design", css: string) => {
  const made: FrameCss = css ? frameCss(css) : { document: "", frame: "" };
  sheet(key).replaceSync(made.frame);
  if (made.document !== lifted[key]) {
    lifted = { ...lifted, [key]: made.document };
    liftToDocument();
  }
};

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
