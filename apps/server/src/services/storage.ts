import type { StorageInfo } from "@ultrapaint/contracts/settings";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { makeWriteAtomic } from "../atomic-write.ts";
import { ServerConfig, type StorageTarget } from "../config.ts";
import { STATE_DIR_NAME } from "../storage-resolve.ts";
import { runGit } from "./git.ts";

/** What moves with the state when an unsaved session is saved. */
const STATE_SUBDIRS = ["threads", "checkpoints", "catalogue"] as const;

/**
 * Where the server keeps its state. The target is decided at startup, but an unsaved session
 * can be saved while it runs, so everything that touches the state directory asks for it at
 * the moment of use instead of remembering it.
 */
export class Storage extends Context.Service<
  Storage,
  {
    readonly info: Effect.Effect<StorageInfo>;
    /**
     * Turns an unsaved session into one saved at `configPath`: from here on the state lives
     * next to that file, and what the session collected so far is moved there.
     */
    readonly promote: (configPath: string) => Effect.Effect<void>;
    /** Directory for threads, checkpoints and caches. It exists. */
    readonly stateDir: Effect.Effect<string>;
    readonly target: Effect.Effect<StorageTarget>;
  }
>()("ultrapaint/server/Storage") {
  static readonly layer = Layer.effect(
    Storage,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const writeAtomic = makeWriteAtomic(fs, path);

      /** A state directory inside a repository must never end up in a commit. */
      const prepare = Effect.fnUntraced(function* (
        dir: string,
        ignore: boolean
      ) {
        yield* fs.makeDirectory(dir, { recursive: true });
        const file = path.join(dir, ".gitignore");
        if (ignore && !(yield* fs.exists(file))) {
          yield* writeAtomic(file, "*\n");
        }
      }, Effect.orDie);

      let target = config.storage;
      let stateDir: string;
      if (target.mode === "managed") {
        stateDir = target.home;
        yield* prepare(stateDir, false);
      } else if (target.mode === "file") {
        ({ stateDir } = target);
        yield* prepare(stateDir, true);
      } else {
        // Scoped to the layer: the directory goes away when the server shuts down.
        stateDir = yield* Effect.orDie(
          fs.makeTempDirectoryScoped({ prefix: "ultrapaint-" })
        );
      }

      const gitRoot = runGit(config.cwd, ["rev-parse", "--show-toplevel"]).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.map((r) => (r.exitCode === 0 ? r.stdout.trim() : "")),
        // Not inside a repository, or no git: the setup then asks for the path.
        Effect.orElseSucceed(() => "")
      );
      const cwdRepo =
        target.mode === "ephemeral" ? (yield* gitRoot) || undefined : undefined;

      const info = Effect.sync((): StorageInfo => {
        if (target.mode === "file") {
          return {
            configPath: target.configPath,
            defaultRepoPath: path.dirname(target.configPath),
            mode: "file",
          };
        }
        if (target.mode === "managed") {
          return {
            configPath: path.join(target.home, "settings.json"),
            mode: "managed",
          };
        }
        return { defaultRepoPath: cwdRepo, mode: "ephemeral" };
      });

      const promote = Effect.fn("Storage.promote")(function* (
        configPath: string
      ) {
        const from = stateDir;
        const next = path.join(path.dirname(configPath), STATE_DIR_NAME);
        yield* prepare(next, true);
        // Switch first: every write from here on lands in the new directory and carries the
        // whole file, so whatever is already there when the copy arrives is the newer version.
        target = { configPath, mode: "file", stateDir: next };
        stateDir = next;
        for (const sub of STATE_SUBDIRS) {
          const source = path.join(from, sub);
          if (yield* Effect.orElseSucceed(fs.exists(source), () => false)) {
            yield* fs
              .copy(source, path.join(next, sub), { overwrite: false })
              // The session keeps working from memory; only its history would be missing.
              .pipe(Effect.ignore({ log: true }));
          }
        }
      });

      return Storage.of({
        info,
        promote,
        stateDir: Effect.sync(() => stateDir),
        target: Effect.sync(() => target),
      });
    })
  );
}
