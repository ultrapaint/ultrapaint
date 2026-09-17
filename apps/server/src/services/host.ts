import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import type { HostStatus, Settings } from "@ultrapaint/contracts";
import { buildHostPlugin } from "@ultrapaint/host-plugin/build";
import { writeAtomic } from "../util.ts";
import type { RepoPaths } from "./repo.ts";

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });

const toPosix = (p: string) => p.replaceAll("\\", "/");

/**
 * Runs the preview host: the target repository's own Vite, started inside the designs
 * package with a generated configuration that adds the source stamping plugin, the runtime
 * and the CSS the settings declare. It is stopped by the PID it spawned, never by name.
 */
export class HostManager {
  private child: ChildProcess | null = null;
  private status: HostStatus = { state: "stopped" };
  private stopping = false;

  constructor(
    private readonly paths: RepoPaths,
    private readonly log: (level: "info" | "warn" | "error", text: string) => void,
    private readonly onStatus: (status: HostStatus) => void,
  ) {}

  get current(): HostStatus {
    return this.status;
  }

  screenUrl(screenId: string): string | null {
    if (this.status.state !== "running" || !this.status.url) return null;
    return `${this.status.url}/?screen=${encodeURIComponent(screenId)}`;
  }

  private setStatus(status: HostStatus) {
    this.status = status;
    this.onStatus(status);
  }

  /** The designs package must resolve `vite`; we drive it through its JS API (no bin needed). */
  private viteModule(): string | null {
    const candidates = [
      path.join(this.paths.designsDir, "node_modules", "vite", "package.json"),
      path.join(this.paths.root, "node_modules", "vite", "package.json"),
    ];
    return candidates.find((c) => existsSync(c)) ?? null;
  }

  private generate(settings: Settings, built: { plugin: string; runtime: string }) {
    const dir = path.join(this.paths.designsDir, ".ultrapaint");
    mkdirSync(dir, { recursive: true });
    const include = [
      this.paths.designsDir,
      ...settings.libraryDirs.map((d) => path.join(this.paths.root, d)),
    ];

    const viteConfig = `import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { ultrapaintStamp } from ${JSON.stringify(toPosix(built.plugin))};

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  cacheDir: path.join(here, ".vite"),
  clearScreen: false,
  logLevel: "info",
  plugins: [
    ultrapaintStamp({ repoRoot: ${JSON.stringify(this.paths.root)}, include: ${JSON.stringify(include)} }),
    react(),
    tailwindcss(),
  ],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    fs: { allow: [${JSON.stringify(this.paths.root)}, ${JSON.stringify(path.dirname(built.runtime))}] },
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
      ...settings.hostCss.map((c) => `@import ${JSON.stringify(c)};`),
      `@source "../";`,
      `@source not "../.ultrapaint";`,
      "",
    ].join("\n");

    const providersImport = settings.providersModule
      ? `import Providers from ${JSON.stringify(toPosix(path.relative(dir, path.join(this.paths.designsDir, settings.providersModule))).replace(/^(?!\.)/, "./"))};`
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
window.__ED_CONFIG__ = { screen, designsDir: ${JSON.stringify(toPosix(settings.designsDir))} };

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
<html lang="en" data-theme="${settings.theme}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ultrapaint host</title>
    <script>
      window.__ED_CONFIG__ = { screen: new URLSearchParams(location.search).get("screen") || "", designsDir: ${JSON.stringify(toPosix(settings.designsDir))} };
    </script>
    <script src="/@fs${toPosix(built.runtime)}"></script>
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
    writeAtomic(path.join(dir, "serve.mjs"), serve);
    writeAtomic(path.join(dir, "vite.config.ts"), viteConfig);
    writeAtomic(path.join(dir, "host.css"), css);
    writeAtomic(path.join(dir, "main.tsx"), main);
    writeAtomic(path.join(dir, "index.html"), html);
    if (!existsSync(path.join(dir, ".gitignore"))) writeAtomic(path.join(dir, ".gitignore"), "*\n");
    return dir;
  }

  async start(settings: Settings): Promise<HostStatus> {
    if (this.child) return this.status;
    if (!this.viteModule()) {
      this.setStatus({
        state: "error",
        error:
          "The designs package cannot resolve `vite`. Add `vite`, `@vitejs/plugin-react` and `@tailwindcss/vite` to its devDependencies and install.",
      });
      return this.status;
    }
    this.setStatus({ state: "starting" });
    let built: { plugin: string; runtime: string };
    try {
      built = await buildHostPlugin();
    } catch (error) {
      this.setStatus({
        state: "error",
        error: `host plugin build failed: ${(error as Error).message}`,
      });
      return this.status;
    }
    const dir = this.generate(settings, built);
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(dir, "serve.mjs"), String(port)], {
      cwd: this.paths.designsDir,
      env: { ...process.env, FORCE_COLOR: "0", NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.stopping = false;
    const url = `http://127.0.0.1:${port}`;
    child.stdout?.on("data", (d) => this.log("info", String(d).trimEnd()));
    child.stderr?.on("data", (d) => this.log("warn", String(d).trimEnd()));
    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.stopping) this.setStatus({ state: "stopped" });
      else this.setStatus({ state: "error", error: `vite exited (${signal ?? code})` });
    });
    const ready = await this.waitForPort(port, 30000);
    if (!ready) {
      this.setStatus({
        state: "error",
        pid: child.pid,
        error: "vite did not start listening within 30 s",
      });
      return this.status;
    }
    this.setStatus({ state: "running", port, url, pid: child.pid });
    return this.status;
  }

  private waitForPort(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const tryOnce = async () => {
        if (!this.child) return resolve(false);
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" });
          if (res.ok || res.status < 500) return resolve(true);
        } catch {
          /* not yet */
        }
        if (Date.now() > deadline) return resolve(false);
        setTimeout(tryOnce, 150);
      };
      void tryOnce();
    });
  }

  async stop(): Promise<HostStatus> {
    const child = this.child;
    if (!child) return this.status;
    this.stopping = true;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
    return this.status;
  }
}
