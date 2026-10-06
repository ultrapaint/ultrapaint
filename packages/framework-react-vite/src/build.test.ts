import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bundlesStale } from "./build.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A package whose bundles were built at t=2000 from two sources, one in another package. */
const built = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ed-build-"));
  roots.push(root);
  const file = (rel: string, seconds: number) => {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, "");
    utimesSync(p, seconds, seconds);
    return p;
  };
  const outputs = [file("pkg/dist/a.js", 2000), file("pkg/dist/b.js", 2000)];
  file("pkg/src/entry.ts", 1000);
  file("design-document/src/css.ts", 1000);
  const base = path.join(root, "pkg/src");
  const inputs = path.join(root, "pkg/.cache/inputs.json");
  mkdirSync(path.dirname(inputs), { recursive: true });
  writeFileSync(
    inputs,
    JSON.stringify(["entry.ts", "../../design-document/src/css.ts"])
  );
  return { base, file, inputs, outputs, root };
};

describe("whether the preview bundles are stale", () => {
  it("is not while no input the build read changed", () => {
    const { base, inputs, outputs } = built();
    expect(bundlesStale(outputs, inputs, base)).toBe(false);
  });

  it("is when a file of another package the bundles read changed", () => {
    const { base, file, inputs, outputs } = built();
    file("design-document/src/css.ts", 3000);
    expect(bundlesStale(outputs, inputs, base)).toBe(true);
  });

  it("is when an input, an output or the list of inputs is gone", () => {
    const gone = built();
    rmSync(path.join(gone.root, "design-document/src/css.ts"));
    expect(bundlesStale(gone.outputs, gone.inputs, gone.base)).toBe(true);
    const unlisted = built();
    rmSync(unlisted.inputs);
    expect(bundlesStale(unlisted.outputs, unlisted.inputs, unlisted.base)).toBe(
      true
    );
    const unbuilt = built();
    rmSync(unbuilt.outputs[0] ?? "");
    expect(bundlesStale(unbuilt.outputs, unbuilt.inputs, unbuilt.base)).toBe(
      true
    );
  });
});
