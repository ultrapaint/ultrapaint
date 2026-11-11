/**
 * The notes of a release (ADR 0078), printed for the release workflow: what it brings, from the
 * `feat:` and `fix:` commits since the previous release that change the app (a file under `apps/`
 * or `packages/` other than a test), each commit's behaviour up to its first colon, its ADRs
 * left out; then the install mark, after which the workflow writes how to install it. The desktop
 * app shows what comes before the mark. A stopgap until the changelog of issue #1.
 *
 *   node scripts/release-notes.ts <previous tag or ""> <tag>
 */
import { execFileSync } from "node:child_process";
import { INSTALL_MARK } from "../packages/contracts/src/release-notes.ts";

export interface Commit {
  readonly files: readonly string[];
  readonly subject: string;
}

const TYPE_RE = /^(feat|fix)(\([^)]*\))?!?: (.+)$/;
const ADR_RE = /\s*\(ADRs?\s[^)]*\)/g;
const APP_FILE_RE = /^(apps|packages)\//;
const TEST_FILE_RE = /\.test\.tsx?$/;
const END_RE = /[.:]$/;

/** Whether a commit changes what the app does: a file of it that is not a test. */
const changesTheApp = (commit: Commit) =>
  commit.files.some(
    (file) => APP_FILE_RE.test(file) && !TEST_FILE_RE.test(file)
  );

/** A commit's line in the notes: its behaviour up to its first colon, as a sentence. */
export const lineOf = (subject: string) => {
  const match: RegExpExecArray | null = TYPE_RE.exec(subject);
  const said = match?.[3]?.replace(ADR_RE, "");
  if (!said) {
    return;
  }
  const behaviour = (said.split(": ")[0] ?? said).trim().replace(END_RE, "");
  return `${behaviour.charAt(0).toUpperCase()}${behaviour.slice(1)}.`;
};

/** The notes, newest commit first, ending with the install mark. */
export const releaseNotes = (commits: readonly Commit[]) => {
  const section = (type: "feat" | "fix") =>
    commits
      .filter((c) => c.subject.startsWith(type) && changesTheApp(c))
      .map((c) => lineOf(c.subject))
      .filter((line): line is string => line !== undefined)
      .map((line) => `- ${line}`);
  const parts = [
    ["## What’s new", section("feat")],
    ["## Fixes", section("fix")],
  ] as const;
  const notes = parts
    .filter(([, lines]) => lines.length > 0)
    .map(([title, lines]) => `${title}\n\n${lines.join("\n")}`)
    .join("\n\n");
  return `${notes}${notes ? "\n\n" : ""}${INSTALL_MARK}\n`;
};

/** The commits after `from` up to `to`, each with the files it changed. */
const commitsBetween = (from: string, to: string): Commit[] =>
  execFileSync(
    "git",
    [
      "log",
      "--no-merges",
      "--format=%x00%s",
      "--name-only",
      from ? `${from}..${to}` : to,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  )
    .split("\0")
    .filter((entry) => entry.trim() !== "")
    .map((entry) => {
      const [subject = "", ...files] = entry.split("\n");
      return { files: files.filter((f) => f !== ""), subject };
    });

if (import.meta.main) {
  const [from = "", to = "HEAD"] = process.argv.slice(2);
  process.stdout.write(releaseNotes(commitsBetween(from, to)));
}
