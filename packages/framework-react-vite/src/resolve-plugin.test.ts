import { describe, expect, it, vi } from "vitest";
import { ultrapaintResolve } from "./resolve-plugin.ts";

const ANCHOR = "/repo/apps/web";
const ANCHOR_IMPORTER = `${ANCHOR}/__ultrapaint_anchor__.ts`;

const setup = (found: Record<string, string> = {}) => {
  const plugin = ultrapaintResolve({
    anchorDir: ANCHOR,
    from: ["/repo/docs/designs", "/tool/dist"],
  });
  const resolve = vi.fn((source: string) =>
    Promise.resolve(found[source] ? { id: found[source] } : null)
  );
  const call = (source: string, importer?: string, scan = false) =>
    plugin.resolveId.call({ resolve }, source, importer, { scan });
  return { call, resolve };
};

describe("resolving pages from the anchor package", () => {
  it("resolves a page's bare import as if the anchor imported it", async () => {
    const { call, resolve } = setup({
      "@acme/ui": "/repo/packages/ui/src/index.ts",
    });
    expect(await call("@acme/ui", "/repo/docs/designs/home.tsx")).toEqual({
      id: "/repo/packages/ui/src/index.ts",
    });
    expect(resolve).toHaveBeenCalledWith(
      "@acme/ui",
      ANCHOR_IMPORTER,
      expect.objectContaining({ skipSelf: true })
    );
  });

  it("does the same for our own browser modules and for ids with no importer", async () => {
    const { call } = setup({ react: "/repo/packages/ui/src/react-stub.ts" });
    expect(await call("react", "/tool/dist/render.js")).not.toBeNull();
    expect(await call("react")).not.toBeNull();
  });

  it("leaves relative imports, other importers and dependencies' own imports alone", async () => {
    const { call, resolve } = setup({ react: "/x/react.js" });
    expect(await call("./button", "/repo/docs/designs/home.tsx")).toBeNull();
    expect(await call("react", "/repo/packages/ui/src/button.tsx")).toBeNull();
    expect(
      await call("react", "/repo/docs/designs/node_modules/dep/index.js")
    ).toBeNull();
    expect(await call("react", ANCHOR_IMPORTER)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("falls back to the ordinary resolution when the anchor cannot resolve it", async () => {
    const { call } = setup();
    expect(await call("left-pad", "/repo/docs/designs/home.tsx")).toBeNull();
  });

  it("registers a dependency for pre-bundling, which a plugin's resolution would skip", async () => {
    const file =
      "/repo/node_modules/.pnpm/react@19/node_modules/react/index.js";
    const registerMissingImport = vi.fn(() => ({ id: "react" }));
    const plugin = ultrapaintResolve({
      anchorDir: ANCHOR,
      from: ["/repo/docs/designs"],
    });
    const context = {
      environment: {
        depsOptimizer: {
          getOptimizedDepId: () => "/.vite/deps/react.js?v=1",
          isOptimizedDepFile: () => false,
          options: {},
          registerMissingImport,
        },
      },
      resolve: () => Promise.resolve({ id: `${file}?v=abc` }),
    };
    const importer = "/repo/docs/designs/home.tsx";
    expect(await plugin.resolveId.call(context, "react", importer, {})).toEqual(
      {
        id: "/.vite/deps/react.js?v=1",
      }
    );
    expect(registerMissingImport).toHaveBeenCalledWith("react", file);
    // The dependency scan wants the file itself, to learn what there is to pre-bundle.
    expect(
      await plugin.resolveId.call(context, "react", importer, { scan: true })
    ).toEqual({ id: `${file}?v=abc` });
  });
});
