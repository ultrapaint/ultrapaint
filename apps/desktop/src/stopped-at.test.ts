import { assert, describe, it } from "@effect/vitest";
import { stoppedAt } from "./stopped-at.ts";

const ORIGIN = "http://127.0.0.1:4800";

/** Its first line is the source's fifth, its second the sixth. */
const map = Buffer.from(
  JSON.stringify({ mappings: "AAIA;AACA", sources: ["page.tsx"], version: 3 })
).toString("base64");

/** A stuck page's stack and the modules it names, the preview served under `base`. */
const servedUnder = (base: string) => {
  const page = `${ORIGIN}${base}src/components/page.tsx?t=17`;
  const modules: Record<string, string> = {
    [`${ORIGIN}/assets/index.js`]: "editor();",
    [`${ORIGIN}${base}@fs/home/u/ultrapaint/dist/editor.js`]:
      "export const createPreview = () => {};",
    [page]: `import{loop}from"${base}@id/__x00__virtual:ultrapaint/guard";__edModuleStarts(import.meta.url);spin();\nmore();\n//# sourceMappingURL=data:application/json;base64,${map}`,
  };
  const read = (url: string) => {
    const code = modules[url];
    return code === undefined
      ? Promise.reject(new Error("not found"))
      : Promise.resolve(code);
  };
  const stack = [
    "",
    `    at ${ORIGIN}${base}node_modules/.vite/deps/react-dom.js?v=1:10:4`,
    "    at Object.find (<anonymous>)",
    `    at draw (${ORIGIN}${base}@fs/home/u/ultrapaint/dist/editor.js:1:1)`,
    `    at Spin (${page}:2:3)`,
    `    at ${ORIGIN}/assets/index.js:1:1`,
  ].join("\n");
  return { read, stack };
};

describe("stoppedAt", () => {
  it("names the repository's line through the module's map", async () => {
    const { read, stack } = servedUnder("/preview/");
    assert.strictEqual(
      await stoppedAt(stack, read, "/preview/"),
      "src/components/page.tsx:6"
    );
  });

  it("names the path under a base of more than one segment", async () => {
    const base = "/tools/ultrapaint/preview/";
    const { read, stack } = servedUnder(base);
    assert.strictEqual(
      await stoppedAt(stack, read, base),
      "src/components/page.tsx:6"
    );
    assert.strictEqual(await stoppedAt(stack, read, "/preview/"), undefined);
  });

  it("names nothing when only the editor's code held the page", async () => {
    const { read } = servedUnder("/preview/");
    assert.strictEqual(
      await stoppedAt(
        `\n    at ${ORIGIN}/assets/index.js:1:1`,
        read,
        "/preview/"
      ),
      undefined
    );
  });

  it("passes over a module that cannot be read", async () => {
    const { read, stack } = servedUnder("/preview/");
    const missing = `\n    at ${ORIGIN}/preview/src/gone.tsx:1:1${stack}`;
    assert.strictEqual(
      await stoppedAt(missing, read, "/preview/"),
      "src/components/page.tsx:6"
    );
  });
});
