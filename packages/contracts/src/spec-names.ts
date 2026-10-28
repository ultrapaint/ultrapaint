/**
 * The names of component specs (ADR 0029) that what draws them needs, apart from their schemas:
 * the preview's renderer imports these, and with them it would load Effect's Schema, most of
 * what it downloads and parses in every preview.
 */

/** Where specs live, inside the designs directory. */
export const SPECS_DIR = "specs";
export const SPEC_EXTENSION = ".spec.json";
/** What a draft component's instances name as `from`. */
export const DRAFT_FROM = "#draft";
/** What the editor's own primitives' instances name as `from` (ADR 0040). */
export const PRIMITIVES_FROM = "@ultrapaint/primitives";
/** The slot every spec has: the element the component renders at its root. */
export const ROOT_SLOT = "root";
/** The states a spec can style. */
export const SPEC_STATES = [
  "hover",
  "focus",
  "active",
  "disabled",
  "open",
  "checked",
  "invalid",
] as const;
