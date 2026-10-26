import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import { afterAll, describe, expect, it } from "vitest";
import { previewCss } from "./preview-css.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A repository whose anchor has Tailwind's Vite plugin, at `version`. */
const repository = (version: string) => {
  const root = mkdtempSync(path.join(tmpdir(), "preview-css-"));
  made.push(root);
  const anchor = path.join(root, "web");
  for (const [name, v] of [
    ["@tailwindcss/vite", version],
    ["tailwindcss", version],
  ]) {
    const dir = path.join(anchor, "node_modules", name as string);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name, version: v })
    );
  }
  return { anchor, root };
};

const cssFor = (version: string, designsDir: string) => {
  const { anchor, root } = repository(version);
  return previewCss({
    anchorDir: anchor,
    dir: path.join(root, designsDir, ".ultrapaint"),
    root,
    settings: { ...defaultSettings(root), designsDir },
  });
};

describe("what Tailwind scans for the preview", () => {
  it("leaves out the designs when they sit inside the anchor", () => {
    expect(cssFor("4.3.3", "web/designs")).toContain('@source not "..";');
  });

  it("says nothing of designs outside the anchor, which it does not scan", () => {
    expect(cssFor("4.3.3", "docs/designs").join("\n")).not.toContain(
      "@source not"
    );
  });

  it("says nothing to a Tailwind older than 4.1, which does not know `@source not`", () => {
    expect(cssFor("4.0.9", "web/designs").join("\n")).not.toContain(
      "@source not"
    );
  });
});
