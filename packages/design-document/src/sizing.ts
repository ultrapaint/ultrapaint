/**
 * Where `fill` cannot take effect. `fill` takes the room its parent leaves (`css.ts`), and a
 * parent whose size along that axis follows its content leaves none: a column that hugs its
 * children has no room for one to grow into, and a group whose height is its content's gives a
 * child's `100%` nothing to be a percentage of. The canvas draws such a node at its content's
 * size, and so does the code, so neither says anything; this does, the way a design tool will
 * not offer "Fill" inside a parent that hugs.
 *
 * The rules are the browser's, as far as they can be read off the document: a parent sized in
 * pixels, set to fill, or stretched across a row has a size of its own; one that hugs, or is
 * left to its content, does not. A node inside an instance is judged by the layout the preview
 * saw the component use, and left alone when that is not known.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { InstanceDrawn } from "@ultrapaint/contracts/preview";
import { layoutOf, type ParentLayout } from "./css.ts";
import { CANVAS_ROOT_ID, childrenOf } from "./tree.ts";

export type Axis = "width" | "height";

export interface FillWarning {
  readonly axis: Axis;
  readonly message: string;
  readonly nodeId: string;
}

/** How a node lays out its children, or null when that is not known. */
const layoutFor = (
  node: DesignNode,
  instances: Readonly<Record<string, InstanceDrawn>>
): ParentLayout | null => {
  if (node.id === CANVAS_ROOT_ID) {
    // The canvas's loose nodes are each drawn on their own.
    return "free";
  }
  if (node.type === "instance") {
    return instances[node.id]?.layout ?? null;
  }
  return layoutOf(node);
};

/**
 * Whether a node's size along an axis follows its content, given how its own parent lays it out
 * (`outer`) and that parent's cross alignment.
 */
const followsContent = (
  node: DesignNode,
  axis: Axis,
  outer: ParentLayout | null,
  outerNode: DesignNode | null
): boolean => {
  const size = node[axis];
  if (size === "hug") {
    return true;
  }
  if (size !== undefined || node.type === "page" || outer === null) {
    return false;
  }
  const crossAlign =
    outerNode && "crossAlign" in outerNode ? outerNode.crossAlign : undefined;
  const wraps = Boolean(outerNode && "wrap" in outerNode && outerNode.wrap);
  const stretched =
    (crossAlign === undefined || crossAlign === "stretch") && !wraps;
  if (axis === "width") {
    // A block takes the width it is given; a flex item along a row takes its content's.
    if (outer === "row" || outer === "free") {
      return true;
    }
    return outer === "column" ? !stretched : false;
  }
  // Heights are the content's, except where a row stretches its items across.
  return !(outer === "row" && stretched);
};

const LABEL: Record<string, string> = {
  column: "column",
  group: "group",
  instance: "component",
  page: "page",
  row: "row",
};

/** Where a node sits: how its parent lays it out, and the parent. */
interface Place {
  readonly outer: ParentLayout | null;
  readonly outerNode: DesignNode | null;
}

/** Why a child's `fill` along an axis has no room in the parent, or null when it has. */
const fillProblem = (
  parent: DesignNode,
  layout: ParentLayout,
  place: Place,
  axis: Axis
): string | null => {
  const main =
    (layout === "row" && axis === "width") ||
    (layout === "column" && axis === "height");
  // Across a row or a column, fill stretches to the line, which is always there.
  if (layout !== "block" && !main) {
    return null;
  }
  if (!followsContent(parent, axis, place.outer, place.outerNode)) {
    return null;
  }
  // A minimum gives a flexbox room to share out, though not a percentage a base.
  const min = axis === "width" ? parent.minWidth : parent.minHeight;
  if (main && min !== undefined) {
    return null;
  }
  const what = LABEL[parent.type] ?? parent.type;
  return main
    ? `Fill ${axis} takes the room the ${what} leaves, and it leaves none: its ${axis} follows its content. Give the ${what} a ${axis}, or make it fill.`
    : `Fill ${axis} does nothing here: the ${what}'s ${axis} follows its content. Give the ${what} a ${axis}, make it fill, or make it a ${axis === "height" ? "column" : "row"}.`;
};

/** Every node under the root whose `fill` has no room to take, with why. */
export const fillWarnings = (
  root: DesignNode,
  instances: Readonly<Record<string, InstanceDrawn>> = {}
): FillWarning[] => {
  const out: FillWarning[] = [];
  const visit = (node: DesignNode, place: Place) => {
    const layout = layoutFor(node, instances);
    for (const child of childrenOf(node)) {
      for (const axis of ["width", "height"] as const) {
        const message =
          child[axis] === "fill" && layout !== null && layout !== "free"
            ? fillProblem(node, layout, place, axis)
            : null;
        if (message !== null) {
          out.push({ axis, message, nodeId: child.id });
        }
      }
      visit(child, { outer: layout, outerNode: node });
    }
  };
  visit(root, {
    outer: root.id === CANVAS_ROOT_ID ? null : "free",
    outerNode: null,
  });
  return out;
};
