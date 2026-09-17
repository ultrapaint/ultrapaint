import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Settings } from "@ultrapaint/contracts";
import { AppError } from "../router.ts";
import { toPosix } from "../util.ts";

/**
 * Every filesystem path the server touches on behalf of the editor or an agent goes through
 * here. Paths are resolved against the repository, symlinks are followed, and anything that
 * ends up outside the repository is refused.
 */
export class RepoPaths {
  readonly root: string;
  readonly realRoot: string;
  readonly designsDir: string;

  constructor(readonly settings: Settings) {
    this.root = path.resolve(settings.repoPath);
    this.realRoot = realpathSync(this.root);
    this.designsDir = path.join(this.root, settings.designsDir);
  }

  /** Resolves a repo-relative (or absolute) path and asserts it stays inside the repository. */
  resolve(p: string): string {
    const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(this.root, p);
    // Walk up to the nearest existing ancestor so symlinked parents are followed.
    let probe = abs;
    while (!existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const real = existsSync(probe) ? realpathSync(probe) : probe;
    const inside = real === this.realRoot || real.startsWith(this.realRoot + path.sep);
    if (!inside) throw new AppError("forbidden_path", `path escapes the repository: ${p}`);
    return abs;
  }

  /** Repo-relative posix path for an absolute path inside the repo. */
  relative(abs: string): string {
    return toPosix(path.relative(this.root, abs));
  }

  isInDesigns(rel: string): boolean {
    const posix = toPosix(rel);
    const designs = toPosix(this.settings.designsDir);
    return posix === designs || posix.startsWith(`${designs}/`);
  }

  isEditable(rel: string): boolean {
    return (
      this.isInDesigns(rel) &&
      !toPosix(rel).includes("/.ultrapaint/") &&
      !toPosix(rel).includes("/node_modules/")
    );
  }
}
