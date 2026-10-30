import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import {
  targetsOf,
  type UsageKind,
} from "@ultrapaint/contracts/design-system-setup";
import {
  SPACING_STEPS,
  spacingStepName,
} from "@ultrapaint/contracts/token-table";

/**
 * What a value of a kind may become, as Map offers it: the targets the server accepts, with the
 * named steps of the spacing scale listed for a length before the spacing tokens. Before there is
 * a design system, nothing has somewhere to go.
 */
export const mapTargetsOf = (
  kind: UsageKind,
  ds: DesignSystem | null
): readonly string[] => {
  if (!ds) {
    return [];
  }
  const targets = targetsOf(kind, ds);
  return kind === "spacing"
    ? [...SPACING_STEPS.map(spacingStepName), ...targets]
    : targets;
};
