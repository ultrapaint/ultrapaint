/**
 * A frame as a few lines of text, for an agent: the layers, their layout, their text, and the
 * instances of Figma components, named — which is what the mapping is about. Far cheaper to
 * read than the converted document, and it shows the components before they are replaced.
 */
import { nodeId } from "openfig-core";
import type { FigFile, FigNode } from "./fig.ts";
import { solidColor } from "./paint.ts";
import { isShape, isVectorOnly } from "./svg.ts";

const MAX_LINES = 400;
const MAX_DEPTH = 8;
const QUOTE_LIMIT = 60;
const SPACES_RE = /\s+/g;

const round = (value: number) => Math.round(value);

const sizeOf = (node: FigNode) =>
  node.size ? `${round(node.size.x)}×${round(node.size.y)}` : "";

const kindOf = (node: FigNode) => {
  switch (node.stackMode) {
    case "HORIZONTAL":
      return "row";
    case "VERTICAL":
      return "column";
    case "GRID":
      return "grid";
    default:
      return "group";
  }
};

const layoutOf = (node: FigNode) => {
  const parts: string[] = [];
  if (node.stackSpacing) {
    parts.push(`gap=${round(node.stackSpacing)}`);
  }
  const padding = node.stackHorizontalPadding ?? node.stackPadding;
  if (padding) {
    parts.push(`padding=${round(padding)}`);
  }
  return parts.join(" ");
};

const styleOf = (node: FigNode) => {
  const parts: string[] = [];
  const fill = solidColor(node.fillPaints);
  if (fill !== undefined) {
    parts.push(`fill=${fill}`);
  }
  if (node.cornerRadius) {
    parts.push(`radius=${round(node.cornerRadius)}`);
  }
  return parts.join(" ");
};

const quote = (text: string) => {
  const flat = text.replace(SPACES_RE, " ").trim();
  return `"${flat.length > QUOTE_LIMIT ? `${flat.slice(0, QUOTE_LIMIT - 3)}…` : flat}"`;
};

const propsOf = (values: Readonly<Record<string, string | boolean>>) => {
  const entries = Object.entries(values);
  return entries.length === 0
    ? ""
    : ` [${entries.map(([name, value]) => `${name}=${String(value)}`).join(", ")}]`;
};

const words = (...parts: readonly string[]) => parts.filter(Boolean).join(" ");

const textLine = (node: FigNode) => {
  const font = words(
    node.fontSize === undefined ? "" : `${round(node.fontSize)}px`,
    node.fontName?.family ?? "",
    node.fontName?.style ?? ""
  );
  const color = solidColor(node.fillPaints);
  return words(
    `text ${quote(String(node.textData?.characters ?? ""))}`,
    font,
    color === undefined ? "" : `color=${color}`
  );
};

const instanceLine = (
  file: FigFile,
  node: FigNode,
  mapped: ReadonlySet<string>
) => {
  const component = file.componentOf(node);
  const symbolId = node.symbolData?.symbolID;
  const symbol = symbolId
    ? file.node(`${symbolId.sessionID}:${symbolId.localID}`)
    : undefined;
  const variant = symbol ? file.variantOf(symbol) : {};
  let state = "not in the file";
  if (component) {
    state = mapped.has(component.key) ? "mapped" : "unmapped";
  }
  return `instance ${quote(component?.key ?? node.name)}${propsOf(variant)} ${sizeOf(node)} (${state})`;
};

/** The line for a node that has no children of its own to list, or null for a container. */
const leafLine = (
  file: FigFile,
  node: FigNode,
  mapped: ReadonlySet<string>
): string | null => {
  if (node.type === "TEXT") {
    return textLine(node);
  }
  if (node.type === "INSTANCE") {
    return instanceLine(file, node, mapped);
  }
  if (isShape(node) && file.childrenOf(nodeId(node) ?? "").length === 0) {
    return words(
      `${node.type.toLowerCase()} ${quote(node.name)} ${sizeOf(node)}`,
      styleOf(node)
    );
  }
  if (isVectorOnly(file, node)) {
    return `icon ${quote(node.name)} ${sizeOf(node)}`;
  }
  return null;
};

/** The lines of a node and everything under it. */
export const outlineOf = (
  file: FigFile,
  node: FigNode,
  /** Which mapped components are known, so the outline can say so. */
  mapped: ReadonlySet<string> = new Set()
): string => {
  const lines: string[] = [];
  let cut = false;
  const visit = (current: FigNode, depth: number) => {
    if (lines.length >= MAX_LINES) {
      cut = true;
      return;
    }
    if (current.visible === false) {
      return;
    }
    const indent = "  ".repeat(depth);
    const leaf = leafLine(file, current, mapped);
    if (leaf !== null) {
      lines.push(indent + leaf);
      return;
    }
    lines.push(
      indent +
        words(
          `${kindOf(current)} ${quote(current.name)} ${sizeOf(current)}`,
          layoutOf(current),
          styleOf(current)
        )
    );
    if (depth >= MAX_DEPTH) {
      lines.push(`${indent}  …`);
      return;
    }
    for (const child of file.childrenOf(nodeId(current) ?? "")) {
      visit(child, depth + 1);
    }
  };
  visit(node, 0);
  if (cut) {
    lines.push("… (cut: the frame has more layers than shown)");
  }
  return lines.join("\n");
};
