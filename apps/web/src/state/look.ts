/**
 * What the design draws every frame with (ADR 0028, 0029, 0040): every token's value, in every
 * theme, and the component specs. A frame is told it with every render; a preview draws again
 * when it changes.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";
import { designTokenCss } from "@ultrapaint/design-document/tokens";
import { useMemo } from "react";
import { useDesignSystem } from "./design-system.ts";
import { useSpecs } from "./specs.ts";

export interface DesignLook {
  readonly specs: readonly ComponentSpec[];
  readonly styles: string;
}

/** The token CSS of the last design system asked for, kept while it is the same object. */
let memo: { readonly ds: DesignSystem | null; readonly css: string } | null =
  null;
const tokenCssOf = (ds: DesignSystem | null): string => {
  if (memo?.ds !== ds) {
    memo = { css: designTokenCss(ds), ds };
  }
  return memo.css;
};

/** The look as it is now; a frame is told it with every render that does not give its own. */
export const designLook = (): DesignLook => ({
  specs: useSpecs.getState().specs,
  styles: tokenCssOf(useDesignSystem.getState().designSystem),
});

/** The look as it changes: a new one only when the specs or the design system do. */
export const useDesignLook = (): DesignLook => {
  const designSystem = useDesignSystem((s) => s.designSystem);
  const specs = useSpecs((s) => s.specs);
  return useMemo(
    () => ({ specs, styles: tokenCssOf(designSystem) }),
    [specs, designSystem]
  );
};
