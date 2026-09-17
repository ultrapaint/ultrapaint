import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GitDiff,
  GitFileStatus,
  GitStatus,
} from "@ultrapaint/contracts/git";
import type { RepoPaths } from "./repo.ts";

const execFileAsync = promisify(execFile);

export const git = async (cwd: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
};

export class GitService {
  private readonly paths: RepoPaths;

  constructor(paths: RepoPaths) {
    this.paths = paths;
  }

  async branch(): Promise<string> {
    return (
      await git(this.paths.root, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
  }

  async status(): Promise<GitStatus> {
    const out = await git(this.paths.root, [
      "status",
      "--porcelain=v1",
      "-b",
      "-z",
      "--untracked-files=all",
    ]);
    const entries = out.split("\0").filter(Boolean);
    let branch = "";
    const files: GitFileStatus[] = [];
    let skipNext = false;
    for (const e of entries) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (e.startsWith("## ")) {
        branch = e.slice(3).split("...")[0] ?? "";
        continue;
      }
      const code = e.slice(0, 2);
      let file = e.slice(3);
      if (code[0] === "R" || code[0] === "C") {
        // Renames carry the original path as the next entry.
        skipNext = true;
      }
      file = file.trim();
      files.push({
        code,
        design: this.paths.isInDesigns(file),
        path: file,
        staged: code[0] !== " " && code[0] !== "?",
      });
    }
    return { branch, files };
  }

  async diff(rel: string): Promise<GitDiff> {
    const abs = this.paths.resolve(rel);
    const tracked = await git(this.paths.root, [
      "ls-files",
      "--error-unmatch",
      "--",
      rel,
    ]).then(
      () => true,
      () => false
    );
    if (tracked) {
      const diff = await git(this.paths.root, ["diff", "HEAD", "--", rel]);
      return { diff, path: rel };
    }
    const diff = await git(this.paths.root, [
      "diff",
      "--no-index",
      "--",
      "/dev/null",
      abs,
    ]).catch((e: { stdout?: string }) => e.stdout ?? "");
    return { diff, path: rel };
  }

  async commit(message: string, paths: readonly string[]): Promise<string> {
    for (const p of paths) {
      this.paths.resolve(p);
    }
    await git(this.paths.root, ["add", "--", ...paths]);
    await git(this.paths.root, ["commit", "-m", message, "--", ...paths]);
    return (await git(this.paths.root, ["rev-parse", "HEAD"])).trim();
  }

  async changedSince(snapshot: Map<string, string>): Promise<string[]> {
    const now = await this.snapshot();
    const changed: string[] = [];
    for (const [file, hash] of now) {
      if (snapshot.get(file) !== hash) {
        changed.push(file);
      }
    }
    for (const file of snapshot.keys()) {
      if (!now.has(file)) {
        changed.push(file);
      }
    }
    return changed;
  }

  /** Hash of every changed or untracked file; used to attribute changes to an agent turn. */
  async snapshot(): Promise<Map<string, string>> {
    const status = await this.status();
    const map = new Map<string, string>();
    // One git process at a time, in status order.
    await status.files.reduce(async (previous, f) => {
      await previous;
      if (f.code === " D" || f.code === "D ") {
        map.set(f.path, "deleted");
        return;
      }
      const hash = await git(this.paths.root, [
        "hash-object",
        "--",
        f.path,
      ]).catch(() => "?");
      map.set(f.path, hash.trim());
    }, Promise.resolve());
    return map;
  }

  async stashSnapshot(label: string): Promise<string | null> {
    const sha = await git(this.paths.root, ["stash", "create", label]).catch(
      () => ""
    );
    return sha.trim() || null;
  }
}
