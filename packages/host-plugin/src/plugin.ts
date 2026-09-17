import path from "node:path";
import { stampJsx } from "./stamp.ts";

export interface StampPluginOptions {
  /** Absolute repository root; stamps are written relative to it. */
  repoRoot: string;
  /** Absolute directories whose `.tsx`/`.jsx` files get stamped. */
  include: string[];
}

const toPosix = (p: string) => p.replaceAll("\\", "/");

/**
 * Vite plugin (any Vite 5+, including rolldown-based Vite 8) that stamps JSX with source
 * locations before the React plugin transforms it. It only touches files under `include`.
 */
export const ultrapaintStamp = (options: StampPluginOptions) => {
  const root = path.resolve(options.repoRoot);
  const include = options.include.map((d) => path.resolve(d) + path.sep);
  return {
    name: "ultrapaint:stamp",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const file = id.split("?")[0] ?? id;
      if (!/\.[jt]sx$/.test(file)) return null;
      if (
        file.includes(`${path.sep}node_modules${path.sep}`) ||
        file.includes(`${path.sep}.ultrapaint${path.sep}`)
      )
        return null;
      const abs = path.resolve(file);
      if (!include.some((d) => abs.startsWith(d))) return null;
      const rel = toPosix(path.relative(root, abs));
      try {
        const result = stampJsx(code, { file: rel, mapSource: abs });
        if (result.count === 0) return null;
        return { code: result.code, map: result.map };
      } catch (error) {
        console.warn(`[ultrapaint] stamp failed for ${rel}: ${(error as Error).message}`);
        return null;
      }
    },
  };
};
