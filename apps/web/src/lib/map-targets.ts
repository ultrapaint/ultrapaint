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
 * a design system, only a plain element has somewhere to go: the library's components.
 */
export const mapTargetsOf = (
  kind: UsageKind,
  ds: DesignSystem | null,
  components: readonly string[]
): readonly string[] => {
  if (!ds) {
    return kind === "element" ? components : [];
  }
  const targets = targetsOf(kind, ds, components);
  return kind === "spacing"
    ? [...SPACING_STEPS.map(spacingStepName), ...targets]
    : targets;
};
