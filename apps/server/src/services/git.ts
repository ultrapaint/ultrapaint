import { DESIGN_MD_FILE } from "@ultrapaint/contracts/design-system";
import { type BadRequest, CommandFailed } from "@ultrapaint/contracts/errors";
import type { GitFileStatus, GitStatus } from "@ultrapaint/contracts/git";
import type { FileDiff } from "@ultrapaint/contracts/snapshots";
import { Context, Effect, FileSystem, Layer, Path, Semaphore } from "effect";
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

/**
 * `git diff --numstat -z`: each file's lines added and removed, by its path now; null for a
 * binary file, whose lines git does not count. A rename names both paths after its counts.
 */
export const parseNumstat = (out: string) => {
  const counted = new Map<string, { added: number; removed: number } | null>();
  const entries = out.split("\0");
  for (let i = 0; i < entries.length; i += 1) {
    const [added, removed, file = ""] = (entries[i] ?? "").split("\t");
    if (added === undefined || removed === undefined) {
      continue;
    }
    let path = file;
    if (path === "") {
      // A rename: the old path, then the new one, as entries of their own.
      path = entries[i + 2] ?? "";
      i += 2;
    }
    if (path !== "") {
      counted.set(
        path,
        added === "-"
          ? null
          : { added: Number(added), removed: Number(removed) }
      );
    }
  }
  return counted;
};

const parseStatus = (
  out: string,
  isInDesigns: (p: string) => boolean
): GitStatus => {
  const files: GitFileStatus[] = [];
  let skipNext = false;
  for (const entry of out.split("\0").filter(Boolean)) {
    if (skipNext) {
      skipNext = false;
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
    });
  }
  return { files };
};

export class GitService extends Context.Service<
  GitService,
  {
    readonly branch: Effect.Effect<string, CommandFailed>;
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
     * Commits the files: only ever when the person presses Commit, which is their approval
     * (ADR 0087). Like every change this service makes to the repository, the editor is told the
     * status after it.
     */
    readonly commit: (
      message: string,
      paths: readonly string[]
    ) => Effect.Effect<string, BadRequest | CommandFailed | ForbiddenPathError>;
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
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
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

      /** What git says when it runs, or null when it says nothing (no commit yet, no branch). */
      const said = (args: readonly string[]) =>
        provide(runGit(paths.root, args)).pipe(
          Effect.map((r) => (r.exitCode === 0 ? r.stdout : null)),
          Effect.orElseSucceed(() => null)
        );

      /** A file's lines, all of them added: one git does not track yet. Null when unreadable. */
      const linesOf = (rel: string) =>
        fs.readFileString(path.join(paths.root, rel)).pipe(
          Effect.map((text) =>
            text === ""
              ? 0
              : text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
          ),
          Effect.orElseSucceed(() => null)
        );

      const status = Effect.gen(function* () {
        const listed = parseStatus(
          yield* run([
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
          ]),
          // Ultrapaint's own: the designs, and the design system's document (ADR 0027).
          (p) => paths.isInDesigns(p) || p === DESIGN_MD_FILE
        );
        const [numstat, last, branch] = yield* Effect.all(
          [
            said(["diff", "--numstat", "-z", "HEAD"]),
            said(["log", "-1", "--format=%ct%x00%s"]),
            said(["symbolic-ref", "--short", "-q", "HEAD"]),
          ],
          { concurrency: "unbounded" }
        );
        const counted = parseNumstat(numstat ?? "");
        const files = yield* Effect.forEach(
          listed.files,
          (file) =>
            Effect.gen(function* () {
              const known = counted.get(file.path);
              if (known !== undefined) {
                return known === null ? file : { ...file, lines: known };
              }
              if (file.code !== "??") {
                return file;
              }
              const added = yield* linesOf(file.path);
              return added === null
                ? file
                : { ...file, lines: { added, removed: 0 } };
            }),
          { concurrency: 8 }
        );
        const [at, ...subject] = (last ?? "").trim().split("\0");
        const branchName = (branch ?? "").trim();
        return {
          ...(branchName === "" ? {} : { branch: branchName }),
          files,
          ...(at && subject.length > 0
            ? {
                lastCommit: {
                  at: Number(at) * 1000,
                  message: subject.join(""),
                },
              }
            : {}),
        } satisfies GitStatus;
      }).pipe(Effect.withSpan("GitService.status"));

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

      /** Takes files out of the index again; with no commit yet, there is no HEAD to reset to. */
      const unstage = (files: readonly string[]) =>
        files.length === 0
          ? Effect.void
          : run(["rev-parse", "--verify", "-q", "HEAD"]).pipe(
              Effect.flatMap(() =>
                run(["--literal-pathspecs", "reset", "-q", "--", ...files])
              ),
              Effect.catch(() =>
                run([
                  "--literal-pathspecs",
                  "rm",
                  "-q",
                  "--cached",
                  "--",
                  ...files,
                ])
              ),
              // Unstaging is a courtesy after the failure the person is shown: its own failure isn't theirs.
              Effect.ignore
            );

      const commit = Effect.fn("GitService.commit")(function* (
        message: string,
        files: readonly string[]
      ) {
        yield* Effect.forEach(files, paths.resolve, { discard: true });
        // Paths, not pathspecs: `:/` or `*` would commit far more than the files the user picked.
        const stagedBefore = new Set(
          (yield* run([
            "--literal-pathspecs",
            "diff",
            "--cached",
            "--name-only",
            "-z",
            "--",
            ...files,
          ]))
            .split("\0")
            .filter(Boolean)
        );
        yield* run(["--literal-pathspecs", "add", "--", ...files]);
        yield* run([
          "--literal-pathspecs",
          "commit",
          "-m",
          message,
          "--",
          ...files,
        ]).pipe(
          // A commit that fails (a hook, an empty message) leaves the index as it found it: what
          // it staged itself is unstaged, what the person had staged stays.
          Effect.tapError(() =>
            unstage(files.filter((f) => !stagedBefore.has(f)))
          )
        );
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

      return GitService.of({
        branch: Effect.map(run(["rev-parse", "--abbrev-ref", "HEAD"]), (out) =>
          out.trim()
        ),
        commit,
        diff,
        repository,
        status,
        user,
      });
    })
  );
}

type ForbiddenPathError = import("@ultrapaint/contracts/errors").ForbiddenPath;
