/**
 * The design's look (ADRs 0028, 0041, 0042): every token's value in every theme, and the
 * project's components. Its stylesheet is made once per change of the design system or the
 * components and set on the preview (`followLook`), which writes it for every frame; a frame that
 * draws another look (a component's unsaved one) is given its own with its render.
 */
import type { ComponentFile } from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { Look, Preview } from "@ultrapaint/framework-api/browser";
import { designCss } from "@ultrapaint/system-components/look";
import { useMemo } from "react";
import { useComponents } from "./components.ts";
import { useDesignSystem } from "./design-system.ts";

/** The look of the last components and design system asked for, kept while they are the same. */
let memo: {
  readonly components: readonly ComponentFile[];
  readonly ds: DesignSystem | null;
  readonly look: Look;
} | null = null;

/** The look of these components in this design system: the same object for the same two. */
const lookOf = (
  components: readonly ComponentFile[],
  ds: DesignSystem | null
): Look => {
  if (memo?.components !== components || memo.ds !== ds) {
    memo = {
      components,
      ds,
      look: { components, css: designCss(components, ds) },
    };
  }
  return memo.look;
};

/** The look as it is now. */
const designLook = (): Look =>
  lookOf(
    useComponents.getState().components,
    useDesignSystem.getState().designSystem
  );

/** Sets the look on `preview` now and whenever it changes; answers the function that stops it. */
export const followLook = (preview: Preview): (() => void) => {
  preview.setLook(designLook());
  const changed = () => preview.setLook(designLook());
  const stops = [
    useComponents.subscribe((now, before) => {
      if (now.components !== before.components) {
        changed();
      }
    }),
    useDesignSystem.subscribe((now, before) => {
      if (now.designSystem !== before.designSystem) {
        changed();
      }
    }),
  ];
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
};

/** The look as it changes: a new one only when the components or the design system do. */
export const useDesignLook = (): Look => {
  const designSystem = useDesignSystem((s) => s.designSystem);
  const components = useComponents((s) => s.components);
  return useMemo(
    () => lookOf(components, designSystem),
    [components, designSystem]
  );
};
