/**
 * What `pnpm dev` runs the server's sources with (`command.ts`: tsx with the server's tsconfig)
 * runs them as the bundle and the tests do. tsx applies that tsconfig only to the files it
 * includes, so a workspace package's own compiler settings, such as the system components'
 * JSX runtime (ADR 0150), have to hold without it. Run by the root's `pnpm test`, with Node's own
 * test runner.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVER = path.join(ROOT, "apps", "server");

test("the server's sources under tsx render the system components' views", () => {
  const tsx = createRequire(path.join(SERVER, "package.json")).resolve(
    "tsx/cli"
  );
  const dir = mkdtempSync(path.join(tmpdir(), "ultrapaint-dev-server-"));
  try {
    const script = path.join(dir, "render.ts");
    const views = path.join(
      ROOT,
      "packages",
      "system-components",
      "src",
      "resting-markup.tsx"
    );
    writeFileSync(
      script,
      `import { restingMarkupOf } from ${JSON.stringify(views)};
console.log(JSON.stringify(restingMarkupOf("Button", {}, [])[0]?.tag));
`
    );
    const out = execFileSync(
      process.execPath,
      [tsx, "--tsconfig", path.join(SERVER, "tsconfig.json"), script],
      { cwd: SERVER, encoding: "utf8" }
    );
    assert.equal(out.trim(), '"button"');
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
