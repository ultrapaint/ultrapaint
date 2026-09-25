/**
 * The JSX of a file as the source has it, asked of the server once per version of the file. The
 * rendered tree says what is inside what on screen; only the source says whether an element is
 * the inside of a component or a child its instance was given, and where among its siblings it
 * is written.
 */
import type { SourceLocation } from "@ultrapaint/contracts/base";
import type { SourceOutline } from "@ultrapaint/contracts/edit";
import type { TreeNode } from "@ultrapaint/contracts/preview";
import { api } from "../state/connection.ts";

const cache = new Map<string, Promise<SourceOutline | null>>();
let watching = false;

export const outlineOf = (file: string): Promise<SourceOutline | null> => {
  if (!watching) {
    watching = true;
    api().on("file.changed", ({ file: changed }) => cache.delete(changed));
  }
  let outline = cache.get(file);
  if (!outline) {
    outline = api()
      .request("source.outline", { file })
      .catch(() => {
        cache.delete(file);
        return null;
      });
    cache.set(file, outline);
  }
  return outline;
};

export const indexAt = (outline: SourceOutline, loc: SourceLocation) =>
  outline.elements.findIndex((e) => e.line === loc.line && e.col === loc.col);

export const locationAt = (
  outline: SourceOutline,
  file: string,
  index: number
): SourceLocation | null => {
  const e = outline.elements[index];
  return e ? { col: e.col, file, line: e.line } : null;
};

/** The elements written directly inside the element at `index`, in order. */
export const childrenAt = (outline: SourceOutline, index: number) =>
  outline.elements.flatMap((e, i) =>
    e.parent === index && e.direct ? [i] : []
  );

const same = (a: SourceLocation | null, b: SourceLocation) =>
  !!a && a.file === b.file && a.line === b.line && a.col === b.col;

/** The first node under `root` rendered from `loc`, if any is on screen. */
export const renderedFrom = (
  root: TreeNode,
  loc: SourceLocation
): TreeNode | null => {
  for (const c of root.children) {
    if (same(c.source, loc)) {
      return c;
    }
    const deeper = renderedFrom(c, loc);
    if (deeper) {
      return deeper;
    }
  }
  return null;
};

/** The nearest node on the way up to `path`'s last one that was rendered from `loc`. */
export const ancestorFrom = (
  path: readonly TreeNode[],
  loc: SourceLocation
): TreeNode | null =>
  path.slice(0, -1).findLast((n) => same(n.source, loc)) ?? null;
