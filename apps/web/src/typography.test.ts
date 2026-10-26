import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;

/** The demo pages use Tailwind's stock scale on purpose: they are sample designs, not the editor. */
const SKIPPED = ["pages/"];

/** A stock or arbitrary font size: `text-xs`, `md:text-sm/relaxed`, `text-[11px]`. Colours, such
 *  as `text-muted-foreground` or `text-[CanvasText]`, do not match. */
const STOCK_SIZE =
  /(?:^|[^\w-])text-(?:xs|sm|base|lg|[2-9]?xl|\[[\d.]+(?:px|rem|em)\])(?![\w-])/;

const SOURCE = /\.tsx?$/;
const TEST = /\.test\.tsx?$/;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [path] : [];
  });

/** The one small role, for the rail's labels: everything else in the editor reads at 14px. */
const SMALL_ROLE = /(?:^|[^\w-])font-rail(?![\w-])/;
const SMALL_ROLE_FILES = ["components/rail.tsx"];

const linesMatching = (pattern: RegExp, skipped: readonly string[]) =>
  sources(SRC)
    .map((file) => relative(SRC, file))
    .filter((file) => !skipped.some((dir) => file.startsWith(dir)))
    .flatMap((file) =>
      readFileSync(join(SRC, file), "utf8")
        .split("\n")
        .flatMap((line, i) => (pattern.test(line) ? [`${file}:${i + 1}`] : []))
    );

describe("typography", () => {
  it("sizes the editor's text with roles, never a stock size", () => {
    expect(linesMatching(STOCK_SIZE, SKIPPED)).toEqual([]);
  });

  it("keeps the small role to the rail", () => {
    const outside = linesMatching(SMALL_ROLE, SKIPPED).filter(
      (line) => !SMALL_ROLE_FILES.includes(line.split(":")[0] ?? "")
    );
    expect(outside).toEqual([]);
  });
});
