/**
 * Vector layers as SVG. The page format has no vectors: an icon drawn with paths, ellipses and
 * rectangles becomes one SVG file and an image node that shows it. A container whose every
 * leaf is a shape is drawn as one picture, which is what an icon component is.
 */
import {
  type FigNode,
  type FigTransform,
  nodeId,
  resolveVectorNodePaths,
} from "openfig-core";
import type { FigFile } from "./fig.ts";
import { cssColor, topPaint } from "./paint.ts";

const SHAPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "REGULAR_POLYGON",
  "LINE",
  "ELLIPSE",
  "RECTANGLE",
  "ROUNDED_RECTANGLE",
]);

const CONTAINERS = new Set(["FRAME", "GROUP", "BOOLEAN_OPERATION"]);

export const isShape = (node: FigNode) => SHAPES.has(node.type);

/** Whether everything drawn under a node is shapes: an icon, not a layout. */
export const isVectorOnly = (file: FigFile, node: FigNode): boolean => {
  const children = file
    .childrenOf(nodeId(node) ?? "")
    .filter((child) => child.visible !== false);
  if (children.length === 0) {
    return isShape(node);
  }
  return (
    CONTAINERS.has(node.type) &&
    children.every(
      (child) =>
        isShape(child) ||
        (CONTAINERS.has(child.type) && isVectorOnly(file, child))
    )
  );
};

const number = (value: number) => String(Math.round(value * 1000) / 1000);

const matrix = (t: FigTransform | undefined) =>
  t &&
  (t.m00 !== 1 ||
    t.m01 !== 0 ||
    t.m10 !== 0 ||
    t.m11 !== 1 ||
    t.m02 !== 0 ||
    t.m12 !== 0)
    ? ` transform="matrix(${[t.m00, t.m10, t.m01, t.m11, t.m02, t.m12].map(number).join(" ")})"`
    : "";

const escapeAttribute = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/** Fill and stroke attributes of a shape, from its topmost solid paints. */
const paintAttributes = (node: FigNode, defaultFill: string) => {
  const fill = topPaint(node.fillPaints, "SOLID");
  const stroke = topPaint(node.strokePaints, "SOLID");
  const fillAttribute = fill?.color
    ? ` fill="${cssColor(fill.color, fill.opacity ?? 1)}"`
    : ` fill="${defaultFill}"`;
  const strokeAttribute =
    stroke?.color && (node.strokeWeight ?? 0) > 0
      ? ` stroke="${cssColor(stroke.color, stroke.opacity ?? 1)}" stroke-width="${number(node.strokeWeight ?? 1)}"`
      : "";
  return fillAttribute + strokeAttribute;
};

const opacityOf = (node: FigNode) =>
  node.opacity !== undefined && node.opacity < 1
    ? ` opacity="${number(node.opacity)}"`
    : "";

/** One shape as SVG elements, in its own coordinates. Null when it cannot be drawn. */
const shapeElements = (file: FigFile, node: FigNode): string | null => {
  const width = node.size?.x ?? 0;
  const height = node.size?.y ?? 0;
  const common = `${matrix(node.transform)}${opacityOf(node)}`;
  const resolved = resolveVectorNodePaths(file.doc, node);
  if (resolved.fill.length > 0 || resolved.stroke.length > 0) {
    // Geometry is what Figma drew, fills and strokes already outlined.
    const fills = resolved.fill.map(
      (path) =>
        `<path d="${escapeAttribute(path.svgPath)}"${paintAttributes(node, "#000")}${path.windingRule === "ODD" ? ' fill-rule="evenodd"' : ""}/>`
    );
    const strokeColor = topPaint(node.strokePaints, "SOLID");
    const strokes = strokeColor?.color
      ? resolved.stroke.map(
          (path) =>
            `<path d="${escapeAttribute(path.svgPath)}" fill="${cssColor(strokeColor.color as NonNullable<typeof strokeColor.color>, strokeColor.opacity ?? 1)}"/>`
        )
      : [];
    return `<g${common}>${[...fills, ...strokes].join("")}</g>`;
  }
  switch (node.type) {
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE": {
      const radius = node.cornerRadius
        ? ` rx="${number(node.cornerRadius)}"`
        : "";
      return `<rect width="${number(width)}" height="${number(height)}"${radius}${paintAttributes(node, "none")}${common}/>`;
    }
    case "ELLIPSE":
      return `<ellipse cx="${number(width / 2)}" cy="${number(height / 2)}" rx="${number(width / 2)}" ry="${number(height / 2)}"${paintAttributes(node, "none")}${common}/>`;
    case "LINE": {
      const stroke = topPaint(node.strokePaints, "SOLID");
      return stroke?.color
        ? `<line x1="0" y1="0" x2="${number(width)}" y2="0" stroke="${cssColor(stroke.color, stroke.opacity ?? 1)}" stroke-width="${number(node.strokeWeight ?? 1)}"${common}/>`
        : "";
    }
    default:
      return null;
  }
};

const elementsOf = (file: FigFile, node: FigNode): string | null => {
  if (isShape(node) && file.childrenOf(nodeId(node) ?? "").length === 0) {
    return shapeElements(file, node);
  }
  const parts: string[] = [];
  for (const child of file.childrenOf(nodeId(node) ?? "")) {
    if (child.visible === false) {
      continue;
    }
    const drawn = elementsOf(file, child);
    if (drawn === null) {
      return null;
    }
    parts.push(drawn);
  }
  return `<g${matrix(node.transform)}${opacityOf(node)}>${parts.join("")}</g>`;
};

/** The node and everything under it as one SVG document, or null when a part cannot be drawn. */
export const svgOf = (file: FigFile, node: FigNode): string | null => {
  const width = node.size?.x ?? 0;
  const height = node.size?.y ?? 0;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const body =
    isShape(node) && file.childrenOf(nodeId(node) ?? "").length === 0
      ? shapeElements(file, { ...node, transform: undefined })
      : (() => {
          const parts: string[] = [];
          for (const child of file.childrenOf(nodeId(node) ?? "")) {
            if (child.visible === false) {
              continue;
            }
            const drawn = elementsOf(file, child);
            if (drawn === null) {
              return null;
            }
            parts.push(drawn);
          }
          return parts.join("");
        })();
  if (body === null) {
    return null;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}">${body}</svg>`;
};
