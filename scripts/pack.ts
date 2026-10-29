/**
 * `pnpm pack:local`: the `ultrapaint` command as a package that runs in any repository without
 * this checkout, written to `dist/ultrapaint-<version>.tgz`. It holds the command bundled as
 * `cli.mjs`, the server's bundle in `server/` and the editor's build in `web/`. Installing it
 * fetches nothing: the canvas draws the editor's system components (ADR 0040).
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
import path from "node:path";
import { buildSync } from "esbuild";

interface PackageJson {
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

buildSync({
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
