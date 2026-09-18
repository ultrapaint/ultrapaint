/**
 * Which space a file in the designs directory belongs to. A directory holding a `space.json`
 * is a space; while there is none the designs directory is itself the one space, which is what
 * lets a repository that predates spaces open unchanged. The server and the preview both
 * answer this question, about the same tree, and must answer it the same way.
 */
import { dirname, toPosix } from "./path.ts";

export const SPACE_FILE = "space.json";
export const ROOT_SPACE = "";

/** Space ids from the paths of the `space.json` files, all relative to the designs directory. */
export const spaceIdsFrom = (configPaths: readonly string[]): string[] =>
  configPaths
    .map((p) => dirname(toPosix(p)))
    .sort((a, b) => a.localeCompare(b));

const inSpace = (id: string, path: string) =>
  id === ROOT_SPACE || path === id || path.startsWith(`${id}/`);

/** The space a designs-relative path belongs to, or null when no space holds it. */
export const spaceIdOf = (
  spaceIds: readonly string[],
  path: string
): string | null => {
  const posix = toPosix(path);
  if (spaceIds.length === 0) {
    return ROOT_SPACE;
  }
  let best: string | null = null;
  for (const id of spaceIds) {
    if (inSpace(id, posix) && (best === null || id.length > best.length)) {
      best = id;
    }
  }
  return best;
};

/** The path of a file inside its space. */
export const pathInSpace = (spaceId: string, path: string): string => {
  const posix = toPosix(path);
  return spaceId === ROOT_SPACE ? posix : posix.slice(spaceId.length + 1);
};
