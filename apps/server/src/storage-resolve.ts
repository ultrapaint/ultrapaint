import { CONFIG_FILE_NAMES } from "@ultrapaint/contracts/settings";
import { Config, Effect, FileSystem, Path } from "effect";
import { Flag } from "effect/cli";
import type { StorageTarget } from "./config.ts";

/**
 * Directory next to a configuration file that holds threads, checkpoints and caches; and the
 * person's folder's name, wherever it is (ADR 0091).
 */
export const STATE_DIR_NAME = ".ultrapaint";

/**
 * `--user-dir <dir>`, or `ULTRAPAINT_USER_DIR`: the folder the person's folder is in, which keeps
 * its name, `<dir>/.ultrapaint` (ADR 0091). The server and `ultrapaint mcp` both take it.
 */
export const userDirFlag = Flag.String("user-dir").pipe(
  Flag.withDescription(
    "Folder your own .ultrapaint folder is in (default: your home folder): your name, review findings and chat preferences, the same in every project"
  ),
  Flag.withFallbackConfig(Config.String("ULTRAPAINT_USER_DIR")),
  Flag.optional
);

interface StorageFlags {
  /** `--config`: a configuration file, relative to `cwd` or absolute. It need not exist yet. */
  readonly config: string | undefined;
  readonly cwd: string;
  /** `--ephemeral`: save nothing, even when a configuration file could be found. */
  readonly ephemeral: boolean;
  /** `--home`: a directory that keeps settings and state; with `--config` it only relocates the state. */
  readonly home: string | undefined;
  /** `--session-dir`: where an unsaved session keeps what it has, across restarts of the server. */
  readonly sessionDir?: string | undefined;
  /**
   * `--user-dir`: the folder the person's folder (`.ultrapaint`) is in, relative to `cwd` or
   * absolute. It wins over `--home` for that folder, and changes nothing of the storage.
   */
  readonly userDir?: string | undefined;
  /** The user's home directory. */
  readonly userHome: string;
}

interface ResolvedStorage {
  readonly storage: StorageTarget;
  readonly userDir: string;
}

/**
 * Picks the storage mode. An explicit `--config` wins, then `--ephemeral`, then `--home`;
 * with none of them the nearest `ultrapaint.config.json` (or, from before v0.2,
 * `ultrapaint.json`) from the working directory upwards is used,
 * and when there is none nothing is saved. The person's folder is apart from all of it:
 * `.ultrapaint` in `--user-dir`, else `--home` itself, else `~/.ultrapaint`.
 */
export const resolveStorage = Effect.fn("resolveStorage")(function* (
  flags: StorageFlags
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const userDir = flags.userDir
    ? path.join(path.resolve(flags.cwd, flags.userDir), STATE_DIR_NAME)
    : (flags.home ?? path.join(flags.userHome, STATE_DIR_NAME));

  const fileTarget = (configPath: string): ResolvedStorage => ({
    storage: {
      configPath,
      mode: "file",
      stateDir:
        flags.home ?? path.join(path.dirname(configPath), STATE_DIR_NAME),
    },
    userDir,
  });

  const ephemeral: ResolvedStorage = {
    storage: flags.sessionDir
      ? {
          mode: "ephemeral",
          sessionDir: path.resolve(flags.cwd, flags.sessionDir),
        }
      : { mode: "ephemeral" },
    userDir,
  };

  if (flags.config) {
    return fileTarget(path.resolve(flags.cwd, flags.config));
  }
  if (flags.ephemeral) {
    return ephemeral;
  }
  if (flags.home) {
    return {
      storage: { home: flags.home, mode: "managed" },
      userDir,
    } as ResolvedStorage;
  }

  // The working directory and every directory above it, nearest first.
  const ancestors: string[] = [];
  for (
    let dir = path.resolve(flags.cwd);
    !ancestors.includes(dir);
    dir = path.dirname(dir)
  ) {
    ancestors.push(dir);
  }
  for (const dir of ancestors) {
    // The current name wins over the old one in the same directory.
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = path.join(dir, name);
      // A directory that cannot be read is simply not where the configuration is.
      if (yield* Effect.orElseSucceed(fs.exists(candidate), () => false)) {
        return fileTarget(candidate);
      }
    }
  }
  return ephemeral;
});
