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
import { buildFingerprint, bundlesStale } from "./build.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const FINGERPRINT = buildFingerprint("0.28.2", [{ bundle: true }], "build");

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
    JSON.stringify({
      fingerprint: FINGERPRINT,
      inputs: ["entry.ts", "../../design-document/src/css.ts"],
    })
  );
  return { base, file, inputs, outputs, root };
};

describe("whether the preview bundles are stale", () => {
  it("is not while no input the build read changed", () => {
    const { base, inputs, outputs } = built();
    expect(bundlesStale(outputs, inputs, base, FINGERPRINT)).toBe(false);
  });

  it("is when a file of another package the bundles read changed", () => {
    const { base, file, inputs, outputs } = built();
    file("design-document/src/css.ts", 3000);
    expect(bundlesStale(outputs, inputs, base, FINGERPRINT)).toBe(true);
  });

  it("is when an input, an output or the list of inputs is gone", () => {
    const gone = built();
    rmSync(path.join(gone.root, "design-document/src/css.ts"));
    expect(
      bundlesStale(gone.outputs, gone.inputs, gone.base, FINGERPRINT)
    ).toBe(true);
    const unlisted = built();
    rmSync(unlisted.inputs);
    expect(
      bundlesStale(
        unlisted.outputs,
        unlisted.inputs,
        unlisted.base,
        FINGERPRINT
      )
    ).toBe(true);
    const unbuilt = built();
    rmSync(unbuilt.outputs[0] ?? "");
    expect(
      bundlesStale(unbuilt.outputs, unbuilt.inputs, unbuilt.base, FINGERPRINT)
    ).toBe(true);
  });

  it("is when esbuild, the options or the build itself changed", () => {
    const { base, inputs, outputs } = built();
    for (const other of [
      buildFingerprint("0.29.0", [{ bundle: true }], "build"),
      buildFingerprint("0.28.2", [{ bundle: false }], "build"),
      buildFingerprint("0.28.2", [{ bundle: true }], "build, changed"),
    ]) {
      expect(bundlesStale(outputs, inputs, base, other)).toBe(true);
    }
  });

  it("is when the inputs were listed before builds had a fingerprint", () => {
    const { base, inputs, outputs } = built();
    writeFileSync(inputs, JSON.stringify(["entry.ts"]));
    expect(bundlesStale(outputs, inputs, base, FINGERPRINT)).toBe(true);
  });
});
