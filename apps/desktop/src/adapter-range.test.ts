import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { BUILT_IN_AGENTS } from "@ultrapaint/acp/built-in";

/** The versions the app bundles: the adapters its package pins, which `parts.ts` builds from. */
const { devDependencies: pinned } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")
) as { devDependencies: Readonly<Record<string, string>> };

const parts = (version: string) => version.split(".").map(Number);

/**
 * Whether `version` is in the caret `range`, as npm reads one: no lower than it, and the same
 * up to its first part that is not zero (`^0.95.0` is 0.95.x alone, `^2.1.1` any 2.x from 2.1.1).
 */
const inCaretRange = (version: string, range: string) => {
  const [major = 0, minor = 0, patch = 0] = parts(version);
  const [lowMajor = 0, lowMinor = 0, lowPatch = 0] = parts(range.slice(1));
  if (!range.startsWith("^") || major !== lowMajor) {
    return false;
  }
  if (major > 0) {
    return minor > lowMinor || (minor === lowMinor && patch >= lowPatch);
  }
  return minor > 0
    ? minor === lowMinor && patch >= lowPatch
    : minor === lowMinor && patch === lowPatch;
};

describe("the adapters the app bundles", () => {
  it("reads a caret as npm does: one minor only below 1.0", () => {
    assert.isTrue(inCaretRange("2.2.2", "^2.1.1"));
    assert.isFalse(inCaretRange("2.1.0", "^2.1.1"));
    assert.isFalse(inCaretRange("3.0.0", "^2.1.1"));
    assert.isTrue(inCaretRange("0.95.3", "^0.95.0"));
    assert.isFalse(inCaretRange("0.95.0", "^0.85.0"));
  });

  it.each(Object.values(BUILT_IN_AGENTS).map((agent) => agent.adapter))(
    "$package is a version the command asks npx for",
    (adapter) => {
      const bundled = pinned[adapter.package] ?? "";
      assert.isTrue(
        inCaretRange(bundled, adapter.range),
        `the app bundles ${adapter.package} ${bundled}, and the command asks for ${adapter.range}`
      );
    }
  );
});
