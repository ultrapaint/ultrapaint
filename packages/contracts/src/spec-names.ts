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
/** What an instance of one of the editor's system components names as `from` (ADR 0040, 0041). */
export const SYSTEM_FROM = "@ultrapaint/system";
/** What a system component's instance named as `from` before ADR 0041: the migration renames it. */
export const LEGACY_SYSTEM_FROM = "@ultrapaint/primitives";
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
