import { CONFIG_FILE_NAME } from "@ultrapaint/contracts/settings";
import { Effect, FileSystem, Path } from "effect";
import type { StorageTarget } from "./config.ts";

/** Directory next to a configuration file that holds threads, checkpoints and caches. */
export const STATE_DIR_NAME = ".ultrapaint";

export interface StorageFlags {
  /** `--config`: a configuration file, relative to `cwd` or absolute. It need not exist yet. */
  readonly config: string | undefined;
  readonly cwd: string;
  /** `--ephemeral`: save nothing, even when a configuration file could be found. */
  readonly ephemeral: boolean;
  /** `--home`: a directory that keeps settings and state; with `--config` it only relocates the state. */
  readonly home: string | undefined;
  /** `--session-dir`: where an unsaved session keeps what it has, across restarts of the server. */
  readonly sessionDir?: string | undefined;
  /** The user's home directory. */
  readonly userHome: string;
}

export interface ResolvedStorage {
  readonly storage: StorageTarget;
  readonly userDir: string;
}

/**
 * Picks the storage mode. An explicit `--config` wins, then `--ephemeral`, then `--home`;
 * with none of them the nearest `ultrapaint.json` from the working directory upwards is used,
 * and when there is none nothing is saved.
 */
export const resolveStorage = Effect.fn("resolveStorage")(function* (
  flags: StorageFlags
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const userDir = flags.home ?? path.join(flags.userHome, STATE_DIR_NAME);

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
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    // A directory that cannot be read is simply not where the configuration is.
    if (yield* Effect.orElseSucceed(fs.exists(candidate), () => false)) {
      return fileTarget(candidate);
    }
  }
  return ephemeral;
});
