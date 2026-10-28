import { SPACING_STEPS } from "@ultrapaint/contracts/token-table";

/**
 * The named steps of the spacing scale the canvas toolbar has room for: every whole step to 6,
 * then every other one to 12. The inspector offers them all (contracts' `SPACING_STEPS`).
 */
export const TOOLBAR_SPACING: readonly number[] = SPACING_STEPS.filter(
  (step) =>
    Number.isInteger(step) && (step <= 6 || (step <= 12 && step % 2 === 0))
);
