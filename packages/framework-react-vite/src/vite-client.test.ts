import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_RE, CLIENT_STYLES_HOOK, patchClient } from "./vite-client.ts";

/** The client of the Vite this package depends on, as Vite serves it before its own defines. */
const client = () => {
  const require = createRequire(import.meta.url);
  const vite = path.dirname(require.resolve("vite/package.json"));
  const file = path.join(vite, "dist/client/client.mjs");
  return { code: readFileSync(file, "utf8"), file };
};

describe("Vite's client in the editor's page", () => {
  it("is found by its path", () => {
    expect(CLIENT_RE.test(client().file)).toBe(true);
  });

  it("asks the page before every reload and hands it every stylesheet", () => {
    const { code } = client();
    const reloads = code.split("location.reload();").length - 1;
    expect(reloads).toBeGreaterThan(0);
    const patched = patchClient(code);
    expect(patched).not.toContain("\tlocation.reload();");
    expect(patched.split("globalThis.__edReload").length - 1).toBe(reloads * 2);
    expect(patched).toContain(CLIENT_STYLES_HOOK);
    expect(patched).toContain("globalThis.__edStyles.remove(id)");
  });
});
