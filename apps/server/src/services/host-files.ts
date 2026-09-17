import path from "node:path";
import type { Settings } from "@ultrapaint/contracts/settings";
import { toPosix } from "../hash.ts";

const LEADING_NON_DOT_RE = /^(?!\.)/;

export interface HostFilesInput {
  readonly built: { readonly plugin: string; readonly runtime: string };
  readonly designsDir: string;
  /** The generated `.ultrapaint` directory inside the designs package. */
  readonly dir: string;
  readonly root: string;
  readonly settings: Settings;
}

/**
 * Contents of the generated Vite project that serves the screens: the target repository's own
 * Vite, plus the source stamping plugin, the iframe runtime and the CSS the settings declare.
 */
export const hostFiles = (input: HostFilesInput): Record<string, string> => {
  const { dir } = input;
  const include = [
    input.designsDir,
    ...input.settings.libraryDirs.map((d) => path.join(input.root, d)),
  ];

  const viteConfig = `import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { ultrapaintStamp } from ${JSON.stringify(toPosix(input.built.plugin))};

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
root: here,
cacheDir: path.join(here, ".vite"),
clearScreen: false,
logLevel: "info",
plugins: [
  ultrapaintStamp({ repoRoot: ${JSON.stringify(input.root)}, include: ${JSON.stringify(include)} }),
  react(),
  tailwindcss(),
],
server: {
  host: "127.0.0.1",
  strictPort: true,
  fs: { allow: [${JSON.stringify(input.root)}, ${JSON.stringify(path.dirname(input.built.runtime))}] },
  hmr: { host: "127.0.0.1" },
  watch: { ignored: ["**/.ultrapaint/.vite/**"] },
},
// Scan every screen and design-system file up front so Vite pre-bundles all dependencies
// once; discovering a new dependency later re-optimises and can load a second React copy.
optimizeDeps: {
  entries: ["index.html", ${JSON.stringify(include.map((d) => `${toPosix(d)}/**/*.tsx`))}].flat(),
  exclude: [],
},
});
`;

  const css = [
    ...input.settings.hostCss.map((c) => `@import ${JSON.stringify(c)};`),
    `@source "../";`,
    `@source not "../.ultrapaint";`,
    "",
  ].join("\n");

  const providersImport = input.settings.providersModule
    ? `import Providers from ${JSON.stringify(toPosix(path.relative(dir, path.join(input.designsDir, input.settings.providersModule))).replace(LEADING_NON_DOT_RE, "./"))};`
    : "const Providers = ({ children }: { children: React.ReactNode }) => <>{children}</>;";

  const main = `import "./host.css";
import * as React from "react";
import { createRoot } from "react-dom/client";
${providersImport}

declare global {
interface Window {
  __ED__?: { notifyHmr(): void; reportError(e: { message: string; stack?: string; file?: string; line?: number }): void };
  __ED_CONFIG__?: { screen: string; designsDir: string };
}
}

const modules = import.meta.glob(["../**/*.tsx", "!../node_modules/**", "!../.ultrapaint/**", "!../**/*.stories.tsx", "!../**/*.test.tsx"]);
const screen = new URLSearchParams(location.search).get("screen") ?? "";
window.__ED_CONFIG__ = { screen, designsDir: ${JSON.stringify(toPosix(input.settings.designsDir))} };

class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
state = { error: null as Error | null };
static getDerivedStateFromError(error: Error) {
  return { error };
}
componentDidCatch(error: Error) {
  window.__ED__?.reportError({ message: error.message, stack: error.stack });
}
render() {
  if (this.state.error) {
    return (
      <pre style={{ padding: 16, color: "#b00020", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
        {String(this.state.error.stack ?? this.state.error.message)}
      </pre>
    );
  }
  return this.props.children;
}
}

const NotFound = () => (
<div style={{ padding: 16, fontFamily: "system-ui", color: "#b00020" }}>Screen not found: {screen}</div>
);

const root = createRoot(document.getElementById("root") as HTMLElement);

const loader = modules["../" + screen];
if (!loader) {
root.render(<NotFound />);
} else {
loader().then((mod) => {
  const Screen = (mod as { default: React.ComponentType }).default;
  if (!Screen) {
    root.render(<div style={{ padding: 16, color: "#b00020" }}>Screen has no default export: {screen}</div>);
    return;
  }
  root.render(
    <Boundary>
      <Providers>
        <Screen />
      </Providers>
    </Boundary>,
  );
}, (error: Error) => {
  window.__ED__?.reportError({ message: error.message, stack: error.stack });
  root.render(<pre style={{ padding: 16, color: "#b00020", whiteSpace: "pre-wrap" }}>{String(error.stack ?? error.message)}</pre>);
});
}

if (import.meta.hot) {
import.meta.hot.on("vite:afterUpdate", () => window.__ED__?.notifyHmr());
import.meta.hot.on("vite:error", (e: { err: { message: string; id?: string; loc?: { line: number } } }) =>
  window.__ED__?.reportError({ message: e.err.message, file: e.err.id, line: e.err.loc?.line }),
);
}
`;

  const html = `<!doctype html>
<html lang="en" data-theme="${input.settings.theme}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ultrapaint host</title>
  <script>
    window.__ED_CONFIG__ = { screen: new URLSearchParams(location.search).get("screen") || "", designsDir: ${JSON.stringify(toPosix(input.settings.designsDir))} };
  </script>
  <script src="/@fs${toPosix(input.built.runtime)}"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
`;
  const serve = `import { createServer } from "vite";

const port = Number(process.argv[2]);
const server = await createServer({
configFile: new URL("./vite.config.ts", import.meta.url).pathname,
server: { port, strictPort: true, host: "127.0.0.1" },
});
await server.listen();
server.printUrls();
const stop = () => server.close().then(() => process.exit(0), () => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
`;
  return {
    "host.css": css,
    "index.html": html,
    "main.tsx": main,
    "serve.mjs": serve,
    "vite.config.ts": viteConfig,
  };
};
