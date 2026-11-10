/**
 * axe-core's measurements beside the lab's own checks (`measure --axe`): its contrast and
 * target-size rules, for the ratio and the size it measured at each node. It is the lab's
 * second opinion on what `@ultrapaint/design-checks` computes for itself, and a dependency of
 * the lab alone (MPL-2.0).
 */
import { createRequire } from "node:module";
import { Predicate } from "effect";
import type { AxeNode } from "./in-page.ts";

/** axe-core's script, as a page loads it. */
export const AXE_SOURCE = createRequire(import.meta.url).resolve(
  "axe-core/axe.min.js"
);

export interface AxeFinding {
  /** Whether axe is sure of it; an unsure one is for a person or a reviewer to confirm. */
  readonly certain: boolean;
  /** What it measured, with what it expected. */
  readonly detail: string;
  /** The node's selector. */
  readonly label: string;
  readonly rule: "color-contrast" | "target-size";
  /** The contrast ratio, or the target's smaller side in CSS pixels; 0 when axe measured none. */
  readonly value: number;
}

const numberAt = (data: AxeNode["data"], key: string) => {
  const value = data?.[key];
  return Predicate.isNumber(value) ? value : undefined;
};
const textAt = (data: AxeNode["data"], key: string) => {
  const value = data?.[key];
  return Predicate.isString(value) ? value : undefined;
};

/** What axe reported, as findings with the measured value first. */
export const axeFindings = (nodes: readonly AxeNode[]): readonly AxeFinding[] =>
  nodes.flatMap((node): AxeFinding[] => {
    if (node.rule === "color-contrast") {
      const ratio = numberAt(node.data, "contrastRatio");
      const colours = [
        textAt(node.data, "fgColor"),
        textAt(node.data, "bgColor"),
      ]
        .filter(Predicate.isNotUndefined)
        .join(" on ");
      return [
        {
          certain: node.certain,
          detail:
            ratio === undefined
              ? "contrast not measured (a gradient or an image behind the text)"
              : `${ratio}:1${colours ? `, ${colours}` : ""}, under ${textAt(node.data, "expectedContrastRatio") ?? "4.5:1"}`,
          label: node.target,
          rule: "color-contrast",
          value: ratio ?? 0,
        },
      ];
    }
    if (node.rule === "target-size") {
      const width = numberAt(node.data, "width");
      const height = numberAt(node.data, "height");
      const min = numberAt(node.data, "minSize") ?? 24;
      return [
        {
          certain: node.certain,
          detail:
            width === undefined || height === undefined
              ? `a target axe could not size, under ${min}px`
              : `${Math.round(width)}×${Math.round(height)}px, under ${min}×${min}`,
          label: node.target,
          rule: "target-size",
          value: Math.min(width ?? 0, height ?? 0),
        },
      ];
    }
    return [];
  });
