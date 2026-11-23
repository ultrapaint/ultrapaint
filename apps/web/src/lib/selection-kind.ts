import type { DesignNode } from "@ultrapaint/contracts/document";
import { isInstanceLayer } from "@ultrapaint/design-document/instance-layers";

/**
 * What a selection is, which decides its colour: a component of the library (purple), or a plain
 * element (blue). The agents' pink is not a selection's: it is their work on it.
 */
type SelectionKind = "component" | "element";

export const selectionKindOf = (node: DesignNode | null): SelectionKind =>
  node?.type === "instance" || (node !== null && isInstanceLayer(node.id))
    ? "component"
    : "element";

/** The CSS colour of a kind, from the theme's `--selection` and `--component`. */
export const kindColor = (kind: SelectionKind): string =>
  kind === "component" ? "var(--component)" : "var(--selection)";
