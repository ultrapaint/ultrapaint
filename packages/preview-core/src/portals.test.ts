import { describe, expect, it } from "vitest";
import { previewCallOn } from "./portals.ts";

const BASE = "/preview/";
const OWN = "http://127.0.0.1:4601/preview/@fs/dist/editor.js";
const app = (f: string) =>
  `    at ${f} (http://127.0.0.1:4601/preview/src/${f}.tsx:3:9)`;
const react =
  "    at renderWithHooks (http://127.0.0.1:4601/preview/node_modules/.vite/deps/react-dom.js:9:1)";
const ours = `    at render (${OWN}:1:2)`;
const editor = (f: string) =>
  `    at ${f} (http://127.0.0.1:4601/src/${f}.ts:5:5)`;

describe("previewCallOn", () => {
  it("is the preview's when its code calls with nothing of the editor's below", () => {
    expect(previewCallOn([app("load"), react], BASE, OWN)).toBe(true);
  });

  it("is the preview's when the editor handed it the work through the preview's bundle", () => {
    expect(
      previewCallOn([app("Page"), react, ours, editor("canvas")], BASE, OWN)
    ).toBe(true);
  });

  it("is the editor's when the editor called the application's wrapper directly", () => {
    expect(previewCallOn([app("logged"), editor("api")], BASE, OWN)).toBe(
      false
    );
  });

  it("is the editor's when the editor or the preview's bundle calls", () => {
    expect(previewCallOn([editor("api")], BASE, OWN)).toBe(false);
    expect(previewCallOn([ours, app("x")], BASE, OWN)).toBe(false);
  });
});
