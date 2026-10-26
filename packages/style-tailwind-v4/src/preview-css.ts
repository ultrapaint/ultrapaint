/**
 * What Tailwind v4 puts in the preview's stylesheet: the repository's own stylesheets, the
 * component directories for Tailwind to scan, and the `@theme inline` aliases declared again on
 * every element. With those, every token is a custom property the preview draws with.
 */
import { readFileSync } from "node:fs";
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

/** Whether the anchor's Tailwind takes `@source not`, which came with 4.1. */
const excludesSources = (anchorDir: string) => {
  const root = packageRoot("tailwindcss", anchorDir);
  if (!root) {
    return false;
  }
  const { version } = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8")
  ) as { version?: string };
  const [major = 0, minor = 0] = (version ?? "").split(".").map(Number);
  return major > 4 || (major === 4 && minor >= 1);
};

/**
 * Keeps Tailwind from scanning the designs when they sit inside the anchor, which is where it
 * looks for classes on its own. The designs have none; and Tailwind reloads the whole page when
 * a file it scans changes, so every page saved reloaded every preview: blank, then drawn again.
 */
const designsExcluded = (ctx: PreviewStyleContext): string[] => {
  const designs = path.join(ctx.root, ctx.settings.designsDir);
  const fromAnchor = path.relative(ctx.anchorDir, designs);
  const inside = !(fromAnchor.startsWith("..") || path.isAbsolute(fromAnchor));
  return inside && excludesSources(ctx.anchorDir)
    ? [
        `@source not ${JSON.stringify(toPosix(path.relative(ctx.dir, designs)))};`,
      ]
    : [];
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
    ...(tailwind ? designsExcluded(ctx) : []),
    ...(tailwind ? themeAliasesCss(ctx) : []),
  ];
};
