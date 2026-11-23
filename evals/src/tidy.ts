/**
 * What stays in the data directory and what goes (ADR 0112). Everything outside `.work/` is a
 * result, or what a result reads, and stays. `.work/` is scratch, and three things in it go once
 * nothing reads them: a finished outside run's own install of its packages (`pnpm evals reshoot`
 * installs it again), a lab checkout whose results are on `main`, and a job's log after 30 days.
 */
import path from "node:path";
import { Clock, Effect, FileSystem, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { EvalsConfig } from "./config.ts";

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

/**
 * Whether a lab checkout's changes are all on `main`: each line it adds is in that file there, or
 * is a round's result line whose round `main`'s file names, since a result line can be reworded
 * when it is carried over (a version renamed). The first line not there says why it is kept.
 */
export const changesOnMain = (
  added: ReadonlyMap<string, readonly string[]>,
  main: ReadonlyMap<string, string | undefined>
): Option.Option<string> => {
  for (const [file, lines] of added) {
    const text = main.get(file);
    for (const line of lines) {
      if (line.trim() === "") {
        continue;
      }
      const round = firstGroup(RESULT_LINE_RE, line);
      const there =
        text !== undefined &&
        (text.includes(line) ||
          (round !== undefined && text.includes(`\`${round}\``)));
      if (!there) {
        return Option.some(`${file}: "${line.slice(0, 80)}" is not on main`);
      }
    }
  }
  return Option.none();
};

/** The lines a `git diff -U0` adds, by file. */
export const addedLines = (diff: string): Map<string, string[]> => {
  const added = new Map<string, string[]>();
  let file: string | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : undefined;
      continue;
    }
    if (file !== undefined && line.startsWith("+")) {
      added.set(file, [...(added.get(file) ?? []), line.slice(1)]);
    }
  }
  return added;
};

const git = (cwd: string, ...args: string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* spawner.string(
      ChildProcess.make("git", args, { cwd, stdin: "ignore" })
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
      for (const run of yield* list(path.join(outside, round, reference))) {
        const modules = path.join(
          outside,
          round,
          reference,
          run,
          "node_modules"
        );
        const finished =
          RUN_DIR_RE.test(run) &&
          (yield* exists(
            path.join(data.runs, round, reference, run, "run.json")
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
  const listed = yield* git(checkout, "worktree", "list", "--porcelain").pipe(
    Effect.orElseSucceed(() => "")
  );
  const checkouts: string[] = [];
  const kept: Kept[] = [];
  for (const entry of listed.split("\n\n")) {
    const at = firstGroup(WORKTREE_RE, entry);
    if (at === undefined || !at.startsWith(data.work + path.sep)) {
      continue;
    }
    const branch = firstGroup(BRANCH_RE, entry);
    if (branch !== undefined) {
      kept.push({ path: at, why: `on the branch ${branch}` });
      continue;
    }
    const status = yield* git(at, "status", "--porcelain").pipe(
      Effect.orElseSucceed(() => undefined)
    );
    if (status === undefined) {
      kept.push({ path: at, why: "git could not read it" });
      continue;
    }
    if (status.split("\n").some((line) => line.startsWith("??"))) {
      kept.push({ path: at, why: "it has files git does not track" });
      continue;
    }
    const added = addedLines(yield* git(at, "diff", "-U0", "HEAD"));
    const main = new Map<string, string | undefined>();
    for (const file of added.keys()) {
      main.set(
        file,
        yield* git(checkout, "show", `origin/main:${file}`).pipe(
          Effect.orElseSucceed(() => undefined)
        )
      );
    }
    const why = changesOnMain(added, main);
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

/** Removes what `findScratch` found. */
export const removeScratch = Effect.fn("removeScratch")(function* (
  found: Tidy
) {
  const { checkout } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  for (const install of found.installs) {
    yield* fs.remove(install, { force: true, recursive: true });
  }
  for (const at of found.checkouts) {
    // Forced: what it changed is on main, and its installed packages are ignored files.
    yield* git(checkout, "worktree", "remove", "--force", at);
  }
  for (const log of found.logs) {
    yield* fs.remove(log, { force: true });
  }
});

/** The lab's long jobs running now (`lab-*` units), which may be reading what `tidy` removes. */
export const runningLabJobs = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const units = yield* spawner.string(
    ChildProcess.make(
      "systemctl",
      [
        "--user",
        "list-units",
        "--state=active",
        "--plain",
        "--no-legend",
        "lab-*",
      ],
      { stdin: "ignore" }
    )
  );
  return units
    .split("\n")
    .map((line) => line.trim().split(SPACES_RE)[0] ?? "")
    .filter((unit) => unit !== "");
}).pipe(Effect.orElseSucceed((): string[] => []));
