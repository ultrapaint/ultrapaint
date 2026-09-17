import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  Settings,
  type SettingsValidation,
} from "@ultrapaint/contracts/settings";
import { Schema as S } from "effect";
import { writeAtomic } from "../util.ts";
import { git } from "./git.ts";

/** Tool-local state lives under the home directory (default `~/.ultrapaint`). */
export class SettingsService {
  private current: Settings | null = null;
  readonly home: string;

  constructor(home: string) {
    this.home = home;
    mkdirSync(home, { recursive: true });
    const { file } = this;
    if (existsSync(file)) {
      try {
        this.current = S.decodeUnknownSync(Settings)(
          JSON.parse(readFileSync(file, "utf8"))
        );
      } catch (error) {
        console.warn(
          `[ultrapaint] ignoring invalid settings at ${file}:`,
          (error as Error).message
        );
      }
    }
  }

  private get file() {
    return path.join(this.home, "settings.json");
  }

  get(): Settings | null {
    return this.current;
  }

  async validate(settings: Settings): Promise<SettingsValidation> {
    const problems: string[] = [];
    const repo = path.resolve(settings.repoPath);
    if (!path.isAbsolute(settings.repoPath)) {
      problems.push("Repository path must be absolute.");
    }
    if (existsSync(repo)) {
      if (!existsSync(path.join(repo, "package.json"))) {
        problems.push("Repository has no package.json.");
      }
      const inside = await git(repo, [
        "rev-parse",
        "--is-inside-work-tree",
      ]).catch(() => null);
      if (inside?.trim() !== "true") {
        problems.push("Repository path is not a git work tree.");
      }
    } else {
      problems.push(`Repository path does not exist: ${repo}`);
    }
    const designs = path.join(repo, settings.designsDir);
    if (!existsSync(designs)) {
      problems.push(`Designs directory does not exist: ${settings.designsDir}`);
    } else if (!existsSync(path.join(designs, "package.json"))) {
      problems.push(
        "Designs directory should be a workspace package with its own package.json so screens can resolve React and the design system."
      );
    }
    for (const dir of settings.libraryDirs) {
      if (!existsSync(path.join(repo, dir))) {
        problems.push(`Library directory does not exist: ${dir}`);
      }
    }
    const branch =
      problems.length === 0
        ? (
            await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(
              () => ""
            )
          ).trim()
        : undefined;
    return {
      branch,
      ok: problems.length === 0,
      problems,
      repoName: path.basename(repo),
    };
  }

  async set(settings: Settings): Promise<SettingsValidation> {
    const validation = await this.validate(settings);
    if (!validation.ok) {
      return validation;
    }
    this.current = { ...settings, repoPath: path.resolve(settings.repoPath) };
    writeAtomic(
      this.file,
      JSON.stringify(S.encodeSync(Settings)(this.current), null, 2)
    );
    return validation;
  }
}
