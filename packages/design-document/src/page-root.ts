/**
 * A page's root as the screen's own container (ADR 0075): a row or a column, its fill, padding,
 * gap and alignment, so nothing has to sit between it and the content. A root with one row or
 * column filling it is a wrapper the page does not need: `foldOps` folds that child into the root,
 * as one update of the root and one unwrap of the child, and `wrapperOf` names it, for the warning
 * an agent is given.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";

/** The root's own fields a fold leaves as they are, which the child's do not have to agree with. */
const ROOT_KEEPS = new Set(["children", "fill", "gap", "id", "name", "type"]);

/** The child's fields the root takes over; any other the child sets keeps it from folding. */
const CHILD_GIVES = new Set([
  "align",
  "children",
  "crossAlign",
  "fill",
  "gap",
  "height",
  "id",
  "name",
  "padding",
  "type",
  "width",
  "wrap",
]);

/** A breakpoint's fields of the child the root can take, `type` becoming `direction`. */
const AT_GIVES = new Set([
  "align",
  "crossAlign",
  "fill",
  "gap",
  "padding",
  "type",
  "wrap",
]);

type Fields = Record<string, JsonValue>;

const isStack = (
  node: DesignNode
): node is Extract<DesignNode, { type: "row" | "column" }> =>
  node.type === "row" || node.type === "column";

/**
 * The row or column a root holds alone and that fills it: as wide as the page, as tall as the
 * screen or left to its content; null when the root holds anything else, or its own layout.
 */
export const wrapperOf = (root: DesignNode): DesignNode | null => {
  if (root.type !== "page" || root.children.length !== 1) {
    return null;
  }
  const [child] = root.children;
  if (!(child && isStack(child))) {
    return null;
  }
  const ownKeys = Object.keys(root).filter((k) => !ROOT_KEEPS.has(k));
  const childKeys = Object.keys(child).filter(
    (k) => !(CHILD_GIVES.has(k) || k === "at")
  );
  const wide = child.width === undefined || child.width === "fill";
  return ownKeys.length === 0 && childKeys.length === 0 && wide ? child : null;
};

/** The child's breakpoints as the root's: its type as the root's direction. */
const atOf = (child: DesignNode): Fields | null => {
  const at = (child.at ?? {}) as Record<string, Fields>;
  const out: Record<string, Fields> = {};
  for (const [name, over] of Object.entries(at)) {
    const fields: Fields = {};
    for (const [key, value] of Object.entries(over)) {
      if (!AT_GIVES.has(key)) {
        return null;
      }
      fields[key === "type" ? "direction" : key] = value;
    }
    out[name] = fields;
  }
  return out;
};

/**
 * The operations that fold a page's wrapper into its root, or null when it has none or folding it
 * would lose something. The child's fields win where it sets them; its type becomes the root's
 * direction; a height of the screen's (`screenHeight`, the frame's) or `fill` goes, the root being
 * at least the screen already, and any other height stays as the root's minimum. A row as tall as
 * its content does not fold: on the screen-tall root its children would stretch to the screen.
 */
export const foldOps = (
  root: DesignNode,
  screenHeight?: number
): DocOp[] | null => {
  const child = wrapperOf(root);
  if (!child) {
    return null;
  }
  const at = atOf(child);
  const hugs = child.height === undefined || child.height === "hug";
  // A row as tall as its content, folded, would stretch its children to the screen.
  if (at === null || (hugs && child.type === "row")) {
    return null;
  }
  const own = child as unknown as Fields;
  const set: Record<string, JsonValue> = {
    direction: child.type === "row" ? "row" : null,
  };
  for (const key of ["align", "crossAlign", "gap", "padding", "wrap"]) {
    set[key] = own[key] ?? null;
  }
  // A column as tall as its content had no room to align it in; the screen-tall root would.
  if (hugs) {
    set.align = null;
  }
  if (child.fill !== undefined) {
    set.fill = child.fill;
  }
  if (typeof child.height === "number" && child.height !== screenHeight) {
    set.minHeight = child.height;
  }
  if (Object.keys(at).length > 0) {
    set.at = at;
  }
  return [
    { id: root.id, op: "update", set },
    { id: child.id, op: "unwrap" },
  ];
};

/** What an agent is told of a page left with a wrapper that folds. */
export const wrapperWarning = (root: DesignNode): string | null => {
  const child = foldOps(root) === null ? null : wrapperOf(root);
  return child
    ? `${child.id}: the page is the screen's container. Put this ${child.type}'s layout on the page (direction, padding, gap, align, fill) and unwrap it.`
    : null;
};
