/**
 * The React + Vite framework: design documents drawn with the repository's own React and its
 * design system's components, served by Vite, catalogued from TypeScript types. How the tokens
 * and classes are written is the style system's (ADR 0024). The server reaches all of it through
 * the `Framework` interface and never imports another module of this package.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { Framework } from "@ultrapaint/framework-api/node";
import { buildPreviewBundles } from "./build.ts";
import { catalogue } from "./catalogue-extract.ts";
import { detect } from "./detect.ts";
import {
  COMPONENTS_FILE,
  componentsModule,
  OPTIONS_FILE,
  previewFiles,
} from "./preview-files.ts";

/**
 * Whether a package is installed where the anchor can reach it: in its own `node_modules` or
 * an ancestor's. The directories are walked rather than asked of `require.resolve.paths`,
 * which also answers with what `NODE_PATH` holds — under pnpm that is our own store, and the
 * preview child, which runs with `NODE_PATH` cleared, would then be told to import a plugin
 * the repository does not have.
 */
const resolvesFrom = (dir: string, id: string) => {
  let current = path.resolve(dir);
  for (;;) {
    if (existsSync(path.join(current, "node_modules", id, "package.json"))) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
};

export const framework: Framework = {
  catalogue,
  detect,
  id: "react-vite",
  preview: {
    components: { file: COMPONENTS_FILE, render: componentsModule },
    generate: async (input) => {
      const bundles = await buildPreviewBundles();
      // Tailwind 4 is a Vite plugin the anchor has or has not; the preview inherits it.
      const tailwind = resolvesFrom(input.anchorDir, "@tailwindcss/vite");
      return {
        files: previewFiles(input, bundles, tailwind),
        serve: {
          args: [path.join(input.dir, OPTIONS_FILE)],
          script: bundles.serve,
        },
      };
    },
  },
};
