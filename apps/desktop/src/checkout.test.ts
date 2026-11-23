import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { AppUpdate } from "@ultrapaint/contracts/shell-bridge";
import { Effect, Exit, FileSystem, Layer } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { pullMain, readCheckout } from "./checkout.ts";
import { Updater } from "./updater.ts";

/** Starting a few `git`s on a loaded machine takes seconds (docs/TESTING.md, "Keep them fast"). */
const GIT_TIMEOUT = 30_000;

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_EMAIL: "maintainer@example.com",
  GIT_AUTHOR_NAME: "Maintainer",
  GIT_COMMITTER_EMAIL: "maintainer@example.com",
  GIT_COMMITTER_NAME: "Maintainer",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: GIT_ENV, stdio: "pipe" })
    .toString()
    .trim();

/** Commits a file with `subject` in `dir`, pushed to its origin's main when `push`. */
const commit = (dir: string, file: string, subject: string, push = true) => {
  writeFileSync(path.join(dir, file), `${subject}\n`);
  git(dir, "add", file);
  git(dir, "commit", "-q", "-m", subject);
  if (push) {
    git(dir, "push", "-q", "origin", "main");
  }
};

/**
 * A checkout of a repository on this machine (its `origin`, a bare repository), and another clone
 * of it that lands commits on `main`, as a merge on GitHub does.
 */
const repositories = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped();
  const origin = path.join(root, "origin.git");
  const checkout = path.join(root, "checkout");
  const other = path.join(root, "other");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, other);
  git(other, "checkout", "-q", "-b", "main");
  commit(other, "pnpm-lock.yaml", "chore: the first lockfile");
  git(root, "clone", "-q", origin, checkout);
  return { checkout, other, root };
});

const inRepositories = <A, E>(
  body: (repos: {
    readonly checkout: string;
    readonly other: string;
    readonly root: string;
  }) => Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>
) =>
  Effect.flatMap(repositories, body).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer)
  );

describe("readCheckout", () => {
  it.effect(
    "lists the commits main has that the checkout lacks, newest first",
    () =>
      inRepositories(({ checkout, other }) =>
        Effect.gen(function* () {
          commit(other, "a.ts", "feat: the first fix");
          commit(other, "b.ts", "fix: the second fix");
          const state = yield* readCheckout(checkout);
          assert.deepStrictEqual(
            state.behind.map((c) => c.subject),
            ["fix: the second fix", "feat: the first fix"]
          );
          assert.strictEqual(state.branch, "main");
          assert.strictEqual(
            state.commit,
            git(checkout, "rev-parse", "--short", "HEAD")
          );
          assert.strictEqual(
            state.behind[0]?.hash,
            git(other, "rev-parse", "--short", "HEAD")
          );
          assert.isFalse(state.dirty);
          assert.strictEqual(state.ahead, 0);
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "says a checkout is on another branch, with a commit of its own",
    () =>
      inRepositories(({ checkout }) =>
        Effect.gen(function* () {
          git(checkout, "checkout", "-q", "-b", "feat/x");
          commit(checkout, "mine.ts", "feat: mine", false);
          const state = yield* readCheckout(checkout);
          assert.deepStrictEqual([state.branch, state.ahead], ["feat/x", 1]);
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "says a checkout has changes not committed",
    () =>
      inRepositories(({ checkout }) =>
        Effect.gen(function* () {
          writeFileSync(path.join(checkout, "pnpm-lock.yaml"), "changed\n");
          assert.isTrue((yield* readCheckout(checkout)).dirty);
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "lists main's commits since the commit the app runs, though the checkout moved on since",
    () =>
      inRepositories(({ checkout, other }) =>
        Effect.gen(function* () {
          const running = git(checkout, "rev-parse", "--short", "HEAD");
          commit(other, "a.ts", "fix: pulled in a terminal");
          git(checkout, "pull", "-q", "--ff-only", "origin", "main");
          const state = yield* readCheckout(checkout, running);
          assert.deepStrictEqual(
            state.behind.map((c) => c.subject),
            ["fix: pulled in a terminal"]
          );
          assert.strictEqual(state.commit, running);
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "fails when main cannot be fetched",
    () =>
      inRepositories(({ checkout }) =>
        Effect.gen(function* () {
          git(checkout, "remote", "set-url", "origin", "/nowhere/at/all.git");
          const exit = yield* Effect.exit(readCheckout(checkout));
          assert.isTrue(Exit.isFailure(exit));
        })
      ),
    GIT_TIMEOUT
  );
});

describe("pullMain", () => {
  /** Stands in for `pnpm install`: writes a file, so a test sees whether it ran. */
  const install = (dir: string) =>
    ["sh", "-c", `touch '${path.join(dir, "installed")}'`] as const;

  it.effect(
    "brings the checkout to main, installing nothing when the lockfile is the same",
    () =>
      inRepositories(({ checkout, other, root }) =>
        Effect.gen(function* () {
          commit(other, "a.ts", "feat: no new dependency");
          yield* pullMain(checkout, { install: install(root) });
          assert.strictEqual(
            git(checkout, "rev-parse", "HEAD"),
            git(other, "rev-parse", "HEAD")
          );
          assert.isFalse(existsSync(path.join(root, "installed")));
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "installs when the lockfile changed",
    () =>
      inRepositories(({ checkout, other, root }) =>
        Effect.gen(function* () {
          commit(other, "pnpm-lock.yaml", "chore: a new dependency");
          yield* pullMain(checkout, { install: install(root) });
          assert.isTrue(existsSync(path.join(root, "installed")));
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "puts the checkout back where it was when the install fails, so the app runs as it did",
    () =>
      inRepositories(({ checkout, other }) =>
        Effect.gen(function* () {
          commit(other, "pnpm-lock.yaml", "chore: a new dependency");
          const before = git(checkout, "rev-parse", "HEAD");
          const exit = yield* Effect.exit(
            pullMain(checkout, {
              install: ["sh", "-c", "echo no network >&2; exit 1"],
            })
          );
          assert.isTrue(Exit.isFailure(exit));
          assert.strictEqual(git(checkout, "rev-parse", "HEAD"), before);
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "keeps a commit made while the install ran, rather than put the checkout back over it",
    () =>
      inRepositories(({ checkout, other }) =>
        Effect.gen(function* () {
          commit(other, "pnpm-lock.yaml", "chore: a new dependency");
          // The install fails after a commit lands in the checkout meanwhile.
          const exit = yield* Effect.exit(
            pullMain(checkout, {
              install: [
                "sh",
                "-c",
                `git -c user.name=M -c user.email=m@example.com commit -q --allow-empty -m "feat: mine meanwhile" && exit 1`,
              ],
            })
          );
          assert.isTrue(Exit.isFailure(exit));
          assert.strictEqual(
            git(checkout, "log", "-1", "--format=%s"),
            "feat: mine meanwhile"
          );
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "installs the dependencies of the commit it went back to, after a failed install",
    () =>
      inRepositories(({ checkout, other, root }) =>
        Effect.gen(function* () {
          commit(other, "pnpm-lock.yaml", "chore: a new dependency");
          const marker = path.join(root, "reinstalled");
          // Fails on the new lockfile, succeeds on the old one, as an install offline would.
          const exit = yield* Effect.exit(
            pullMain(checkout, {
              install: [
                "sh",
                "-c",
                `grep -q "a new dependency" pnpm-lock.yaml && exit 1; touch '${marker}'`,
              ],
            })
          );
          assert.isTrue(Exit.isFailure(exit));
          assert.isTrue(existsSync(marker));
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "refuses a checkout that left main since it was read, and leaves it as it is",
    () =>
      inRepositories(({ checkout, other, root }) =>
        Effect.gen(function* () {
          commit(other, "a.ts", "feat: theirs");
          git(checkout, "checkout", "-q", "-b", "feat/x");
          const before = git(checkout, "rev-parse", "HEAD");
          const exit = yield* Effect.exit(
            pullMain(checkout, { install: install(root) })
          );
          assert.isTrue(Exit.isFailure(exit));
          assert.strictEqual(git(checkout, "rev-parse", "HEAD"), before);
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "refuses a checkout with changes not committed",
    () =>
      inRepositories(({ checkout, other, root }) =>
        Effect.gen(function* () {
          commit(other, "a.ts", "feat: theirs");
          writeFileSync(path.join(checkout, "pnpm-lock.yaml"), "mine\n");
          const before = git(checkout, "rev-parse", "HEAD");
          const exit = yield* Effect.exit(
            pullMain(checkout, { install: install(root) })
          );
          assert.isTrue(Exit.isFailure(exit));
          assert.strictEqual(git(checkout, "rev-parse", "HEAD"), before);
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "fails and leaves the checkout as it was when main cannot be fast-forwarded to",
    () =>
      inRepositories(({ checkout, other, root }) =>
        Effect.gen(function* () {
          commit(other, "a.ts", "feat: theirs");
          commit(checkout, "b.ts", "feat: mine", false);
          const before = git(checkout, "rev-parse", "HEAD");
          const exit = yield* Effect.exit(
            pullMain(checkout, { install: install(root) })
          );
          assert.isTrue(Exit.isFailure(exit));
          assert.strictEqual(git(checkout, "rev-parse", "HEAD"), before);
        })
      ),
    GIT_TIMEOUT
  );
});

describe("Ultrapaint Dev's updater", () => {
  /** What the updater over `checkout` told the window after its first check. */
  const told = (checkout: string, failed?: string) =>
    Effect.gen(function* () {
      const published: (AppUpdate | null)[] = [];
      yield* Updater.use((u) => u.check).pipe(
        Effect.provide(
          Updater.layer({
            current: "0.4.0",
            fetch,
            mode: {
              _tag: "Checkout",
              dir: checkout,
              ...(failed === undefined ? {} : { failed }),
            },
            publish: (update) => published.push(update),
          }).pipe(Layer.provide(NodeServices.layer))
        )
      );
      return published.at(-1) ?? null;
    });

  it.effect(
    "offers to pull main's new commits, each with its subject, from the commit it runs",
    () =>
      inRepositories(({ checkout, other }) =>
        Effect.gen(function* () {
          commit(other, "a.ts", "fix: the tab strip keeps its tabs");
          const update = yield* told(checkout);
          assert.strictEqual(update?.install, "pull");
          assert.strictEqual(
            update?.current,
            git(checkout, "rev-parse", "--short", "HEAD")
          );
          assert.deepStrictEqual(
            update?.releases.map((r) => [r.version, r.notes]),
            [
              [
                git(other, "rev-parse", "--short", "HEAD"),
                "fix: the tab strip keeps its tabs",
              ],
            ]
          );
          assert.isUndefined(update?.reason);
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "says why it cannot pull a checkout with changes not committed, and offers nothing to click",
    () =>
      inRepositories(({ checkout, other }) =>
        Effect.gen(function* () {
          commit(other, "a.ts", "fix: one");
          writeFileSync(path.join(checkout, "pnpm-lock.yaml"), "mine\n");
          const update = yield* told(checkout);
          assert.strictEqual(update?.install, "manual");
          assert.include(update?.reason, "aren’t committed");
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "says why the last update failed while main is still ahead",
    () =>
      inRepositories(({ checkout, other }) =>
        Effect.gen(function* () {
          commit(other, "a.ts", "fix: one");
          const update = yield* told(checkout, "pnpm install: no network");
          assert.strictEqual(update?.install, "pull");
          assert.include(update?.reason, "pnpm install: no network");
        })
      ),
    GIT_TIMEOUT
  );

  it.effect(
    "tells nothing when the checkout is at main",
    () =>
      inRepositories(({ checkout }) =>
        Effect.gen(function* () {
          assert.isNull(yield* told(checkout, "an old failure"));
        })
      ),
    GIT_TIMEOUT
  );
});
