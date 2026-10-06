import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detect } from "./detect.ts";
import { scaffold } from "./scaffold.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const written = (files: Readonly<Record<string, string>>) => {
  const root = mkdtempSync(path.join(tmpdir(), "ed-scaffold-"));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
};

describe("a new application", () => {
  it("is one the setup recognises: the app, its own components, its stylesheet", () => {
    const result = scaffold({ dir: "app", name: "Acme Web", tokens: {} });
    expect(result.settings).toEqual({
      hostCss: "app/src/index.css",
      libraryDir: "app/src/components",
      resolveFrom: "app",
    });
    const root = written(result.files);
    const found = detect(root);
    expect(found?.anchors[0]?.dir).toBe("app");
    expect(found?.libraries[0]).toMatchObject({
      inApp: true,
      sourceDir: "app/src/components",
    });
    expect(JSON.parse(String(result.files["app/package.json"])).name).toBe(
      "acme-web"
    );
  });

  it("starts its theme from the tokens it is given, or a neutral set with a dark theme", () => {
    const given = scaffold({
      dir: ".",
      name: "x",
      tokens: { "color-primary": "#ff0000", "radius-card": "12px" },
    }).files["src/index.css"];
    expect(given).toContain(
      "  --color-primary: #ff0000;\n  --radius-card: 12px;"
    );
    expect(given).not.toContain(".dark {");
    const starter = scaffold({ dir: ".", name: "x", tokens: {} }).files[
      "src/index.css"
    ];
    expect(starter).toContain("--color-primary: #2563eb;");
    expect(starter).toContain(".dark {");
  });
});
