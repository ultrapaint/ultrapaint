/**
 * The React + Vite framework: TSX screens rendered with the repository's own React, served by
 * Vite, edited as JSX and catalogued from TypeScript types. The server reaches all of it
 * through the `Framework` interface and never imports another module of this package.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Framework } from "@ultrapaint/framework-api/node";
import { buildPreviewBundles } from "./build.ts";
import { catalogue } from "./catalogue-extract.ts";
import { detect } from "./detect.ts";
import { OPTIONS_FILE, previewFiles } from "./preview-files.ts";
import { screens } from "./screens.ts";
import { source } from "./source.ts";

/** Whether a package is installed where the anchor can reach it. */
const resolvesFrom = (dir: string, id: string) =>
  (createRequire(path.join(dir, "package.json")).resolve.paths(id) ?? []).some(
    (modules) => existsSync(path.join(modules, id, "package.json"))
  );

export const framework: Framework = {
  catalogue,
  detect,
  id: "react-vite",
  preview: {
    generate: async (input) => {
      const bundles = await buildPreviewBundles();
      // Tailwind 4 is a Vite plugin the anchor has or has not; Tailwind 3 comes in through
      // the anchor's PostCSS setup and needs nothing from us.
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
  screens,
  source,
};
