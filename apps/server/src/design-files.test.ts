import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { canvasText, parseCanvasText } from "./services/canvas-files.ts";
import { pageText, parseDocument } from "./services/document-file.ts";

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

/**
 * The file's text read as the server reads it, and written as the server writes it: a page's
 * tree, with how many nodes it has, or a canvas's layout. A file that does not read, or leaves
 * an id out, fails here.
 */
const readAndWritten = Effect.fnUntraced(function* (
  file: string,
  text: string
) {
  if (file.endsWith("canvas.json")) {
    const { filled, layout } = yield* parseCanvasText(text);
    assert.isFalse(filled, "an id was filled in");
    return { text: canvasText(layout) };
  }
  const read = yield* parseDocument(text);
  if ("problem" in read) {
    return assert.fail(read.problem);
  }
  assert.isFalse(read.filled, "an id was filled in");
  return { nodes: countNodes(read.root), text: pageText(read.root) };
});

describe("this repository's own designs", () => {
  it.effect.each(designFiles)(
    "reads %s back as it was, a line per node",
    (file) =>
      Effect.gen(function* () {
        const text = readFileSync(file, "utf8");
        const written = yield* readAndWritten(file, text);
        assert.strictEqual(written.text, text);
        if (written.nodes !== undefined) {
          // The file's braces and version, a line per node, a line per list of children closed.
          assert.isAtMost(text.split("\n").length, 2 * written.nodes + 4);
        }
      })
  );
});
