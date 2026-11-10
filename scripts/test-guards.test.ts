/**
 * The repository's tests wait for signals, not time (docs/TESTING.md rules 2 and 6): a test
 * file that sleeps, runs on the live clock or retries says why, in a `// real clock:` comment
 * (the real clock is the behaviour under test: a real watcher, a process, a socket) or a
 * `// fake clock:` one (a timer `vi.useFakeTimers` fakes), on the line itself or in the comment
 * just above it. Run by the root's `pnpm test`, with Node's own test runner.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
/** What waits on time, or hides why a test failed. */
const TIMED_RE =
  /setTimeout\(|Effect\.sleep\(|it\.live\(|\.retry\(|\bretry:\s*\d/;
const REASON_RE = /\/\/ (real|fake) clock:/;
const COMMENT_RE = /^\s*\/\//;
const SELF = path.relative(ROOT, import.meta.filename);

/**
 * The test files git has: tracked, or new and not ignored. A checkout inside this one (a
 * worktree, a clone kept for reference) is not the repository's, and git does not list into it.
 */
const testFiles = (root: string): string[] =>
  execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "*.test.ts",
      "*.test.tsx",
    ],
    { cwd: root, encoding: "utf8" }
  )
    .split("\0")
    .filter((file) => file !== "" && existsSync(path.join(root, file)))
    .map((file) => path.join(root, file));

/** Whether the line, or the comment just above it, says why it waits on time. */
const explained = (lines: readonly string[], at: number) => {
  if (REASON_RE.test(lines[at] ?? "")) {
    return true;
  }
  for (let i = at - 1; i >= 0 && COMMENT_RE.test(lines[i] ?? ""); i -= 1) {
    if (REASON_RE.test(lines[i] ?? "")) {
      return true;
    }
  }
  return false;
};

/** Every line of the repository's tests that waits on time without saying why, as `file:line`. */
const unexplainedWaits = (root: string): string[] =>
  testFiles(root).flatMap((file) => {
    const rel = path.relative(root, file);
    if (rel === SELF) {
      return [];
    }
    const lines = readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, i) =>
      TIMED_RE.test(line) && !explained(lines, i)
        ? [`${rel}:${i + 1}: ${line.trim()}`]
        : []
    );
  });

test("no test waits on time without saying why the real clock is what it tests", () => {
  assert.deepEqual(unexplainedWaits(ROOT), []);
});

test("the guard finds a wait with no reason, and passes one that gives it", () => {
  const lines = [
    "await new Promise((r) => setTimeout(r, 10));",
    "// real clock: a real watcher",
    "yield* Effect.sleep(10);",
    "// fake clock: a frame is a timer vi.useFakeTimers fakes",
    "// and the test moves it",
    "setTimeout(cb, 16);",
    'it.live("x", () => body);',
  ];
  assert.deepEqual(
    lines.flatMap((line, i) =>
      TIMED_RE.test(line) && !explained(lines, i) ? [i + 1] : []
    ),
    [1, 7]
  );
});
