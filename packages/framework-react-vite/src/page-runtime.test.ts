import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  GUARD_GLOBAL,
  GUARD_MEMBERS,
  MODULE_MARK,
  MODULE_MARK_NAME,
  PAGE_RUNTIME,
  REGISTRY_GLOBAL,
  REGISTRY_MEMBERS,
  RELOAD_GLOBAL,
  STYLES_GLOBAL,
  STYLES_MEMBERS,
} from "@ultrapaint/contracts/page-runtime";
import { parseAst } from "vite";
import { describe, expect, it } from "vitest";
import { GUARD_MODULE, guardCode } from "./guard-code.ts";
import { componentsModule } from "./preview-files.ts";
import { patchClient } from "./vite-client.ts";

/** A global of the page's read as a property (`globalThis.__edStyles`): ours are all named so. */
const GLOBAL_RE = /\.(__(?:ed|ED|ultrapaint)\w*)/g;
/** A member called on one: `.__edStyles.update(`, `.__ED__?.setComponents(`. */
const CALL_RE = /\.(__(?:ed|ED|ultrapaint)\w*)(?:\?\.|\.)(\w+)\(/g;

/** Every `global.member` the contract declares; a function (`__edReload`) has none. */
const declared = new Set(
  Object.entries(PAGE_RUNTIME).flatMap(([global, members]) =>
    Object.values(members).map((member: string) => `${global}.${member}`)
  )
);
const globals = new Set(Object.keys(PAGE_RUNTIME));

/**
 * What `code` reads of the page's globals and calls on them (`global.member`), and what of either
 * the contract does not declare.
 */
const pageCalls = (code: string) => {
  const calls = new Set(
    [...code.matchAll(CALL_RE)].map(([, global, member]) =>
      [global, member].join(".")
    )
  );
  const read = new Set([...code.matchAll(GLOBAL_RE)].map(([, g]) => g ?? ""));
  return {
    calls,
    read,
    undeclared: [
      ...[...read].filter((g) => !globals.has(g)),
      ...[...calls].filter((c) => !declared.has(c)),
    ],
  };
};

const callsOf = (global: string, members: Record<string, string>) =>
  new Set(Object.values(members).map((m) => `${global}.${m}`));

/** The client of the Vite this package depends on, as Vite serves it. */
const viteClient = () => {
  const require = createRequire(import.meta.url);
  const vite = path.dirname(require.resolve("vite/package.json"));
  return readFileSync(path.join(vite, "dist/client/client.mjs"), "utf8");
};

describe("the page runtime the generated code calls", () => {
  it("is all the guard module asks of the guard", () => {
    const found = pageCalls(GUARD_MODULE);
    expect(found.undeclared).toEqual([]);
    expect(found.read).toEqual(new Set([GUARD_GLOBAL]));
    expect(found.calls).toEqual(callsOf(GUARD_GLOBAL, GUARD_MEMBERS));
  });

  it("is all Vite's client, patched, asks of the styles and the reload", () => {
    const found = pageCalls(patchClient(viteClient()));
    expect(found.undeclared).toEqual([]);
    expect(found.read).toEqual(new Set([RELOAD_GLOBAL, STYLES_GLOBAL]));
    expect(found.calls).toEqual(callsOf(STYLES_GLOBAL, STYLES_MEMBERS));
  });

  it("is all the registry asks of the page", () => {
    const found = pageCalls(componentsModule(["./button.tsx"]));
    expect(found.undeclared).toEqual([]);
    expect(found.read).toEqual(new Set([REGISTRY_GLOBAL]));
    expect(found.calls).toEqual(callsOf(REGISTRY_GLOBAL, REGISTRY_MEMBERS));
  });

  it("marks the repository's modules, and not a dependency's", () => {
    const marked = guardCode("a();", null, () => 0) ?? "";
    expect(marked).toContain(`moduleStarts as ${MODULE_MARK_NAME}`);
    expect(marked).toContain(MODULE_MARK);
    const code = "for (;;) a();";
    const dependency = guardCode(code, parseAst(code), () => 0, {
      markAsync: false,
      markModule: false,
    });
    expect(dependency).not.toContain(MODULE_MARK_NAME);
  });
});
