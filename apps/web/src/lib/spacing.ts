/**
 * The steps of Tailwind v4's spacing scale that have a name of their own (`p-4`, `gap-0.5`),
 * each a multiple of the design system's `--spacing`. Tailwind takes any multiple; these are
 * the ones a designer is offered, the same wherever a spacing is picked.
 */
export const SPACING_SCALE: readonly number[] = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24,
  28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96,
];

/**
 * The few of them the canvas toolbar has room for: every whole step to 6, then every other one
 * to 12. The inspector offers the whole scale.
 */
export const TOOLBAR_SPACING: readonly number[] = SPACING_SCALE.filter(
  (step) =>
    Number.isInteger(step) && (step <= 6 || (step <= 12 && step % 2 === 0))
);
