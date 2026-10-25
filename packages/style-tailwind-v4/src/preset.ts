/**
 * The Tailwind v4 style system (ADR 0024): tokens in the `@theme` of the stylesheets the preview
 * imports, classes in the code. The server reaches all of it through the `StyleSystem`
 * interface and never imports another module of this package.
 */
import type { StyleSystem } from "@ultrapaint/framework-api/node";
import { codeRules } from "./code-rules.ts";
import { componentSpec } from "./component-spec.ts";
import { componentStyle } from "./component-style.ts";
import { scanDesignSystem } from "./design-system-scan.ts";
import { detectStyles } from "./detect.ts";
import { tailwindClasses } from "./node-classes.ts";
import { previewCss } from "./preview-css.ts";
import { previewTokenCss } from "./preview-tokens.ts";
import { readTokens, writeTokens } from "./tokens.ts";
import { usage } from "./usage-rewrite.ts";

export const styleSystem: StyleSystem = {
  codeRules,
  componentSpec,
  componentStyle,
  detect: detectStyles,
  id: "tailwind-v4",
  nodeClasses: tailwindClasses,
  previewCss,
  previewTokenCss,
  readTokens,
  scan: scanDesignSystem,
  usage,
  writeTokens,
};
