import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detect } from "./detect.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const repository = (files: Record<string, string | object>) => {
  const root = mkdtempSync(path.join(tmpdir(), "ed-detect-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      typeof content === "string" ? content : JSON.stringify(content)
    );
  }
  return root;
};

const component = "export const X = () => null;\n";

describe("recognising a React repository", () => {
  it("proposes the library, the package that consumes it and its stylesheet", () => {
    const root = repository({
      "apps/api/package.json": { dependencies: { hono: "1" }, name: "api" },
      "apps/web/package.json": {
        dependencies: {
          "@acme/ui": "workspace:*",
          react: "19",
          "react-dom": "19",
        },
        devDependencies: { "@tailwindcss/vite": "4", vite: "8" },
        name: "@acme/web",
      },
      "apps/web/src/app.css": '@import "tailwindcss";\n',
      "apps/web/src/other.css": "body { margin: 0 }\n",
      "package.json": { name: "acme", private: true },
      // Never looked into, however many manifests it holds.
      "packages/ui/node_modules/react/package.json": { name: "react" },
      "packages/ui/package.json": {
        name: "@acme/ui",
        peerDependencies: { react: "19" },
      },
      "packages/ui/src/components/button.stories.tsx": component,
      "packages/ui/src/components/button.tsx": component,
      "packages/ui/src/components/card.tsx": component,
    });
    expect(detect(root)).toEqual({
      anchors: [
        {
          dir: "apps/web",
          name: "@acme/web",
          reason: "depends on @acme/ui, has Vite",
        },
      ],
      cssEntries: ["apps/web/src/app.css"],
      designsDirs: [],
      libraries: [
        {
          dir: "packages/ui",
          name: "@acme/ui",
          sourceDir: "packages/ui/src/components",
        },
      ],
      tailwind: "v4",
    });
  });

  it("prefers a designs package that is already there", () => {
    const root = repository({
      "apps/web/package.json": {
        dependencies: {
          "@acme/ui": "*",
          react: "19",
          "react-dom": "19",
          vite: "8",
        },
        name: "web",
      },
      "package.json": { name: "acme" },
      "packages/designs/package.json": {
        dependencies: { "@acme/ui": "*", react: "19" },
        name: "@acme/designs",
      },
      "packages/ui/package.json": {
        name: "@acme/ui",
        peerDependencies: { react: "19" },
      },
      "packages/ui/src/button.tsx": component,
    });
    const found = detect(root);
    expect(found?.anchors[0]?.dir).toBe("packages/designs");
    expect(found?.designsDirs).toEqual(["packages/designs"]);
    // The designs package renders components; it is not a library of them.
    expect(found?.libraries.map((l) => l.name)).toEqual(["@acme/ui"]);
  });

  it("offers the root of a single-package repository", () => {
    const root = repository({
      "package.json": {
        dependencies: { react: "19", "react-dom": "19" },
        name: "solo",
      },
    });
    expect(detect(root)?.anchors).toEqual([
      { dir: ".", name: "solo", reason: "depends on react" },
    ]);
  });

  it("says nothing about a repository without React", () => {
    expect(
      detect(repository({ "package.json": { name: "plain" } }))
    ).toBeNull();
  });

  it("proposes an application's own components when no package is a library", () => {
    // A repository with its one app in front/, the way many products start.
    const root = repository({
      "front/package.json": {
        dependencies: { react: "19", "react-dom": "19" },
        devDependencies: { "@tailwindcss/vite": "4", vite: "8" },
        name: "front",
      },
      "front/src/components/header.tsx": component,
      "front/src/components/ui/button.tsx": component,
      "front/src/components/ui/card.tsx": component,
      "front/src/index.css": '@import "tailwindcss";\n',
      "front/src/main.tsx": component,
      "README.md": "# product\n",
    });
    const found = detect(root);
    expect(found?.anchors[0]?.dir).toBe("front");
    expect(found?.libraries).toEqual([
      {
        dir: "front",
        inApp: true,
        name: "front",
        sourceDir: "front/src/components",
      },
    ]);
    expect(found?.cssEntries).toContain("front/src/index.css");
    expect(found?.tailwind).toBe("v4");
  });
});
