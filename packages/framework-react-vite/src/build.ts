import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_BUNDLE_EXPORTS } from "@ultrapaint/framework-api/editor-exports";
import type { BuildOptions } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
// A source checkout builds the bundles on demand. A bundled server has no sources to build
// from: its build copies them next to it, into `preview/`.
const fromSource = import.meta.url.endsWith(".ts");
const dist = fromSource
  ? path.resolve(here, "../dist")
  : path.join(here, "preview");

export interface PreviewBundles {
  /** Directory of the browser bundles; the preview server is allowed to serve from it. */
  readonly dir: string;
  /**
   * ES module the editor's page loads (ADR 0034): preview-core's entry (`editor.ts`) given this
   * framework's renderer, `startPreview`; `react` stays an import, so it is the repository's.
   */
  readonly editor: string;
  /** Node script that serves the preview. */
  readonly serve: string;
}

/**
 * What the last build read, as esbuild reported it, relative to this directory, and the
 * fingerprint of how it built: `{ fingerprint, inputs }`. Kept out of `dist`, which a bundled
 * server copies.
 */
const inputsFile = path.resolve(here, "../.cache/preview-inputs.json");

const bundles: PreviewBundles = {
  dir: dist,
  editor: path.join(dist, "editor.js"),
  serve: path.join(dist, "serve.mjs"),
};

const mtimeOf = (file: string): number | null => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    // Gone since the last build: whatever read it must be built again.
    return null;
  }
};

/**
 * Whether the outputs are older than any file the build that made them read, were built another
 * way (`fingerprint`: esbuild's version, the options, this file), or that build's inputs are not
 * known. The inputs are esbuild's own list, so a file of any package the bundles reach counts,
 * `design-document` and `contracts` as much as the renderer.
 */
export const bundlesStale = (
  outputs: readonly string[],
  inputsPath: string,
  base: string,
  fingerprint: string
): boolean => {
  const built = outputs.map(mtimeOf);
  if (built.some((m) => m === null)) {
    return true;
  }
  let record: { fingerprint?: unknown; inputs?: unknown } | null;
  try {
    record = JSON.parse(readFileSync(inputsPath, "utf8"));
  } catch {
    // No list of inputs, or one that cannot be read: nothing says the bundles are current.
    return true;
  }
  const inputs = record?.inputs;
  if (
    record?.fingerprint !== fingerprint ||
    !Array.isArray(inputs) ||
    inputs.length === 0
  ) {
    return true;
  }
  const oldest = Math.min(...(built as number[]));
  return inputs.some((input) => {
    const m = mtimeOf(path.resolve(base, String(input)));
    return m === null || m > oldest;
  });
};

/** How a build is made, apart from its sources: the same fingerprint, the same bundles. */
export const buildFingerprint = (
  esbuildVersion: string,
  options: unknown,
  builder: string
): string =>
  createHash("sha1")
    .update(`${esbuildVersion}\n${JSON.stringify(options)}\n${builder}`)
    .digest("hex");

const sourceOf = (specifier: string) =>
  fileURLToPath(import.meta.resolve(specifier));

/** What esbuild names the entry it is given as text in its metafile: no file to watch. */
const STDIN = "<stdin>";

/**
 * The editor bundle's entry: preview-core's, given the renderer this framework draws with. The
 * framework pairs the two (ADR 0011), so neither imports the other; the bundle exports what
 * framework-api declares (`EditorBundle`).
 */
export const bundleEntry = (core: string, renderer: string) =>
  [
    `import { editorBundle } from ${JSON.stringify(core)};`,
    `import { renderToCanvas } from ${JSON.stringify(renderer)};`,
    "",
    `export const { ${EDITOR_BUNDLE_EXPORTS.join(", ")} } =`,
    "  editorBundle(renderToCanvas);",
    "",
  ].join("\n");

/**
 * Bundles what runs outside this process: the serve script (Node, run from the target
 * repository) and the module the editor's page loads. Each is self-contained, so the target
 * repository resolves none of our dependencies.
 */
export const buildPreviewBundles = async (
  opts: { force?: boolean } = {}
): Promise<PreviewBundles> => {
  if (!fromSource) {
    return bundles;
  }
  const editorSource = bundleEntry(
    sourceOf("@ultrapaint/preview-core/editor"),
    sourceOf("@ultrapaint/renderer-react/render")
  );
  const outputs = [bundles.editor, bundles.serve];
  // Paths in the metafile are relative to the working directory: this one, made explicit.
  const common = {
    absWorkingDir: here,
    bundle: true,
    logLevel: "silent",
    metafile: true,
  } as const;
  const options = [
    {
      ...common,
      entryPoints: [path.join(here, "serve.ts")],
      // Loaded from the target repository when it has them, from this package otherwise.
      external: ["vite", "@vitejs/plugin-react", "@tailwindcss/vite"],
      format: "esm",
      outfile: bundles.serve,
      platform: "node",
      target: "node22",
    },
    {
      ...common,
      external: ["react", "react-dom", "react-dom/client"],
      format: "esm",
      outfile: bundles.editor,
      platform: "browser",
      stdin: { contents: editorSource, loader: "ts", resolveDir: here },
      target: "es2022",
    },
  ] satisfies BuildOptions[];
  // Only a checkout builds them, so a bundled server does not need esbuild installed.
  const { build, version } = await import("esbuild");
  // A newer esbuild, other options or a change to this file build differently from the same
  // sources.
  const fingerprint = buildFingerprint(
    version,
    options,
    readFileSync(fileURLToPath(import.meta.url), "utf8")
  );
  const stale =
    opts.force || bundlesStale(outputs, inputsFile, here, fingerprint);
  if (stale) {
    const results = await Promise.all(options.map((o) => build(o)));
    const inputs = new Set(
      results
        .flatMap((r) => Object.keys(r.metafile?.inputs ?? {}))
        .filter((input) => input !== STDIN)
    );
    mkdirSync(path.dirname(inputsFile), { recursive: true });
    writeFileSync(
      inputsFile,
      JSON.stringify({ fingerprint, inputs: [...inputs] })
    );
  }
  return bundles;
};
