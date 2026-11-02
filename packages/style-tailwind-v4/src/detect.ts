/**
 * Finds the stylesheets that set Tailwind up in the packages the framework's detection
 * proposed (the anchor, the component library), and whether they are read. Only v4 is: its
 * `@theme` is where the tokens are. Why another is not is said here, in the adapter's words;
 * nothing outside it names a Tailwind version (ADR 0024).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StyleSuggestions } from "@ultrapaint/framework-api/node";
import { toPosix } from "@ultrapaint/shared/path";

const MAX_SUGGESTIONS = 5;
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
]);
// A stylesheet that sets Tailwind up, directly or through a theme package.
const TAILWIND_CSS_RE =
  /@import\s+["'][^"']*tailwind|@tailwind\s+base|@theme\b/;
const CSS_FILE_RE = /\.css$/;
const TAILWIND_V4_RE = /@import\s+["']tailwindcss|@theme\b/;
const TAILWIND_V3_RE = /@tailwind\s+(base|components|utilities)/;
const READS_V4 = "ultrapaint reads the design system from Tailwind v4's @theme";

/** Stylesheets below `dir` that set Tailwind up, repo-relative. */
const cssEntriesOf = (dir: string, root: string): string[] => {
  const found: string[] = [];
  const visit = (current: string, depth: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isFile() && CSS_FILE_RE.test(entry.name)) {
        try {
          if (TAILWIND_CSS_RE.test(readFileSync(file, "utf8"))) {
            found.push(toPosix(path.relative(root, file)));
          }
        } catch {
          // An unreadable stylesheet is simply not suggested.
        }
      } else if (
        entry.isDirectory() &&
        depth < 3 &&
        !SKIPPED_DIRS.has(entry.name) &&
        !entry.name.startsWith(".")
      ) {
        visit(file, depth + 1);
      }
    }
  };
  visit(dir, 0);
  return found;
};

export const detectStyles = (
  root: string,
  dirs: readonly string[]
): StyleSuggestions => {
  const cssEntries = [
    ...new Set(dirs.flatMap((dir) => cssEntriesOf(dir, root))),
  ].slice(0, MAX_SUGGESTIONS);
  const stylesheets = cssEntries.map((rel) => {
    try {
      return readFileSync(path.join(root, rel), "utf8");
    } catch {
      return "";
    }
  });
  if (stylesheets.some((css) => TAILWIND_V4_RE.test(css))) {
    return { cssEntries, supported: true };
  }
  return {
    cssEntries,
    note: stylesheets.some((css) => TAILWIND_V3_RE.test(css))
      ? `Tailwind v3 is not supported yet: the stylesheets set up Tailwind v3, and ${READS_V4}.`
      : `No Tailwind setup was found in the stylesheets: ${READS_V4}, and supports Tailwind v4 only.`,
    supported: false,
  };
};
