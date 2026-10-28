import path from "node:path";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import {
  EDITOR_BUNDLE_EXPORTS,
  EDITOR_ENTRY_EXPORTS,
} from "@ultrapaint/framework-api/editor-exports";
import { parseAst } from "vite";
import { describe, expect, it } from "vitest";
import { bundleEntry } from "./build.ts";
import { EDITOR_FILE, previewFiles } from "./preview-files.ts";

const root = path.resolve("/repo");
const bundles = {
  dir: path.resolve("/bundles"),
  editor: path.resolve("/bundles/editor.js"),
  serve: path.resolve("/bundles/serve.mjs"),
};
const files = previewFiles(
  {
    anchorDir: root,
    base: "/preview/",
    components: ["./button.tsx"],
    designsDir: path.join(root, "designs"),
    dir: path.join(root, "designs/.ultrapaint"),
    root,
    settings: { ...defaultSettings(root), providersModule: "providers.tsx" },
    styles: [],
  },
  bundles,
  false
);

type Node = { readonly type: string } & Record<string, unknown>;

/** Every node of a module's syntax tree, depth first. */
const nodesOf = function* (node: unknown): Generator<Node> {
  if (Array.isArray(node)) {
    for (const child of node) {
      yield* nodesOf(child);
    }
  } else if (node && typeof node === "object" && "type" in node) {
    yield node as Node;
    for (const child of Object.values(node)) {
      yield* nodesOf(child);
    }
  }
};

const nameOf = (node: unknown) => (node as { name?: string }).name ?? "";

/**
 * What a module imports, statically (by module, the names it takes) and dynamically, and the
 * names it exports.
 */
const moduleOf = (code: string) => {
  const imports = new Map<string, string[]>();
  const dynamic: string[] = [];
  const exports: string[] = [];
  for (const node of nodesOf(parseAst(code, { lang: "ts" }).body)) {
    if (node.type === "ImportDeclaration") {
      const from = (node.source as { value: string }).value;
      imports.set(from, [
        ...(imports.get(from) ?? []),
        ...(node.specifiers as { imported?: unknown }[]).map((s) =>
          s.imported ? nameOf(s.imported) : "default"
        ),
      ]);
    } else if (node.type === "ImportExpression") {
      dynamic.push((node.source as { value: string }).value);
    } else if (node.type === "ExportDefaultDeclaration") {
      exports.push("default");
    } else if (node.type === "ExportNamedDeclaration") {
      for (const declarator of nodesOf(node.declaration)) {
        if (declarator.type === "VariableDeclarator") {
          const id = declarator.id as Node;
          exports.push(
            ...(id.type === "ObjectPattern"
              ? (id.properties as { value: unknown }[]).map((p) =>
                  nameOf(p.value)
                )
              : [nameOf(id)])
          );
        }
      }
      for (const specifier of (node.specifiers ?? []) as {
        exported: unknown;
      }[]) {
        exports.push(nameOf(specifier.exported));
      }
    }
  }
  return { dynamic, exports: exports.sort(), imports };
};

/** The bundle as the entry imports it: Vite puts the base in front. */
const bundleUrl = "/@fs/bundles/editor.js";

describe("the editor entry the framework generates", () => {
  const entry = moduleOf(files[EDITOR_FILE] ?? "");

  it("exports what the editor's page imports of it", () => {
    expect(entry.exports).toEqual([...EDITOR_ENTRY_EXPORTS].sort());
  });

  it("imports the editor bundle's exports, and nothing else before it starts", () => {
    expect([...entry.imports.keys()]).toEqual([bundleUrl]);
    const taken = entry.imports.get(bundleUrl) ?? [];
    expect(taken.length).toBeGreaterThan(0);
    for (const name of taken) {
      expect(EDITOR_BUNDLE_EXPORTS).toContain(name);
    }
  });

  it("imports the page's modules once it has started, from a module it generates", () => {
    expect(entry.dynamic).toHaveLength(1);
    const setupFile = path.posix.relative(".", entry.dynamic[0] ?? "");
    const setup = moduleOf(files[setupFile] ?? "");
    expect(setup.exports).toEqual(["default"]);
    // The stylesheet, the registry and the providers: the page's.
    expect([...setup.imports.keys()]).toEqual(
      expect.arrayContaining(["./host.css", "./components.ts"])
    );
    expect(setup.imports.get("../providers.tsx")).toEqual(["default"]);
  });
});

describe("the editor bundle the framework builds", () => {
  it("exports what the generated entry imports of it", () => {
    const entry = moduleOf(
      bundleEntry("/core/editor.ts", "/renderer/render.ts")
    );
    expect(entry.exports).toEqual([...EDITOR_BUNDLE_EXPORTS].sort());
  });
});
