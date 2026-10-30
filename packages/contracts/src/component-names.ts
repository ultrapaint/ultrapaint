/**
 * The names of components (ADR 0041) that what draws them needs, apart from their schemas: the
 * preview's renderer imports these, and with them it would load Effect's Schema, most of what it
 * downloads and parses in every preview.
 */

/** Where components live, inside the designs directory: `components/<Name>.component.json`. */
export const COMPONENTS_DIR = "components";
export const COMPONENT_EXTENSION = ".component.json";
/** What an instance of one of the editor's system components names as `from` (ADR 0040, 0041). */
export const SYSTEM_FROM = "@ultrapaint/system";
/** What an instance of one of the project's app components names as `from` (ADR 0041). */
export const APP_FROM = "#app";
/** The part every system component has: the element it renders at its root. */
export const ROOT_SLOT = "root";
/** The states a system component's look can be given for. */
export const COMPONENT_STATES = [
  "hover",
  "focus",
  "active",
  "highlighted",
  "disabled",
  "open",
  "checked",
  "invalid",
] as const;
/**
 * The key a variant's overrides are kept under in a node's `at` (ADR 0041), beside the
 * breakpoints': `size=lg`. A breakpoint's name has no `=`.
 */
export const variantKey = (property: string, member: string) =>
  `${property}=${member}`;
export const isVariantKey = (key: string) => key.includes("=");

/**
 * The document an app component's tree is edited as (ADR 0041), beside a page's and a canvas's:
 * `component:Promo`. Its file is the component's. It is written as a design target names a
 * component (`COMPONENT_TARGET_PREFIX`, ADR 0030) and kept apart from it: a document is an app
 * component's tree, which a system component has none of, and a target any component's file;
 * nothing reads one as the other.
 */
export const COMPONENT_DOC_PREFIX = "component:";
export const componentDocOf = (name: string) =>
  `${COMPONENT_DOC_PREFIX}${name}`;
/** The app component a document is the tree of; null for a page or a canvas. */
export const componentOfDoc = (doc: string): string | null =>
  doc.startsWith(COMPONENT_DOC_PREFIX)
    ? doc.slice(COMPONENT_DOC_PREFIX.length)
    : null;
