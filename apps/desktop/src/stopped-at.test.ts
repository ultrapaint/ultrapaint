import { assert, describe, it } from "@effect/vitest";
import { stackFrames, stoppedAt } from "./stopped-at.ts";

const ORIGIN = "http://127.0.0.1:4800";
const PAGE = `${ORIGIN}/preview/src/components/page.tsx?t=17`;

/** Its first line is the source's fifth, its second the sixth. */
const map = Buffer.from(
  JSON.stringify({ mappings: "AAIA;AACA", sources: ["page.tsx"], version: 3 })
).toString("base64");

const MODULES: Record<string, string> = {
  [`${ORIGIN}/assets/index.js`]: "editor();",
  [PAGE]: `import{loop}from"/preview/@id/__x00__virtual:ultrapaint/guard";__edModuleStarts(import.meta.url);spin();\nmore();\n//# sourceMappingURL=data:application/json;base64,${map}`,
};

const read = (url: string) => {
  const code = MODULES[url];
  return code === undefined
    ? Promise.reject(new Error("not found"))
    : Promise.resolve(code);
};

const STACK = [
  "",
  `    at ${ORIGIN}/preview/node_modules/.vite/deps/react-dom.js?v=1:10:4`,
  "    at Object.find (<anonymous>)",
  `    at Spin (${PAGE}:2:3)`,
  `    at ${ORIGIN}/assets/index.js:1:1`,
].join("\n");

describe("stoppedAt", () => {
  it("lists the modules a stack names, not its dependencies' or the browser's", () => {
    assert.deepStrictEqual(
      stackFrames(STACK).map((f) => [f.url, f.line, f.column]),
      [
        [PAGE, 2, 3],
        [`${ORIGIN}/assets/index.js`, 1, 1],
      ]
    );
  });

  it("names the repository's line through the module's map", async () => {
    assert.strictEqual(
      await stoppedAt(STACK, read),
      "src/components/page.tsx:6"
    );
  });

  it("names nothing when only the editor's code held the page", async () => {
    assert.strictEqual(
      await stoppedAt(`\n    at ${ORIGIN}/assets/index.js:1:1`, read),
      undefined
    );
  });

  it("passes over a module that cannot be read", async () => {
    const missing = `\n    at ${ORIGIN}/preview/src/gone.tsx:1:1${STACK}`;
    assert.strictEqual(
      await stoppedAt(missing, read),
      "src/components/page.tsx:6"
    );
  });
});
