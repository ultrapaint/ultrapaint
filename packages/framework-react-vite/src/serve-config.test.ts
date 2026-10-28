import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PreviewBundles } from "./build.ts";
import { GUARD_ID, GUARD_MODULE } from "./guard-code.ts";
import {
  COMPONENTS_FILE,
  EDITOR_FILE,
  previewFiles,
  SETUP_FILE,
} from "./preview-files.ts";
import { PUBLIC_FILES_ID } from "./public-urls.ts";
import {
  anchorModules,
  realOptions,
  type ServeOptions,
  serveConfig,
  type Vite,
} from "./serve-config.ts";
import { CLIENT_STYLES_HOOK } from "./vite-client.ts";

/** The host `pnpm e2e:sandbox` draws: its own Vite, React and Babel plugins and public files. */
const anchor = realpathSync(
  fileURLToPath(new URL("../../../fixtures/sandbox-host", import.meta.url))
);
const BASE = "/preview/";
/** A loop of the repository's: numbered from 1, a dependency's being 0. */
const NUMBERED_LOOP_RE = /__edLoop\([1-9]/;
const REACT_DEP_RE =
  /"\/preview(\/@fs\/[^"]*\/\.vite\/deps\/react\.js\?v=\w+)"/;

/** A module of the generated directory's that is not the entry's. */
const LOOP_FILE = "loop.ts";

let server: ViteDevServer;
let generated: string;
let bundles: PreviewBundles;
const logged: string[] = [];

/** A module as the preview's server sends it, by its URL under the root. */
const served = async (url: string) =>
  (await server.transformRequest(url))?.code ?? "";

beforeAll(async () => {
  // The generated directory and the bundles' lie outside the repository, as the server's do.
  const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "serve-config-")));
  generated = path.join(tmp, "preview");
  const bundleDir = path.join(tmp, "bundles");
  mkdirSync(generated);
  mkdirSync(bundleDir);
  const designsDir = path.join(anchor, "designs");
  bundles = {
    dir: bundleDir,
    editor: path.join(bundleDir, "editor.js"),
    serve: path.join(bundleDir, "serve.mjs"),
  };
  writeFileSync(
    bundles.editor,
    "export const startPreview = async () => ({});\n"
  );
  const files = previewFiles(
    {
      anchorDir: anchor,
      base: BASE,
      components: [],
      designsDir,
      dir: generated,
      root: anchor,
      settings: defaultSettings(anchor),
      styles: [],
    },
    bundles,
    false
  );
  for (const [file, text] of Object.entries(files)) {
    writeFileSync(path.join(generated, file), text);
  }
  // A module of the editor's own with a loop, which no guard should touch.
  writeFileSync(
    path.join(generated, LOOP_FILE),
    "export const editor = async () => { for (;;) break; };\n"
  );
  const options = realOptions({
    anchorDir: anchor,
    base: BASE,
    bundleDir,
    designsDir,
    dir: generated,
    entries: [
      path.join(generated, EDITOR_FILE),
      path.join(generated, COMPONENTS_FILE),
    ],
    include: [designsDir, path.join(anchor, "src/components")],
    root: anchor,
    singletons: ["react", "react-dom", "scheduler"],
    tailwind: false,
  } satisfies ServeOptions);
  const { module: vite } = await anchorModules(anchor).load<Vite>("vite");
  const { config } = await serveConfig({
    host: "127.0.0.1",
    log: (text) => logged.push(text),
    options,
    port: 0,
    vite,
  });
  // In-process, with no port, socket or watcher of its own.
  server = await vite.createServer(
    vite.mergeConfig(config, {
      logLevel: "silent",
      server: { middlewareMode: true, watch: null, ws: false },
    })
  );
}, 60_000);

afterAll(async () => {
  await server?.close();
  rmSync(path.dirname(generated), { force: true, recursive: true });
}, 30_000);

describe("the preview server's config", () => {
  it("takes the anchor's own config, its server's plugins left out", () => {
    expect(logged).toContain(`using ${path.join(anchor, "vite.config.ts")}`);
    expect(server.config.root).toBe(anchor);
    expect(server.config.base).toBe(BASE);
    expect(server.config.define?.__SANDBOX_BACKEND__).toBeDefined();
    expect(server.config.resolve.alias).toContainEqual(
      expect.objectContaining({
        find: "@",
        replacement: path.join(anchor, "src"),
      })
    );
    expect(Object.keys(server.config.server.proxy ?? {})).toEqual([
      "/preview/api",
    ]);
    expect(server.config.cacheDir).toBe(path.join(generated, ".vite"));
  });

  it("puts its plugins in order, the anchor's first, Vite's import analysis after them", () => {
    const { plugins } = server.config;
    const at = (name: string) => {
      const index = plugins.findIndex((p) => p.name === name);
      expect(index, name).toBeGreaterThanOrEqual(0);
      return index;
    };
    expect(at("@rolldown/plugin-babel")).toBeLessThan(
      at("ultrapaint:resolve")
    );
    expect(at("ultrapaint:resolve")).toBeLessThan(at("vite:resolve-dev"));
    expect(at("vite:react:config-post")).toBeLessThan(at("ultrapaint:client"));
    expect(at("ultrapaint:client")).toBeLessThan(
      at("ultrapaint:public-urls")
    );
    expect(at("ultrapaint:public-urls")).toBeLessThan(at("ultrapaint:guard"));
    expect(at("ultrapaint:guard")).toBeLessThan(at("vite:import-analysis"));
    expect(
      [
        "ultrapaint:client",
        "ultrapaint:public-urls",
        "ultrapaint:guard",
      ].map((name) => plugins[at(name)]?.enforce)
    ).toEqual(["post", "post", "post"]);
  });

  it("guards the repository's code and moves its public URLs under the base", async () => {
    const code = await served("/src/components/probes.tsx");
    expect(code).toContain(`/preview/@id/__x00__${GUARD_ID}`);
    expect(code).toMatch(NUMBERED_LOOP_RE);
    expect(code).toContain("__edMark");
    expect(code).toContain("__edModuleEnds(import.meta.url)");
    expect(code).toContain(`"/preview/probe-link.css"`);
    expect(code).not.toContain(`"/probe-link.css"`);
  });

  it("checks a dependency's loops only", async () => {
    // React as Vite has bundled it, where the repository's code imports it from.
    const url = (await served("/src/components/probes.tsx")).match(
      REACT_DEP_RE
    )?.[1];
    expect(url).toBeDefined();
    const code = await served(url ?? "");
    expect(code).toContain(`/preview/@id/__x00__${GUARD_ID}`);
    expect(code).toContain("__edLoop(0)");
    expect(code).not.toMatch(NUMBERED_LOOP_RE);
    expect(code).not.toContain("__edModuleEnds");
    expect(code).not.toContain("__edFrame");
  });

  it("leaves the generated modules alone", async () => {
    const code = await served(`/@fs${path.join(generated, LOOP_FILE)}`);
    expect(code).toContain("for (;;) break;");
    expect(code).not.toContain("__edLoop");
    expect(code).not.toContain("__edModuleEnds");
  });

  it("serves the editor entry: the bundle, then its setup, with the dev server's events", async () => {
    const entry = await served(`/@fs${path.join(generated, EDITOR_FILE)}`);
    expect(entry).toContain(`from "${BASE}@fs${bundles.editor}"`);
    expect(entry).toContain(
      `import("${BASE}@fs${path.join(generated, SETUP_FILE)}")`
    );
    expect(entry).toContain("import.meta.hot = __vite__createHotContext(");
    expect(entry).not.toContain("__edModuleEnds");
    const setup = await served(`/@fs${path.join(generated, SETUP_FILE)}`);
    expect(setup).toContain(`"${BASE}@fs${path.join(generated, "host.css")}"`);
    expect(setup).toContain(
      `"${BASE}@fs${path.join(generated, COMPONENTS_FILE)}"`
    );
    expect(setup).toContain(`"${BASE}@id/__x00__${PUBLIC_FILES_ID}"`);
  });

  it("patches Vite's client for the editor's page", async () => {
    expect(await served("/@vite/client")).toContain(CLIENT_STYLES_HOOK);
    expect(logged.join("\n")).not.toContain("could not be adapted");
  });

  it("resolves and loads the guard's module", async () => {
    expect(await server.pluginContainer.resolveId(GUARD_ID)).toMatchObject({
      id: `\0${GUARD_ID}`,
    });
    expect(await server.pluginContainer.load(`\0${GUARD_ID}`)).toBe(
      GUARD_MODULE
    );
    expect(await served(GUARD_ID)).toContain("export function loop(id)");
  });

  it("lists the public directory's files under the base", async () => {
    expect(await served(PUBLIC_FILES_ID)).toContain(
      `export const publicFiles = ${JSON.stringify({
        base: BASE,
        entries: ["probe-dot.svg", "probe-link.css"],
      })};`
    );
  });
});
