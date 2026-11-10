import { BadRequest, CommandFailed } from "@ultrapaint/contracts/errors";
import type { GitFileStatus, GitStatus } from "@ultrapaint/contracts/git";
import { writesGit } from "@ultrapaint/contracts/settings";
import type { FileDiff } from "@ultrapaint/contracts/snapshots";
import { Context, Effect, Layer, PubSub, Semaphore, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { EventBus } from "../events.ts";
import { runCommand } from "../process.ts";
import { RepoPaths } from "./repo-paths.ts";

/** Runs git and returns stdout and the exit code. Spawn failures surface as `CommandFailed`. */
export const runGit = (
  cwd: string,
  args: readonly string[],
  env?: Record<string, string>
) =>
  runCommand("git", args, { cwd, ...(env && { env }) }).pipe(
    Effect.mapError(
      (cause) =>
        new CommandFailed({ message: `git ${args[0]}: ${cause.message}` })
    )
  );

/** Runs git and fails with `CommandFailed` on a non-zero exit. */
export const git = Effect.fnUntraced(function* (
  cwd: string,
  args: readonly string[],
  env?: Record<string, string>
) {
  const result = yield* runGit(cwd, args, env);
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
    const file = entry.slice(3);
    files.push({
      code,
      design: isInDesigns(file),
      path: file,
      staged: code[0] !== " " && code[0] !== "?",
    });
  }
  return { branch, files };
};

export class GitService extends Context.Service<
  GitService,
  {
    readonly branch: Effect.Effect<string, CommandFailed>;
    /** Each time `init` makes the project's folder a repository. */
    readonly changes: Stream.Stream<void>;
    /**
     * Whether git is installed and the project's folder is in a repository: what git says is
     * read only then. Asked each time, since a repository can be made while the project is open.
     */
    readonly repository: Effect.Effect<boolean>;
    /** `user.name` and `user.email` as git resolves them for the repository; unset ones are absent. */
    readonly user: Effect.Effect<{
      readonly email?: string;
      readonly name?: string;
    }>;
    /**
     * Commits the files; refused unless writing to git is on in the settings. Like every change
     * this service makes to the repository, the editor is told the status after it.
     */
    readonly commit: (
      message: string,
      paths: readonly string[]
    ) => Effect.Effect<string, BadRequest | CommandFailed | ForbiddenPathError>;
    /**
     * Makes the project's folder a repository when it is none; refused unless writing to git is
     * on in the settings. Nothing else ever runs `git init`.
     */
    readonly init: Effect.Effect<void, BadRequest | CommandFailed>;
    readonly diff: (
      rel: string
    ) => Effect.Effect<FileDiff, CommandFailed | ForbiddenPathError>;
    readonly status: Effect.Effect<GitStatus, CommandFailed>;
  }
>()("ultrapaint/server/GitService") {
  static readonly layer = Layer.effect(
    GitService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const events = yield* EventBus;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      // `git status` and friends are cheap; a few at once is plenty.
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
      const run = (args: readonly string[], env?: Record<string, string>) =>
        provide(git(paths.root, args, env));

      const status = Effect.map(
        run(["status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"]),
        (out) => parseStatus(out, paths.isInDesigns)
      ).pipe(Effect.withSpan("GitService.status"));

      /** The editor told the status after a change made here; the change stands if it cannot be read. */
      const publishStatus = Effect.ignore(
        Effect.flatMap(status, (now) => events.publish("git", now)),
        { log: true }
      );

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

      /** Writing to git is the user's to allow, per project (PLAN-desktop D9). */
      const writable = (what: string) =>
        writesGit(paths.settings)
          ? Effect.void
          : Effect.fail(
              new BadRequest({
                message: `Writing to git is off for this project: turn it on in Settings to ${what}.`,
              })
            );

      const commit = Effect.fn("GitService.commit")(function* (
        message: string,
        files: readonly string[]
      ) {
        yield* writable("commit");
        yield* Effect.forEach(files, paths.resolve, { discard: true });
        // Paths, not pathspecs: `:/` or `*` would commit far more than the files the user picked.
        yield* run(["--literal-pathspecs", "add", "--", ...files]);
        yield* run([
          "--literal-pathspecs",
          "commit",
          "-m",
          message,
          "--",
          ...files,
        ]);
        const sha = (yield* run(["rev-parse", "HEAD"])).trim();
        yield* publishStatus;
        return sha;
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

      const repository = provide(
        runGit(paths.root, ["rev-parse", "--is-inside-work-tree"])
      ).pipe(
        Effect.map((r) => r.exitCode === 0 && r.stdout.trim() === "true"),
        // No git on the machine reads the same as no repository.
        Effect.orElseSucceed(() => false)
      );

      const changes = yield* PubSub.unbounded<void>();
      const init = Effect.gen(function* () {
        yield* writable("make this folder a repository");
        if (yield* repository) {
          return;
        }
        yield* run(["init", "--quiet"]);
        yield* PubSub.publish(changes, undefined);
        yield* publishStatus;
      }).pipe(Effect.withSpan("GitService.init"));

      return GitService.of({
        branch: Effect.map(run(["rev-parse", "--abbrev-ref", "HEAD"]), (out) =>
          out.trim()
        ),
        changes: Stream.fromPubSub(changes),
        commit,
        diff,
        init,
        repository,
        status,
        user,
      });
    })
  );
}

type ForbiddenPathError = import("@ultrapaint/contracts/errors").ForbiddenPath;
