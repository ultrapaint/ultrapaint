/**
 * Markup on the clipboard, read as layers in the paste's order ADR 0148 gives: image files left to
 * the canvas, then `text/plain` that is markup, then `text/html`; JSX and a code editor's
 * highlighting make none. The classes are read as Tailwind's whatever the project's style system.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { childrenOf } from "@ultrapaint/design-document/tree";
import {
  convertHtml,
  type HtmlConversion,
} from "@ultrapaint/html-import/convert";
import { isJsx } from "@ultrapaint/html-import/jsx";
import { tailwindClassReader } from "@ultrapaint/style-tailwind-v4/class-reader";
import { imageFiles } from "../canvas/items.ts";

/** What a paste holds of markup: layers made of it, or JSX, which makes none. */
export type PastedMarkup =
  | { readonly conversion: HtmlConversion; readonly kind: "layers" }
  | { readonly kind: "jsx" };

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

/** What a clipboard's HTML holds besides what it shows: a code editor's `<meta charset>`. */
const UNSHOWN = new Set(["META", "LINK", "STYLE", "SCRIPT"]);

/**
 * A code editor's highlighting of code: every block it shows keeps the code's spaces and lines,
 * as VS Code's `white-space: pre` and JetBrains' `<pre>` do.
 */
const isHighlighting = (parsed: Document) => {
  const blocks = [...parsed.body.children].filter(
    (block) => !UNSHOWN.has(block.tagName)
  );
  return (
    blocks.length > 0 &&
    blocks.every(
      (block) =>
        block.tagName === "PRE" ||
        (block as HTMLElement).style.whiteSpace === "pre"
    )
  );
};

export const markupOn = (
  data: DataTransfer,
  designSystem: DesignSystem | null
): PastedMarkup | null => {
  if (imageFiles(data.files).length > 0) {
    return null;
  }
  const layers = (markup: Document): PastedMarkup => ({
    conversion: convertHtml(markup, {
      classes: tailwindClassReader(designSystem),
      designSystem,
      next: makeIdGenerator(),
    }),
    kind: "layers",
  });
  const plain = data.getData("text/plain").trim();
  if (plain.startsWith("<")) {
    if (isJsx(plain)) {
      return { kind: "jsx" };
    }
    const parsed = parse(plain);
    if (parsed.body.children.length > 0) {
      return layers(parsed);
    }
  }
  const html = data.getData("text/html");
  if (html.trim() === "") {
    return null;
  }
  const parsed = parse(html);
  return isHighlighting(parsed) ? null : layers(parsed);
};

/** How many layers the nodes are, theirs included. */
const layerCount = (nodes: readonly DesignNode[]): number =>
  nodes.reduce((n, node) => n + 1 + layerCount(childrenOf(node)), 0);

/** The toast's title for what was pasted: `Pasted 9 layers`. */
export const pastedTitle = (nodes: readonly DesignNode[]) => {
  const count = layerCount(nodes);
  return count === 1 ? "Pasted 1 layer" : `Pasted ${count} layers`;
};

/** What a paste of markup did not carry, as the toast says it; nothing when it carried all. */
export const notCarried = (warnings: HtmlConversion["warnings"]) =>
  warnings.length === 0
    ? undefined
    : `Not carried: ${warnings.map((w) => w.text).join(", ")}.`;
