import type { DesignNode } from "@ultrapaint/contracts/document";
import { isInstanceLayer } from "@ultrapaint/design-document/instance-layers";

/**
 * What a selection is, which decides its colour: a component of the library (purple), or a plain
 * element (blue). The agents' pink is not a selection's: it is their work on it.
 */
type SelectionKind = "component" | "element";

/**
 * A node's kind: an instance, a layer of one (ADR 0114), or any node of a main component edited
 * in place (`inMain`, ADR 0120) is a component's; anything else an element.
 */
export const selectionKindOf = (
  node: DesignNode | null,
  inMain = false
): SelectionKind =>
  node?.type === "instance" ||
  (node !== null && (inMain || isInstanceLayer(node.id)))
    ? "component"
    : "element";

/** The CSS colour of a kind, from the theme's `--selection` and `--component`. */
export const kindColor = (kind: SelectionKind): string =>
  kind === "component" ? "var(--component)" : "var(--selection)";
