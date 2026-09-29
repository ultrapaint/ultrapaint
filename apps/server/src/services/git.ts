import { CommandFailed } from "@ultrapaint/contracts/errors";
import type {
  GitDiff,
  GitFileStatus,
  GitStatus,
} from "@ultrapaint/contracts/git";
import { Context, Effect, Layer, Semaphore } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { runCommand } from "../process.ts";
import { RepoPaths } from "./repo-paths.ts";

/** Runs git and returns stdout and the exit code. Spawn failures surface as `CommandFailed`. */
export const runGit = (cwd: string, args: readonly string[]) =>
  runCommand("git", args, { cwd }).pipe(
    Effect.mapError(
      (cause) =>
        new CommandFailed({ message: `git ${args[0]}: ${cause.message}` })
    )
  );

/** Runs git and fails with `CommandFailed` on a non-zero exit. */
export const git = Effect.fnUntraced(function* (
  cwd: string,
  args: readonly string[]
) {
  const result = yield* runGit(cwd, args);
  if (result.exitCode !== 0) {
    return yield* new CommandFailed({
      message: `git ${args[0]} exited ${result.exitCode}: ${result.stderr.trim()}`,
    });
  }
  return result.stdout;
});

const parseStatus = (
  out: string,
  isInDesigns: (p: string) => boolean
): GitStatus => {
  let branch = "";
  const files: GitFileStatus[] = [];
  let skipNext = false;
  for (const entry of out.split("\0").filter(Boolean)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (entry.startsWith("## ")) {
      branch = entry.slice(3).split("...")[0] ?? "";
      continue;
    }
    const code = entry.slice(0, 2);
    // Renames and copies carry the original path as the next entry.
    skipNext = code[0] === "R" || code[0] === "C";
    const file = entry.slice(3).trim();
    files.push({
      code,
      design: isInDesigns(file),
      path: file,
      staged: code[0] !== " " && code[0] !== "?",
    });
  }
  return { branch, files };
};

/** Content hash per changed or untracked file; used to attribute changes to an agent turn. */
export type GitSnapshot = ReadonlyMap<string, string>;

export class GitService extends Context.Service<
  GitService,
  {
    readonly branch: Effect.Effect<string, CommandFailed>;
    /** `user.name` and `user.email` as git resolves them for the repository; unset ones are absent. */
    readonly user: Effect.Effect<{
      readonly email?: string;
      readonly name?: string;
    }>;
    readonly changedSince: (
      snapshot: GitSnapshot
    ) => Effect.Effect<string[], CommandFailed>;
    readonly commit: (
      message: string,
      paths: readonly string[]
    ) => Effect.Effect<string, CommandFailed | ForbiddenPathError>;
    readonly diff: (
      rel: string
    ) => Effect.Effect<GitDiff, CommandFailed | ForbiddenPathError>;
    readonly snapshot: Effect.Effect<GitSnapshot, CommandFailed>;
    readonly status: Effect.Effect<GitStatus, CommandFailed>;
  }
>()("ultrapaint/server/GitService") {
  static readonly layer = Layer.effect(
    GitService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      // `git status` and friends are cheap but a snapshot fans out one process per file.
      const processes = yield* Semaphore.make(8);
      const provide = <A, E>(
        effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>
      ) =>
        processes.withPermits(1)(
          Effect.provideService(
            effect,
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          )
        );
      const run = (args: readonly string[]) => provide(git(paths.root, args));

      const status = Effect.map(
        run(["status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"]),
        (out) => parseStatus(out, paths.isInDesigns)
      ).pipe(Effect.withSpan("GitService.status"));

      const snapshot = Effect.gen(function* () {
        const { files } = yield* status;
        const hashes = yield* Effect.forEach(
          files,
          (f) =>
            f.code === " D" || f.code === "D "
              ? Effect.succeed([f.path, "deleted"] as const)
              : run(["hash-object", "--", f.path]).pipe(
                  Effect.map((hash) => [f.path, hash.trim()] as const),
                  // A file can disappear between status and hashing.
                  Effect.orElseSucceed(() => [f.path, "?"] as const)
                ),
          { concurrency: "unbounded" }
        );
        return new Map(hashes) as GitSnapshot;
      }).pipe(Effect.withSpan("GitService.snapshot"));

      const changedSince = Effect.fn("GitService.changedSince")(function* (
        before: GitSnapshot
      ) {
        const now = yield* snapshot;
        const changed: string[] = [];
        for (const [file, hash] of now) {
          if (before.get(file) !== hash) {
            changed.push(file);
          }
        }
        for (const file of before.keys()) {
          if (!now.has(file)) {
            changed.push(file);
          }
        }
        return changed;
      });

      const diff = Effect.fn("GitService.diff")(function* (rel: string) {
        const abs = yield* paths.resolve(rel);
        const tracked = yield* provide(
          runGit(paths.root, ["ls-files", "--error-unmatch", "--", rel])
        );
        if (tracked.exitCode === 0) {
          return { diff: yield* run(["diff", "HEAD", "--", rel]), path: rel };
        }
        // `--no-index` exits 1 when the files differ, which is the expected case here.
        const untracked = yield* provide(
          runGit(paths.root, ["diff", "--no-index", "--", "/dev/null", abs])
        );
        return { diff: untracked.stdout, path: rel };
      });

      const commit = Effect.fn("GitService.commit")(function* (
        message: string,
        files: readonly string[]
      ) {
        yield* Effect.forEach(files, paths.resolve, { discard: true });
        yield* run(["add", "--", ...files]);
        yield* run(["commit", "-m", message, "--", ...files]);
        return (yield* run(["rev-parse", "HEAD"])).trim();
      });

      // An unset key exits 1, which only means the value is absent.
      const configValue = (key: string) =>
        provide(runGit(paths.root, ["config", key])).pipe(
          Effect.map((r) =>
            r.exitCode === 0 ? r.stdout.trim() || undefined : undefined
          ),
          Effect.orElseSucceed(() => undefined)
        );

      const user = Effect.gen(function* () {
        const name = yield* configValue("user.name");
        const email = yield* configValue("user.email");
        return {
          ...(name === undefined ? {} : { name }),
          ...(email === undefined ? {} : { email }),
        };
      });

      return GitService.of({
        branch: Effect.map(run(["rev-parse", "--abbrev-ref", "HEAD"]), (out) =>
          out.trim()
        ),
        changedSince,
        commit,
        diff,
        snapshot,
        status,
        user,
      });
    })
  );
}

type ForbiddenPathError = import("@ultrapaint/contracts/errors").ForbiddenPath;
