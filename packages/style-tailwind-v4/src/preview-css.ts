/**
 * What Tailwind v4 puts in the preview's stylesheet: the repository's own stylesheets, the
 * component directories for Tailwind to scan, and the `@theme inline` aliases declared again on
 * every element. With those, every token is a custom property the preview draws with.
 */
import path from "node:path";
import type { PreviewStyleContext } from "@ultrapaint/framework-api/node";
import { toPosix } from "@ultrapaint/shared/path";
import { inlineThemeAliases, packageRoot } from "./design-system-scan.ts";

/**
 * The `@theme inline` variables, declared again on every element: a design drawn inside a
 * theme's scope (`.dark`) reads the scope's values, not the root's.
 */
const themeAliasesCss = (ctx: PreviewStyleContext): string[] => {
  const aliases = inlineThemeAliases(
    ctx.settings.hostCss,
    path.join(ctx.dir, "host.css"),
    ctx.anchorDir
  );
  if (aliases.size === 0) {
    return [];
  }
  const declarations = [...aliases]
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return [`*, ::before, ::after {\n${declarations}\n}`];
};

export const previewCss = (ctx: PreviewStyleContext): string[] => {
  // Without Tailwind's Vite plugin the stylesheets are plain CSS, and these would be noise.
  const tailwind = packageRoot("@tailwindcss/vite", ctx.anchorDir) !== null;
  return [
    ...ctx.settings.hostCss.map((c) => `@import ${JSON.stringify(c)};`),
    // Tailwind scans what these point at. The designs are documents with no classes in them,
    // so only the components are scanned.
    ...(tailwind
      ? ctx.settings.libraryDirs.map(
          (d) =>
            `@source ${JSON.stringify(toPosix(path.relative(ctx.dir, path.join(ctx.root, d))))};`
        )
      : []),
    ...(tailwind ? themeAliasesCss(ctx) : []),
  ];
};
