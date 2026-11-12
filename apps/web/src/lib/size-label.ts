/** The size the canvas says under a selection (ADR 0086), named as the inspector names sizes. */
import type { DesignNode } from "@ultrapaint/contracts/document";

/** One axis of a size as the inspector names it: fixed pixels bare, else Fill or Hug after them. */
const axisLabel = (px: number, size: DesignNode["width"]) => {
  const value = Math.round(px);
  if (size === "fill") {
    return `${value} Fill`;
  }
  return size === "hug" ? `${value} Hug` : `${value}`;
};

/** "52 Hug × 15 Hug", "1440 × 900": the size under the selection. */
export const sizeLabel = (
  rect: { height: number; width: number },
  node?: Pick<DesignNode, "height" | "width"> | null
) =>
  `${axisLabel(rect.width, node?.width)} × ${axisLabel(rect.height, node?.height)}`;
