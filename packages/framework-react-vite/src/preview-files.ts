import path from "node:path";
import type { PreviewInput } from "@ultrapaint/framework-api/node";
import type { PreviewBundles } from "./build.ts";
import type { ServeOptions } from "./serve.ts";

const LEADING_NON_DOT_RE = /^(?!\.)/;
const LEADING_NON_SLASH_RE = /^(?!\/)/;

const toPosix = (p: string) => p.replaceAll("\\", "/");

/** Packages there must be one copy of on the page, whoever imports them. */
const SINGLETONS = ["react", "react-dom", "scheduler"];

export const OPTIONS_FILE = "preview.json";

/**
 * Contents of the generated directory the preview is served from: the page, its entry module
 * and the options of the serve script. No Vite config is written; the serve script builds it
 * from the anchor's own and from these options.
 */
export const previewFiles = (
  input: PreviewInput,
  bundles: PreviewBundles,
  tailwind: boolean
): Record<string, string> => {
  const { designsDir, dir, settings } = input;
  const include = [
    designsDir,
    ...settings.libraryDirs.map((d) => path.join(input.root, d)),
  ];
  const fsUrl = (file: string) =>
    `/@fs${toPosix(file).replace(LEADING_NON_SLASH_RE, "/")}`;

  const options: ServeOptions = {
    anchorDir: input.anchorDir,
    bundleDir: bundles.dir,
    designsDir,
    dir,
    entries: [
      toPosix(path.join(dir, "main.ts")),
      ...include.map((d) => `${toPosix(d)}/**/*.tsx`),
    ],
    html: path.join(dir, "index.html"),
    include,
    root: input.root,
    singletons: SINGLETONS,
    tailwind,
  };

  const css = [
    ...settings.hostCss.map((c) => `@import ${JSON.stringify(c)};`),
    // Tailwind 4 scans what these point at; without Tailwind they would only be noise.
    ...(tailwind
      ? [
          '@source "../";',
          '@source not "../.ultrapaint";',
          ...settings.libraryDirs.map(
            (d) =>
              `@source ${JSON.stringify(toPosix(path.relative(dir, path.join(input.root, d))))};`
          ),
        ]
      : []),
    "",
  ].join("\n");

  const providersImport = settings.providersModule
    ? `import Providers from ${JSON.stringify(toPosix(path.relative(dir, path.join(designsDir, settings.providersModule))).replace(LEADING_NON_DOT_RE, "./"))};`
    : "const Providers = undefined;";

  const main = `import "./host.css";
import { renderToCanvas } from ${JSON.stringify(fsUrl(bundles.render))};
${providersImport}

// The preview core, injected ahead of this module, leaves its surface on the window.
const ed = window.__ED__;
const canvas = document.getElementById("root") as HTMLElement;
const screen = new URLSearchParams(location.search).get("screen") ?? "";

const modules = import.meta.glob(["../**/*.tsx", "!../node_modules/**", "!../.ultrapaint/**", "!../**/*.stories.tsx", "!../**/*.test.tsx"]);
const loader = modules["../" + screen];

if (!loader) {
  ed.showMessage(canvas, "Screen not found: " + screen);
} else {
  loader().then((mod) => {
    const component = (mod as { default?: unknown }).default;
    if (!component) {
      ed.showMessage(canvas, "Screen has no default export: " + screen);
      return;
    }
    renderToCanvas({ component, providers: Providers, reportError: ed.reportError }, canvas);
  }, (error: Error) => {
    ed.reportError({ message: error.message, stack: error.stack });
    ed.showMessage(canvas, String(error.stack ?? error.message));
  });
}

if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", () => ed.notifyHmr());
  import.meta.hot.on("vite:error", (e: { err: { message: string; id?: string; loc?: { line: number } } }) =>
    ed.reportError({ message: e.err.message, file: e.err.id, line: e.err.loc?.line }),
  );
}
`;

  const html = `<!doctype html>
<html lang="en" data-theme="${settings.theme}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ultrapaint preview</title>
  <script>
    window.__ED_CONFIG__ = { screen: new URLSearchParams(location.search).get("screen") || "", designsDir: ${JSON.stringify(toPosix(settings.designsDir))} };
  </script>
  <script src="${fsUrl(bundles.runtime)}"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${fsUrl(path.join(dir, "main.ts"))}"></script>
</body>
</html>
`;

  return {
    "host.css": css,
    "index.html": html,
    "main.ts": main,
    [OPTIONS_FILE]: `${JSON.stringify(options, null, 2)}\n`,
  };
};
