#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook: denies file tools whose path resolves outside the repository.
 * Usage: `node scope-guard.mjs <root>`, hook input as JSON on stdin.
 *
 * Paths are resolved against the hook's cwd, symlinks followed through the nearest existing
 * ancestor, the same rule as `RepoPaths.resolve` on the server.
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

const GLOB_CHAR = /[*?[{]/;

const root = realpathSync(path.resolve(process.argv[2] ?? "."));
const input = JSON.parse(readFileSync(0, "utf8"));
if (process.env.SCOPE_GUARD_LOG) {
  appendFileSync(process.env.SCOPE_GUARD_LOG, `${JSON.stringify(input)}\n`);
}
const cwd = input.cwd ?? root;
const args = input.tool_input ?? {};

const nearestReal = (abs) => {
  let probe = abs;
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) {
      return probe;
    }
    probe = parent;
  }
  return realpathSync(probe);
};

const expandHome = (p) =>
  p === "~" || p.startsWith("~/")
    ? path.join(process.env.HOME ?? "", p.slice(1))
    : p;

/** The directory a glob pattern starts from: everything before its first wildcard segment. */
const globBase = (pattern) => {
  const parts = pattern.split("/");
  const cut = parts.findIndex((part) => GLOB_CHAR.test(part));
  return cut === -1 ? pattern : parts.slice(0, cut).join("/") || "/";
};

const candidates = [
  args.file_path,
  args.notebook_path,
  args.path,
  typeof args.pattern === "string" && input.tool_name === "Glob"
    ? globBase(args.pattern)
    : undefined,
].filter((p) => typeof p === "string" && p.length > 0);

// Grep and Glob without a path search the cwd.
if (candidates.length === 0) {
  candidates.push(cwd);
}

const outside = candidates.filter((p) => {
  const real = nearestReal(path.resolve(cwd, expandHome(p)));
  return real !== root && !real.startsWith(root + path.sep);
});

if (outside.length > 0) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `ultrapaint keeps agents inside the repository (${root}); refused: ${outside.join(", ")}`,
      },
    })
  );
}
