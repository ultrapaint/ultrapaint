import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAsset } from "./asset-route.ts";

const designs = path.resolve("/repo/designs");

describe("the file an image of a canvas is", () => {
  const on = (...files: string[]) => {
    const present = new Set(files.map((f) => path.join(designs, f)));
    return (file: string) => present.has(file);
  };

  it("is the canvas's own when it has one, the shared one otherwise", () => {
    const exists = on(
      "assets/logo.png",
      "brand/assets/logo.png",
      "assets/hero.png"
    );
    expect(resolveAsset(designs, "brand", "assets/logo.png", exists)).toBe(
      path.join(designs, "brand/assets/logo.png")
    );
    expect(resolveAsset(designs, "brand", "assets/hero.png", exists)).toBe(
      path.join(designs, "assets/hero.png")
    );
    expect(resolveAsset(designs, "", "assets/logo.png", exists)).toBe(
      path.join(designs, "assets/logo.png")
    );
    expect(
      resolveAsset(designs, "brand", "assets/none.png", exists)
    ).toBeNull();
  });

  it("never leaves the designs directory", () => {
    const exists = () => true;
    expect(
      resolveAsset(designs, "brand", "../../etc/passwd", exists)
    ).toBeNull();
    expect(resolveAsset(designs, "../..", "../etc/passwd", exists)).toBeNull();
  });
});
