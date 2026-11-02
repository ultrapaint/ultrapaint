import type { DesignNode } from "@ultrapaint/contracts/document";

/**
 * What a selection is, which decides its colour: a component of the library (purple), or a plain
 * element (blue). The agents' pink is not a selection's: it is their work on it.
 */
type SelectionKind = "component" | "element";

export const selectionKindOf = (node: DesignNode | null): SelectionKind =>
  node?.type === "instance" ? "component" : "element";

/** The CSS colour of a kind, from the theme's `--selection` and `--component`. */
export const kindColor = (kind: SelectionKind): string =>
  kind === "component" ? "var(--component)" : "var(--selection)";

/** The same colour, faded for a hover. */
export const kindHoverColor = (kind: SelectionKind): string =>
  `color-mix(in srgb, ${kindColor(kind)} 60%, transparent)`;
