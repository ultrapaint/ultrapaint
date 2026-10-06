/**
 * `pnpm pack:local`: the `ultrapaint` command as a package that runs in any repository without
 * this checkout, written to `dist/ultrapaint-<version>.tgz`. It holds the command bundled as
 * `cli.mjs`, the server's bundle in `server/` and the editor's build in `web/`. Installing it
 * fetches only what is loaded from disk at runtime: Vite and its React plugin, which the
 * preview falls back to when the repository has none, and TypeScript 5.
 *
 * `pnpm add -g ./dist/ultrapaint-<version>.tgz` puts the command on the PATH. The package
 * is private, so it cannot be published by mistake while the name is not chosen.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  version?: string;
}

const root = path.resolve(import.meta.dirname, "..");
const serverDir = path.join(root, "apps", "server");
const out = path.join(root, "dist");
const stage = path.join(out, "pack");

const readJson = (file: string) =>
  JSON.parse(readFileSync(file, "utf8")) as PackageJson;
const sh = (command: string, args: readonly string[], cwd = root) =>
  execFileSync(command, args, { cwd, stdio: ["ignore", "pipe", "inherit"] })
    .toString()
    .trim();

const { version } = readJson(path.join(root, "package.json"));
const server = readJson(path.join(serverDir, "package.json"));
/** The range the server is built and tested with, so the package gets the same. */
const range = (name: string) => {
  const found = server.dependencies?.[name] ?? server.devDependencies?.[name];
  if (!found) {
    throw new Error(`${name} is not a dependency of @ultrapaint/server`);
  }
  return found;
};

console.log("[pack] building the server and the editor");
execFileSync("pnpm", ["-F", "@ultrapaint/server", "build"], {
  cwd: root,
  stdio: "inherit",
});
execFileSync("pnpm", ["-F", "@ultrapaint/web", "build"], {
  cwd: root,
  stdio: "inherit",
});

rmSync(stage, { force: true, recursive: true });
mkdirSync(stage, { recursive: true });

// The root has no esbuild of its own; the server's is the one its bundle is made with.
const esbuild = createRequire(path.join(serverDir, "package.json"))(
  "esbuild"
) as typeof import("esbuild");
esbuild.buildSync({
  // Bundled CommonJS dependencies require Node's own modules, which ESM has no `require` for.
  banner: {
    js: "import { createRequire as __ultrapaintRequire } from 'node:module'; const require = __ultrapaintRequire(import.meta.url);",
  },
  bundle: true,
  entryPoints: [path.join(root, "scripts", "cli.ts")],
  format: "esm",
  logLevel: "warning",
  outfile: path.join(stage, "cli.mjs"),
  platform: "node",
  target: "node24",
});
cpSync(path.join(serverDir, "dist"), path.join(stage, "server"), {
  recursive: true,
});
// The editor's source maps are three quarters of its build and help no one running it.
cpSync(path.join(root, "apps", "web", "dist"), path.join(stage, "web"), {
  filter: (file) => !file.endsWith(".map"),
  recursive: true,
});

writeFileSync(
  path.join(stage, "package.json"),
  `${JSON.stringify(
    {
      bin: { "ultrapaint": "cli.mjs" },
      dependencies: {
        "@vitejs/plugin-react": range("@vitejs/plugin-react"),
        "typescript-api": range("typescript-api"),
        vite: range("vite"),
      },
      description:
        "A design tool for teams that work with coding agents, run in the repository",
      engines: { node: ">=24" },
      name: "ultrapaint",
      private: true,
      type: "module",
      version,
    },
    null,
    2
  )}\n`
);

const tarball = sh(
  "npm",
  ["pack", "--silent", "--pack-destination", out],
  stage
);
console.log(`[pack] ${path.join(out, tarball)}`);
console.log(`[pack] install it with: pnpm add -g ${path.join(out, tarball)}`);
