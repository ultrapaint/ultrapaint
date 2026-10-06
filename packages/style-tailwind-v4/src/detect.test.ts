import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectStyles } from "./detect.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const repository = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), "ed-styles-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
};

describe("finding the stylesheets that set Tailwind up", () => {
  it("lists the ones of the packages it is given, and says which Tailwind", () => {
    const root = repository({
      "apps/web/src/app.css": '@import "tailwindcss";\n',
      "apps/web/src/other.css": "body { margin: 0 }\n",
      "packages/ui/node_modules/x/x.css": '@import "tailwindcss";\n',
      "packages/ui/src/theme.css": "@theme { --color-primary: red; }\n",
    });
    expect(
      detectStyles(root, [
        path.join(root, "apps/web"),
        path.join(root, "packages/ui"),
      ])
    ).toEqual({
      cssEntries: ["apps/web/src/app.css", "packages/ui/src/theme.css"],
      tailwind: "v4",
    });
  });

  it("tells Tailwind v3 and none apart", () => {
    const v3 = repository({ "src/app.css": "@tailwind base;\n" });
    expect(detectStyles(v3, [v3]).tailwind).toBe("v3");
    const none = repository({ "src/app.css": "body {}\n" });
    expect(detectStyles(none, [none])).toEqual({
      cssEntries: [],
      tailwind: "none",
    });
  });
});
