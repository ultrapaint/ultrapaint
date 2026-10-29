/**
 * What the design draws every frame with (ADRs 0028, 0040, 0041): every token's value, in every
 * theme, and the project's components. A frame is told it with every render; a preview draws
 * again when it changes.
 */
import type { ComponentFile } from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { designTokenCss } from "@ultrapaint/design-document/tokens";
import { useMemo } from "react";
import { useComponents } from "./components.ts";
import { useDesignSystem } from "./design-system.ts";

export interface DesignLook {
  readonly components: readonly ComponentFile[];
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
  components: useComponents.getState().components,
  styles: tokenCssOf(useDesignSystem.getState().designSystem),
});

/** The look as it changes: a new one only when the components or the design system do. */
export const useDesignLook = (): DesignLook => {
  const designSystem = useDesignSystem((s) => s.designSystem);
  const components = useComponents((s) => s.components);
  return useMemo(
    () => ({ components, styles: tokenCssOf(designSystem) }),
    [components, designSystem]
  );
};
