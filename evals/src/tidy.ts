/**
 * What stays in the data directory and what goes (ADR 0112). Everything outside `.work/` is a
 * result, or what a result reads, and stays. `.work/` is scratch, and three things in it go once
 * nothing reads them: a finished outside run's own install of its packages (`pnpm evals reshoot`
 * installs it again), a lab checkout whose results are on `main`, and a job's log after 30 days.
 */
import path from "node:path";
import { Clock, Effect, FileSystem, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";

/** A run's directory in a round: `run-1`. */
const RUN_DIR_RE = /^run-\d+$/;
/** A long job's log and the process group it wrote down, at the top of `.work/`. */
const JOB_FILE_RE = /\.(log|pgid)$/;
/** How long a job's log stays. */
const LOG_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A result line a lab round writes into a gap: "- `<round>`: …". */
const RESULT_LINE_RE = /^- `([^`]+)`:/;
/** An entry of `git worktree list --porcelain`: its path, and its branch when it has one. */
const WORKTREE_RE = /^worktree (.+)$/m;
const BRANCH_RE = /^branch refs\/heads\/(.+)$/m;
const SPACES_RE = /\s+/;
/** A diff's header line for a file renamed or copied from another. */
const RENAME_RE = /^(rename|copy) (from|to) /;

/** The first group a pattern matches in a text, if it matches. */
const firstGroup = (re: RegExp, text: string): string | undefined => {
  const match: RegExpExecArray | null = re.exec(text);
  return match === null ? undefined : match[1];
};

/** A lab checkout kept, and why. */
export interface Kept {
  readonly path: string;
  readonly why: string;
}

/** What `tidy` found to remove, and the lab checkouts it keeps. */
export interface Tidy {
  /** Lab checkouts whose every change is on `main`. */
  readonly checkouts: readonly string[];
  /** Finished outside runs' own installs: `.work/outside/<round>/<ref>/run-<n>/node_modules`. */
  readonly installs: readonly string[];
  readonly kept: readonly Kept[];
  /** Jobs' logs older than 30 days. */
  readonly logs: readonly string[];
}

/** What a checkout's `git diff` changes in one file. */
export interface FileChange {
  readonly added: readonly string[];
  /** The checkout deleted the file. */
  readonly deleted: boolean;
  /** Its path, as the diff names it; a path git quotes stays quoted, and is never found on main. */
  readonly file: string;
  readonly removed: readonly string[];
  /** The diff says nothing a line can hold: a rename, a mode, a binary file. */
  readonly unread: boolean;
}

/**
 * Whether a lab checkout's changes are all on `main`, or the first that is not, which says why it
 * is kept. A line it adds is on `main` when that file there has the whole line, or when it is a
 * round's result line whose round `main`'s file names, since a result line can be reworded when it
 * is carried over (a version renamed). A line it removes is when `main` lacks it too, and a file
 * it deletes when `main` has no such file.
 */
export const changesOnMain = (
  changes: readonly FileChange[],
  main: ReadonlyMap<string, string | undefined>
): Option.Option<string> => {
  for (const change of changes) {
    const why = whyNotOnMain(change, main.get(change.file));
    if (why !== undefined) {
      return Option.some(`${change.file}: ${why}`);
    }
  }
  return Option.none();
};

/** Why one file's change is not on `main`, whose text of the file is `text`, if it is not. */
const whyNotOnMain = (
  change: FileChange,
  text: string | undefined
): string | undefined => {
  if (change.unread) {
    return "its change is not one of lines";
  }
  if (change.deleted) {
    return text === undefined ? undefined : "deleted here, still on main";
  }
  const lines = new Set(text === undefined ? [] : text.split("\n"));
  const isOnMain = (line: string) => {
    const round = firstGroup(RESULT_LINE_RE, line);
    return (
      text !== undefined &&
      (lines.has(line) ||
        (round !== undefined && text.includes(`\`${round}\``)))
    );
  };
  const added = change.added.find((l) => l.trim() !== "" && !isOnMain(l));
  if (added !== undefined) {
    return `"${added.slice(0, 80)}" is not on main`;
  }
  const removed = change.removed.find((l) => l.trim() !== "" && lines.has(l));
  return removed === undefined
    ? undefined
    : `removes "${removed.slice(0, 80)}", which main still has`;
};

/** One file's part of a diff, as it is read. */
interface Reading {
  added: string[];
  deleted: boolean;
  file: string | undefined;
  hunks: boolean;
  old: string | undefined;
  removed: string[];
  /** A rename or a copy: the file it came from is not checked against main. */
  renamed: boolean;
}

const changeRead = (r: Reading): FileChange => ({
  added: r.added,
  deleted: r.deleted,
  file: r.file ?? r.old ?? "(a file git named oddly)",
  removed: r.removed,
  unread: r.renamed || (!r.deleted && (r.file === undefined || !r.hunks)),
});

/** A line of a file's header; true when it opens the first hunk. */
const readHeader = (r: Reading, line: string): boolean => {
  if (line.startsWith("--- ")) {
    r.old = line.startsWith("--- a/") ? line.slice(6) : line.slice(4);
  } else if (line === "+++ /dev/null") {
    r.deleted = true;
  } else if (line.startsWith("+++ ")) {
    r.file = line.startsWith("+++ b/") ? line.slice(6) : line.slice(4);
  } else if (line.startsWith("@@")) {
    r.hunks = true;
    return true;
  } else if (RENAME_RE.test(line)) {
    r.renamed = true;
  }
  return false;
};

/** The changes a `git diff -U0` makes, file by file; a line inside a hunk is never a header. */
export const changesOf = (diff: string): FileChange[] => {
  const readings: Reading[] = [];
  let current: Reading | undefined;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = {
        added: [],
        deleted: false,
        file: undefined,
        hunks: false,
        old: undefined,
        removed: [],
        renamed: false,
      };
      readings.push(current);
      inHunk = false;
    } else if (current !== undefined && !inHunk) {
      inHunk = readHeader(current, line);
    } else if (current !== undefined && line.startsWith("+")) {
      current.added.push(line.slice(1));
    } else if (current !== undefined && line.startsWith("-")) {
      current.removed.push(line.slice(1));
    }
  }
  return readings.map(changeRead);
};

/** A command's output; it fails when the command exits with anything but 0. */
const run = (cwd: string, command: string, args: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(
        ChildProcess.make(command, args, { cwd, stdin: "ignore" })
      );
      const [stdout, , code] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.runDrain),
          child.exitCode,
        ],
        { concurrency: "unbounded" }
      );
      if (code !== 0) {
        return yield* new EvalsError({
          message: `${command} ${args.join(" ")} exited ${code}, in ${cwd}`,
        });
      }
      return stdout;
    })
  );

const git = (cwd: string, ...args: string[]) => run(cwd, "git", args);

/** A file as `main` has it, or nothing when `main` has no such file. */
const onMain = Effect.fn("onMain")(function* (checkout: string, file: string) {
  const listed = yield* git(
    checkout,
    "ls-tree",
    "--name-only",
    "origin/main",
    "--",
    file
  );
  if (listed.trim() === "") {
    return;
  }
  return yield* git(checkout, "show", `origin/main:${file}`);
});

/**
 * Why a detached lab checkout is kept, or nothing when everything in it is on `main`: its commit
 * is one of `main`'s, git tracks every file in it, and each change it holds is on `main`. A
 * checkout git cannot read is kept.
 */
export const whyKept = Effect.fn("whyKept")(function* (at: string) {
  const { checkout } = yield* EvalsConfig;
  return yield* Effect.gen(function* () {
    const head = (yield* git(at, "rev-parse", "HEAD")).trim();
    const onMainline = yield* git(
      checkout,
      "merge-base",
      "--is-ancestor",
      head,
      "origin/main"
    ).pipe(
      Effect.as(true),
      Effect.catchTag("EvalsError", () => Effect.succeed(false))
    );
    if (!onMainline) {
      return Option.some(`its commit ${head.slice(0, 8)} is not on main`);
    }
    // Asked for outright: a setting can hide untracked files from `status`.
    const status = (yield* git(
      at,
      "status",
      "--porcelain",
      "--untracked-files=all"
    ))
      .split("\n")
      .filter((line) => line !== "");
    if (status.some((line) => line.startsWith("??"))) {
      return Option.some("it has files git does not track");
    }
    // Git's own patch, never a renderer a setting names, of the files as stored.
    const changes = changesOf(
      yield* git(at, "diff", "--no-ext-diff", "--no-textconv", "-U0", "HEAD")
    );
    if (changes.length < status.length) {
      return Option.some("git says it changed files its diff does not show");
    }
    const main = new Map<string, string | undefined>();
    for (const change of changes) {
      if (!change.unread) {
        main.set(change.file, yield* onMain(checkout, change.file));
      }
    }
    return changesOnMain(changes, main);
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(Option.some(`git could not read it: ${String(error)}`))
    )
  );
});

/** The finished outside runs that installed their packages over the host's link. */
const findInstalls = Effect.fn("findInstalls")(function* () {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const outside = path.join(data.work, "outside");
  const list = (dir: string) =>
    fs.readDirectory(dir).pipe(Effect.orElseSucceed((): string[] => []));
  // A file where a directory was expected is not there either.
  const exists = (file: string) =>
    fs.exists(file).pipe(Effect.orElseSucceed(() => false));
  const installs: string[] = [];
  for (const round of yield* list(outside)) {
    for (const reference of yield* list(path.join(outside, round))) {
      for (const runDir of yield* list(path.join(outside, round, reference))) {
        const modules = path.join(
          outside,
          round,
          reference,
          runDir,
          "node_modules"
        );
        const finished =
          RUN_DIR_RE.test(runDir) &&
          (yield* exists(
            path.join(data.runs, round, reference, runDir, "run.json")
          ));
        if (!finished) {
          continue;
        }
        // The host's link is a link; an install of its own is a directory.
        const ownInstall =
          (yield* exists(modules)) &&
          (yield* fs.readLink(modules).pipe(
            Effect.as(false),
            Effect.orElseSucceed(() => true)
          ));
        if (ownInstall) {
          installs.push(modules);
        }
      }
    }
  }
  return installs;
});

/** The lab checkouts in `.work/`: those whose changes are all on `main`, and those kept. */
const findCheckouts = Effect.fn("findCheckouts")(function* () {
  const { checkout, data } = yield* EvalsConfig;
  const listed = yield* git(checkout, "worktree", "list", "--porcelain");
  const checkouts: string[] = [];
  const kept: Kept[] = [];
  for (const entry of listed.split("\n\n")) {
    const at = firstGroup(WORKTREE_RE, entry);
    if (at === undefined || !at.startsWith(data.work + path.sep)) {
      continue;
    }
    const branch = firstGroup(BRANCH_RE, entry);
    const why =
      branch === undefined
        ? yield* whyKept(at)
        : Option.some(`on the branch ${branch}`);
    if (Option.isSome(why)) {
      kept.push({ path: at, why: why.value });
    } else {
      checkouts.push(at);
    }
  }
  return { checkouts, kept };
});

/** The jobs' logs at the top of `.work/` last written more than 30 days ago. */
const findLogs = Effect.fn("findLogs")(function* () {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const now = yield* Clock.currentTimeMillis;
  const logs: string[] = [];
  const files = yield* fs
    .readDirectory(data.work)
    .pipe(Effect.orElseSucceed((): string[] => []));
  for (const name of files) {
    if (!JOB_FILE_RE.test(name)) {
      continue;
    }
    const file = path.join(data.work, name);
    const written = Option.getOrUndefined(
      (yield* fs.stat(file)).mtime
    )?.getTime();
    if (written !== undefined && now - written > LOG_DAYS * DAY_MS) {
      logs.push(file);
    }
  }
  return logs;
});

/** What `tidy` would remove; nothing is removed. */
export const findScratch = Effect.fn("findScratch")(function* () {
  const { checkouts, kept } = yield* findCheckouts();
  return {
    checkouts,
    installs: yield* findInstalls(),
    kept,
    logs: yield* findLogs(),
  } satisfies Tidy;
});

/** Why removing must stop now: a lab job runs, or systemd cannot say; nothing when it may go on. */
const jobsInTheWay = Effect.gen(function* () {
  const running = yield* runningLabJobs.pipe(
    Effect.catch(() => Effect.succeed(undefined))
  );
  if (running === undefined) {
    return "systemd could not say whether a lab job runs";
  }
  return running.length > 0
    ? `${running.join(", ")} may be reading it`
    : undefined;
});

/**
 * Removes what `findScratch` found, asking systemd before each removal and stopping when a lab job
 * runs; the reason it stopped, or nothing when it removed all of it. A job that starts in the moment
 * between the question and the removal is not seen.
 */
export const removeScratch = Effect.fn("removeScratch")(function* (
  found: Tidy
) {
  const { checkout } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  for (const install of found.installs) {
    const stop = yield* jobsInTheWay;
    if (stop !== undefined) {
      return stop;
    }
    yield* fs.remove(install, { force: true, recursive: true });
  }
  for (const at of found.checkouts) {
    const stop = yield* jobsInTheWay;
    if (stop !== undefined) {
      return stop;
    }
    // Judged again at the moment it goes: it may have changed since it was listed.
    const why = yield* whyKept(at);
    if (Option.isSome(why)) {
      yield* Effect.log(`${at}: kept after all, ${why.value}`);
      continue;
    }
    // Forced: what it changed is on main, and its installed packages are ignored files.
    yield* git(checkout, "worktree", "remove", "--force", at);
  }
  for (const log of found.logs) {
    const stop = yield* jobsInTheWay;
    if (stop !== undefined) {
      return stop;
    }
    yield* fs.remove(log, { force: true });
  }
});

/**
 * The lab's long jobs running now (`lab-*` units), which may be reading what `tidy` removes. It
 * fails when systemd cannot be asked, so nothing is removed on a guess.
 */
export const runningLabJobs = Effect.gen(function* () {
  const { data } = yield* EvalsConfig;
  const units = yield* run(data.root, "systemctl", [
    "--user",
    "list-units",
    "--state=active",
    "--plain",
    "--no-legend",
    "lab-*",
  ]);
  return units
    .split("\n")
    .map((line) => line.trim().split(SPACES_RE)[0] ?? "")
    .filter((unit) => unit !== "");
});
