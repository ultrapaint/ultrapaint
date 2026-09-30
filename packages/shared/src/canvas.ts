/**
 * Which canvas a file in the designs directory belongs to. A directory holding a `canvas.json`
 * is a canvas; while there is none below the designs directory it is itself the one canvas,
 * which is what lets a repository open before anything was saved. The server and the preview
 * both answer this question, about the same tree, and must answer it the same way.
 */
import { dirname, toPosix } from "./path.ts";

export const CANVAS_FILE = "canvas.json";
/** The order the canvases are listed in, at the root of the designs directory. */
export const CANVASES_FILE = "canvases.json";
export const ROOT_CANVAS = "";

/** Canvas ids from the paths of the `canvas.json` files, all relative to the designs directory. */
export const canvasIdsFrom = (configPaths: readonly string[]): string[] =>
  configPaths
    .map((p) => dirname(toPosix(p)))
    .sort((a, b) => a.localeCompare(b));

const inCanvas = (id: string, path: string) =>
  id === ROOT_CANVAS || path === id || path.startsWith(`${id}/`);

/** The canvas a designs-relative path belongs to, or null when no canvas holds it. */
export const canvasIdOf = (
  canvasIds: readonly string[],
  path: string
): string | null => {
  const posix = toPosix(path);
  if (canvasIds.length === 0) {
    return ROOT_CANVAS;
  }
  let best: string | null = null;
  for (const id of canvasIds) {
    if (inCanvas(id, posix) && (best === null || id.length > best.length)) {
      best = id;
    }
  }
  return best;
};

/** The path of a file inside its canvas. */
export const pathInCanvas = (canvasId: string, path: string): string => {
  const posix = toPosix(path);
  return canvasId === ROOT_CANVAS ? posix : posix.slice(canvasId.length + 1);
};

/**
 * Canvases in the order they are listed: the order `canvases.json` gives, then the ones it does
 * not name, by id. An id it names that is gone is skipped.
 */
export const orderCanvases = <T extends { readonly id: string }>(
  canvases: readonly T[],
  order: readonly string[]
): T[] => {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...canvases].sort((a, b) => {
    const left = rank.get(a.id) ?? Number.POSITIVE_INFINITY;
    const right = rank.get(b.id) ?? Number.POSITIVE_INFINITY;
    return left === right ? a.id.localeCompare(b.id) : left - right;
  });
};
