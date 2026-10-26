import type { RestoreEntry } from "@ultrapaint/contracts/design-system-setup";
import { BadRequest, CommandFailed } from "@ultrapaint/contracts/errors";
import type {
  GitDiff,
  GitFileStatus,
  GitStatus,
} from "@ultrapaint/contracts/git";
import { writesGit } from "@ultrapaint/contracts/settings";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Random,
  Schedule,
  Semaphore,
} from "effect";
import { ChildProcessSpawner } from "effect/process";
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

/** A file that differs between two trees: added, modified or deleted in the second. */
export interface TreeChange {
  readonly path: string;
  readonly status: "A" | "M" | "D";
}

/** Paths per `git restore`, well under any command line's limit. */
const RESTORE_CHUNK = 200;

const parseNameStatus = (out: string): TreeChange[] => {
  const parts = out.split("\0").filter(Boolean);
  const changes: TreeChange[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i]?.[0];
    const file = parts[i + 1];
    if (file && (code === "A" || code === "M" || code === "D")) {
      changes.push({ path: file, status: code });
    } else if (file && code === "T") {
      changes.push({ path: file, status: "M" });
    }
  }
  return changes;
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
    /** Commits the files; refused unless writing to git is on in the settings. */
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
    ) => Effect.Effect<GitDiff, CommandFailed | ForbiddenPathError>;
    /** The files that differ between two trees, repo-relative, as the second has them. */
    readonly changedBetween: (
      from: string,
      to: string
    ) => Effect.Effect<readonly TreeChange[], CommandFailed>;
    /** Removes a ref `snapshotTree` made. */
    readonly deleteRef: (ref: string) => Effect.Effect<void, CommandFailed>;
    /** Every file of the working tree git would keep: tracked and untracked, not ignored. */
    readonly files: Effect.Effect<readonly string[], CommandFailed>;
    /**
     * Puts files back as a tree has them, and removes the ones it does not have. The working
     * tree only: the index, the branch and the stash are left as they are.
     */
    readonly restoreFrom: (
      tree: string,
      entries: readonly RestoreEntry[]
    ) => Effect.Effect<void, CommandFailed | ForbiddenPathError>;
    /**
     * Writes the working tree as it is into a git tree, untracked files included and ignored ones
     * left out, through an index of its own, and points `<prefix>/<tree>` at it so it outlives
     * `git gc`.
     */
    readonly snapshotTree: (
      prefix: string
    ) => Effect.Effect<string, CommandFailed>;
    readonly status: Effect.Effect<GitStatus, CommandFailed>;
  }
>()("ultrapaint/server/GitService") {
  static readonly layer = Layer.effect(
    GitService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
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
      const run = (args: readonly string[], env?: Record<string, string>) =>
        provide(git(paths.root, args, env));

      const status = Effect.map(
        run(["status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"]),
        (out) => parseStatus(out, paths.isInDesigns)
      ).pipe(Effect.withSpan("GitService.status"));

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

      const snapshotTree = Effect.fn("GitService.snapshotTree")(function* (
        prefix: string
      ) {
        const real = path.resolve(
          paths.root,
          (yield* run(["rev-parse", "--git-path", "index"])).trim()
        );
        const suffix = (yield* Random.nextIntBetween(0, 2 ** 31)).toString(36);
        const index = `${real}.ultrapaint-${suffix}`;
        // The real index is copied for what it knows of the files' timestamps, so only what
        // changed is hashed again; a repository without commits has none yet.
        yield* fs.copyFile(real, index).pipe(Effect.ignore);
        const env = { GIT_INDEX_FILE: index };
        const tree = yield* Effect.gen(function* () {
          // A file written atomically elsewhere can vanish between git listing it and reading
          // it ("adding files failed"); the working tree a moment later is as good a snapshot.
          yield* run(["add", "--all", "--", ":/"], env).pipe(
            Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 3 })
          );
          return (yield* run(["write-tree"], env)).trim();
        }).pipe(Effect.ensuring(Effect.ignore(fs.remove(index))));
        yield* run(["update-ref", `${prefix}/${tree}`, tree]);
        return tree;
      });

      const changedBetween = Effect.fn("GitService.changedBetween")(function* (
        from: string,
        to: string
      ) {
        if (from === to) {
          return [];
        }
        return parseNameStatus(
          yield* run([
            "diff",
            "--name-status",
            "--no-renames",
            "--relative",
            "-z",
            from,
            to,
          ])
        );
      });

      const restoreFrom = Effect.fn("GitService.restoreFrom")(function* (
        tree: string,
        entries: readonly RestoreEntry[]
      ) {
        const restored = entries
          .filter((e) => e.action === "restore")
          .map((e) => e.path);
        yield* Effect.forEach(restored, paths.resolve, { discard: true });
        for (let i = 0; i < restored.length; i += RESTORE_CHUNK) {
          yield* run([
            "restore",
            `--source=${tree}`,
            "--worktree",
            "--",
            ...restored.slice(i, i + RESTORE_CHUNK),
          ]);
        }
        for (const entry of entries) {
          if (entry.action === "delete") {
            const abs = yield* paths.resolve(entry.path);
            // Already gone is what was asked for.
            yield* Effect.ignore(fs.remove(abs));
          }
        }
      });

      const deleteRef = Effect.fn("GitService.deleteRef")(function* (
        ref: string
      ) {
        yield* run(["update-ref", "-d", ref]);
      });

      const repository = provide(
        runGit(paths.root, ["rev-parse", "--is-inside-work-tree"])
      ).pipe(
        Effect.map((r) => r.exitCode === 0 && r.stdout.trim() === "true"),
        // No git on the machine reads the same as no repository.
        Effect.orElseSucceed(() => false)
      );

      const init = Effect.gen(function* () {
        yield* writable("make this folder a repository");
        if (yield* repository) {
          return;
        }
        yield* run(["init", "--quiet"]);
      }).pipe(Effect.withSpan("GitService.init"));

      const listFiles = Effect.map(
        run(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
        (out) => [...new Set(out.split("\0").filter(Boolean))]
      ).pipe(Effect.withSpan("GitService.files"));

      return GitService.of({
        branch: Effect.map(run(["rev-parse", "--abbrev-ref", "HEAD"]), (out) =>
          out.trim()
        ),
        changedBetween,
        commit,
        deleteRef,
        diff,
        files: listFiles,
        init,
        repository,
        restoreFrom,
        snapshotTree,
        status,
        user,
      });
    })
  );
}

type ForbiddenPathError = import("@ultrapaint/contracts/errors").ForbiddenPath;
