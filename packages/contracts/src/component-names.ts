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
/** What a system component's instance named as `from` before ADR 0041: the migration renames it. */
export const LEGACY_SYSTEM_FROM = "@ultrapaint/primitives";
/** What a draft component's instance named as `from` before ADR 0041: an app component's now. */
export const LEGACY_DRAFT_FROM = "#draft";
/** Where specs and drafts were kept before ADR 0041, inside the designs directory. */
export const LEGACY_SPECS_DIR = "specs";
export const LEGACY_SPEC_EXTENSION = ".spec.json";
/** The part every system component has: the element it renders at its root. */
export const ROOT_SLOT = "root";
/** The states a system component's look can be given for. */
export const COMPONENT_STATES = [
  "hover",
  "focus",
  "active",
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
