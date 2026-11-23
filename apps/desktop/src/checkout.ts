/**
 * The checkout Ultrapaint Dev runs (ADR 0113), as git says it: how far it is behind `main` on
 * its `origin`, and whether it can be brought there without touching the person's work. The app
 * reads it (`readCheckout`, for its update item); its runner pulls it (`pullMain`), between one
 * run of the app and the next.
 */
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { UpdateCheckError } from "./errors.ts";

/** A commit on `main`: its short hash, when it was made (ISO 8601) and its subject. */
export interface MainCommit {
  readonly date: string;
  readonly hash: string;
  readonly subject: string;
}

export interface CheckoutState {
  /** Commits of its own that `main` does not have. */
  readonly ahead: number;
  /** The commits `main` has that it lacks, newest first. */
  readonly behind: readonly MainCommit[];
  /** Its branch; `HEAD` when it is on none. */
  readonly branch: string;
  /** The commit it is at, short. */
  readonly commit: string;
  /** Whether a file git follows has changes not committed. */
  readonly dirty: boolean;
}

/** The last lines a command wrote, which say why it failed. */
const tail = (text: string) => text.trim().split("\n").slice(-3).join("\n");

/** Runs a command in `dir` to its end: what it wrote, and its exit code. */
const run = Effect.fnUntraced(function* (
  dir: string,
  command: string,
  args: readonly string[]
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(
    ChildProcess.make(command, [...args], {
      cwd: dir,
      // Never a prompt for a password nobody would see.
      env: { GIT_TERMINAL_PROMPT: "0" },
      extendEnv: true,
      stdin: "ignore",
    })
  );
  const [out, err, code] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
      handle.exitCode,
    ],
    { concurrency: "unbounded" }
  );
  return { code: Number(code), err, out };
}, Effect.scoped);

/** A command's output, or a failure saying what it said when it did not succeed. */
const output = Effect.fnUntraced(function* (
  dir: string,
  command: string,
  args: readonly string[]
) {
  const done = yield* run(dir, command, args).pipe(
    Effect.mapError(
      (error) =>
        new UpdateCheckError({ message: `${command}: ${error.message}` })
    )
  );
  if (done.code !== 0) {
    return yield* new UpdateCheckError({
      message: `${command} ${args[0] ?? ""}: ${tail(done.err || done.out) || `exited with ${done.code}`}`,
    });
  }
  return done.out.trim();
});

const git = (dir: string, ...args: string[]) => output(dir, "git", args);

const FIELD = "\u001f";

/** Fetches `main` from the checkout's origin, then reads where the checkout stands against it. */
export const readCheckout = Effect.fn("Checkout.readCheckout")(function* (
  dir: string
) {
  yield* git(dir, "fetch", "--quiet", "origin", "main");
  const [branch, commit, status, ahead, log] = yield* Effect.all([
    git(dir, "rev-parse", "--abbrev-ref", "HEAD"),
    git(dir, "rev-parse", "--short", "HEAD"),
    git(dir, "status", "--porcelain", "--untracked-files=no"),
    git(dir, "rev-list", "--count", "FETCH_HEAD..HEAD"),
    git(dir, "log", `--format=%h${FIELD}%cI${FIELD}%s`, "HEAD..FETCH_HEAD"),
  ]);
  const behind = log
    .split("\n")
    .filter((line) => line !== "")
    .map((line): MainCommit => {
      const [hash = "", date = "", subject = ""] = line.split(FIELD);
      return { date, hash, subject };
    });
  return {
    ahead: Number(ahead),
    behind,
    branch,
    commit,
    dirty: status !== "",
  } satisfies CheckoutState;
});

/**
 * Brings the checkout to `main` by a fast-forward, which fails rather than merge or touch the
 * person's work, then runs `install` (`pnpm install`) when the lockfile changed. A checkout off
 * `main` or with changes not committed is refused as it is, whatever it was when last read; one
 * whose install fails is put back where it was, so that the app runs as it did.
 */
export const pullMain = Effect.fn("Checkout.pullMain")(function* (
  dir: string,
  options: { readonly install: readonly [string, ...string[]] }
) {
  const [branch, status, before] = yield* Effect.all([
    git(dir, "rev-parse", "--abbrev-ref", "HEAD"),
    git(dir, "status", "--porcelain", "--untracked-files=no"),
    git(dir, "rev-parse", "HEAD"),
  ]);
  if (branch !== "main") {
    return yield* new UpdateCheckError({
      message: `the checkout is on ${branch}, not main`,
    });
  }
  if (status !== "") {
    return yield* new UpdateCheckError({
      message: "the checkout has changes that aren’t committed",
    });
  }
  yield* git(dir, "pull", "--quiet", "--ff-only", "origin", "main");
  const lockfile = yield* git(
    dir,
    "diff",
    "--name-only",
    before,
    "HEAD",
    "--",
    "pnpm-lock.yaml"
  );
  if (lockfile !== "") {
    const [command, ...args] = options.install;
    yield* output(dir, command, args).pipe(
      Effect.tapError(() => git(dir, "reset", "--quiet", "--keep", before))
    );
  }
});
