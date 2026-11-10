import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;

/**
 * The look page's samples use the stock scale's token names on purpose: they are sample designs,
 * drawn in a design's look, not the editor.
 */
const SKIPPED = ["boards/look-boards.ts"];

/** A stock or arbitrary font size: `text-xs`, `md:text-sm/relaxed`, `text-[11px]`. Colours, such
 *  as `text-muted-foreground` or `text-[CanvasText]`, do not match. */
const STOCK_SIZE =
  /(?:^|[^\w-])text-(?:xs|sm|base|lg|[2-9]?xl|\[[\d.]+(?:px|rem|em)\])(?![\w-])/;

/**
 * Type set any other way than by a type token (ADR 0072): a role from before them, Tailwind's
 * weights and faces (cleared from the theme, so they would draw nothing without a word), a line
 * height or letter spacing (`leading-5` comes from the spacing scale, which the theme keeps), an
 * arbitrary face or weight.
 */
const NOT_A_TOKEN =
  /(?:^|[^\w-])font-(?:label|small|caption|thin|extralight|light|normal|regular|medium|semibold|bold|extrabold|black|sans|serif|mono|display|\[[^\]]*\])(?![\w-])|(?:^|[^\w-])(?:leading|tracking)-[\w.[\]-]+/;

/** The `cn` package itself, which does not know the type tokens; `lib/cn.ts` does. */
const PACKAGE_CN = /from "cn"/;

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
  it("sizes the editor's text with type tokens, never a stock size", () => {
    expect(linesMatching(STOCK_SIZE, SKIPPED)).toEqual([]);
  });

  it("sets type with the type tokens alone", () => {
    expect(linesMatching(NOT_A_TOKEN, SKIPPED)).toEqual([]);
  });

  it("merges classes with the editor's cn, which knows the type tokens", () => {
    expect(linesMatching(PACKAGE_CN, ["lib/cn.ts"])).toEqual([]);
  });
});
