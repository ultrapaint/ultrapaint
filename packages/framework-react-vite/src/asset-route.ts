/**
 * Which file an image of a canvas is. A canvas may keep its own `assets/`, whose files take the
 * place of the shared ones of the same name at the root of the designs directory (ADR 0019);
 * only the preview's server can look, so the page asks it at `ASSET_PATH?canvas=&src=`.
 */
import path from "node:path";

export const ASSET_PATH = "/@ultrapaint/asset";

/**
 * The file `src` names for a canvas: the canvas's own when it exists, the shared one otherwise,
 * or null when neither does or the path leaves the designs directory.
 */
export const resolveAsset = (
  designsDir: string,
  canvas: string,
  src: string,
  exists: (file: string) => boolean
): string | null => {
  const inside = (file: string) => file.startsWith(`${designsDir}${path.sep}`);
  const candidates = [
    path.resolve(designsDir, canvas, src),
    path.resolve(designsDir, src),
  ];
  return candidates.find((file) => inside(file) && exists(file)) ?? null;
};
