/**
 * What the design draws over the code in every preview (ADR 0028, 0029): the tokens' values
 * where they differ from the code's, and the component specs. A frame is told it with every
 * render; a preview draws again when it changes.
 */
import type { ComponentSpec } from "@ultrapaint/contracts/specs";
import { useMemo } from "react";
import { useDesignSystem } from "./design-system.ts";
import { useSpecs } from "./specs.ts";

export interface DesignLook {
  readonly specs: readonly ComponentSpec[];
  readonly styles: string;
}

/** The look as it is now; a frame is told it with every render that does not give its own. */
export const designLook = (): DesignLook => ({
  specs: useSpecs.getState().specs,
  styles: useDesignSystem.getState().previewCss ?? "",
});

/** The look as it changes: a new one only when the specs or the styles do. */
export const useDesignLook = (): DesignLook => {
  const styles = useDesignSystem((s) => s.previewCss ?? "");
  const specs = useSpecs((s) => s.specs);
  return useMemo(() => ({ specs, styles }), [specs, styles]);
};
