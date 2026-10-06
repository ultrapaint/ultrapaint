import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { serialiseDocument } from "@ultrapaint/design-document/format";

const DESIGNS = fileURLToPath(
  new URL("../../../docs/designs", import.meta.url)
);

/** Every page and canvas file of this repository's own designs. */
const designFiles = readdirSync(DESIGNS, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".page.json") || f.endsWith("canvas.json"))
  .map((f) => join(DESIGNS, f));

const countNodes = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.reduce((n: number, v) => n + countNodes(v), 0);
  }
  if (typeof value !== "object" || value === null) {
    return 0;
  }
  const { children } = value as { children?: unknown };
  return 1 + countNodes(children);
};

describe("this repository's own designs", () => {
  it.each(designFiles)("reads %s back as it was, a line per node", (file) => {
    const document = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const text = serialiseDocument(document);
    expect(JSON.parse(text)).toEqual(document);
    expect(serialiseDocument(JSON.parse(text))).toBe(text);
    const { root } = document as { root?: unknown };
    if (root !== undefined) {
      // The file's braces and version, a line per node, a line per list of children closed.
      expect(text.split("\n").length).toBeLessThanOrEqual(
        2 * countNodes(root) + 4
      );
    }
  });
});
