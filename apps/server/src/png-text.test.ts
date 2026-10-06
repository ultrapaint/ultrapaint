import { assert, describe, it } from "@effect/vitest";
import { readPngText, withPngText } from "./png-text.ts";

/** A 1×1 PNG. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngBytes = () => new Uint8Array(Buffer.from(PNG, "base64"));

describe("PNG text chunks", () => {
  it("carries a value under a keyword, replacing the one it carried", () => {
    const once = withPngText(pngBytes(), "ultrapaint", "abc");
    assert.strictEqual(readPngText(once, "ultrapaint"), "abc");
    assert.isNull(readPngText(once, "other"));
    const twice = withPngText(once, "ultrapaint", "def");
    assert.strictEqual(readPngText(twice, "ultrapaint"), "def");
    assert.strictEqual(twice.length, once.length);
  });

  it("leaves what is not a PNG alone", () => {
    const text = new TextEncoder().encode("not a picture");
    assert.strictEqual(withPngText(text, "k", "v"), text);
    assert.isNull(readPngText(text, "k"));
    assert.isNull(readPngText(pngBytes(), "ultrapaint"));
  });
});
