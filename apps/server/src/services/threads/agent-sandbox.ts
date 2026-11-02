/**
 * Confines an agent process to the repository. The rules are the same for every ACP agent; what
 * differs is where the agent keeps its own login and sessions, which its launch configuration
 * declares as data.
 *
 * This service knows the machine: the home directory, the toolchain the agent's shell needs, the
 * files git reads its configuration from, and which sandbox this platform has. Those are read
 * once — they do not change while the server runs — and turned into a launch through
 * `packages/acp`'s pure profile builder.
 */

import {
  type AgentLaunch,
  type SandboxTools,
  sandboxAvailable,
  sandboxLaunch,
} from "@ultrapaint/acp/sandbox";
import type { AgentConfig } from "@ultrapaint/contracts/threads";
import { Context, Effect, FileSystem, Layer, Path, type Scope } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { ServerConfig } from "../../config.ts";
import { runCommand } from "../../process.ts";

/** Interpreters and version managers a shell reaches for. Read only. */
const COMMON_TOOLCHAIN = [
  "~/.nvm",
  "~/.volta",
  "~/.fnm",
  "~/.asdf",
  "~/.cargo",
  "~/.rustup",
  "~/.config/git",
] as const;

/**
 * What the agent and its tools may scribble in outside the repository: the package managers'
 * caches. The built-in agents are started with `npx`, which unpacks them into one, and a
 * package install inside the sandbox fills them; read-only, neither would work. Nothing of the
 * user's work lives there.
 */
const COMMON_SCRATCH = [
  // The agent signs in as you: on macOS that login is in the Keychain, which is written on use.
  "~/Library/Keychains",
  "~/.npm",
  "~/.cache",
  "~/.bun",
  "~/.pnpm-store",
  "~/Library/pnpm",
  "~/Library/Caches",
] as const;

const GIT_ORIGIN_RE = /^file:(\S+)/;
const TRAILING_SLASH_RE = /\/+$/;

/** What confining an agent needs to know about the machine. */
export interface Machine {
  /** The home directory: closed, except for what is allowed back. */
  readonly home: string;
  /** The `PATH`, whose entries under the home directory are the toolchain. */
  readonly path: string;
  /**
   * The system's temporary directory. Seatbelt cannot give a session a `/tmp` of its own, so on
   * macOS the agent shares it, and `/tmp`, with everything else; shell commands expect both to
   * be writable.
   */
  readonly tmpdir: string;
  /** The user's id, which names their runtime directory; none where there are no user ids. */
  readonly uid: number | undefined;
}

/** One agent session's sandbox: how to start it, and how to run anything else inside it. */
export interface AgentSandboxSession {
  /** Puts a command the agent asked us to run in the same sandbox as the agent itself. */
  readonly confine: (launch: AgentLaunch) => AgentLaunch;
  /** The command that starts the agent. */
  readonly launch: AgentLaunch;
}

export class AgentSandbox extends Context.Service<
  AgentSandbox,
  {
    /** Whether this machine can confine an agent. Elsewhere the agent runs unconfined. */
    readonly available: boolean;
    /**
     * Why it cannot, when there is a sandbox that should have worked and did not: bubblewrap
     * installed but refused, say, by a kernel that restricts user namespaces.
     */
    readonly problem: string | undefined;
    /**
     * The sandbox for one session: `config` confined to `root`, with `tmpDir` as the only
     * temporary directory it may write to. Where there is no sandbox, nothing is wrapped. What
     * the sandbox leaves in the repository (the mount point that seals a missing `.git`) goes
     * when the scope closes.
     */
    readonly session: (options: {
      readonly config: AgentConfig;
      readonly root: string;
      readonly tmpDir: string;
      /**
       * The only part of the repository the agent may write, when not all of it: a design
       * thread's designs directory (ADR 0030).
       */
      readonly writable?: string | undefined;
    }) => Effect.Effect<AgentSandboxSession, never, Scope.Scope>;
  }
>()("ultrapaint/server/AgentSandbox") {
  /**
   * For a machine described directly, as a script at the edge does. `tools` says which sandbox
   * to use; left out, it is whatever this platform has.
   */
  static readonly layerFor = (
    { home, path: searchPath, tmpdir, uid: userId }: Machine,
    options?: {
      /**
       * Further paths the agent reads and runs from: the desktop app's Electron, adapters and
       * downloaded agents, which may well be under the home directory.
       */
      readonly reads?: readonly string[];
      readonly tools?: SandboxTools;
    }
  ) =>
    Layer.effect(
      AgentSandbox,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const uid = String(userId ?? "");
        // Linux confines with bubblewrap, which is not always installed.
        const bubblewrap =
          options?.tools === undefined && process.platform === "linux"
            ? yield* runCommand("sh", ["-c", "command -v bwrap"], {
                cwd: home,
                timeout: "5 seconds",
              }).pipe(
                Effect.map((result) =>
                  result.exitCode === 0 ? result.stdout.trim() : undefined
                ),
                Effect.provideService(
                  ChildProcessSpawner.ChildProcessSpawner,
                  spawner
                ),
                Effect.orElseSucceed(() => undefined)
              )
            : undefined;
        const tools = options?.tools ?? {
          bubblewrap,
          platform: process.platform,
        };
        // A home directory that is not a real path cannot be closed: `--tmpfs ""` is no sandbox.
        const possible = path.isAbsolute(home) && sandboxAvailable(tools);

        /*
         * The user's runtime directory holds the session bus, the user's systemd and the
         * keyring, each a socket that runs commands outside the sandbox for whoever asks.
         */
        const hidden =
          tools.platform === "linux" && userId !== undefined
            ? [`/run/user/${userId}`]
            : [];

        const expand = (p: string) =>
          (p === "~" || p.startsWith("~/") ? path.join(home, p.slice(1)) : p)
            .replaceAll("<uid>", uid)
            .replaceAll("<home>", home);

        /**
         * A path under both names it can be reached by: `/tmp` is a symlink to `/private/tmp` on
         * macOS, and a rule written for one does not match the other.
         */
        const bothNames = Effect.fnUntraced(function* (p: string) {
          const expanded = expand(p);
          const real = yield* Effect.orElseSucceed(
            fs.realPath(expanded),
            () => expanded
          );
          return real === expanded ? [expanded] : [expanded, real];
        });

        const resolveAll = (paths: readonly string[]) =>
          Effect.map(Effect.forEach(paths, bothNames), (all) => [
            ...new Set(all.flat()),
          ]);

        /**
         * The interpreters and package managers the user's PATH points into their home.
         * `~/.local/bin/node` is a link into `~/.local/lib`, so the installation is allowed rather
         * than the `bin` alone — but never the home directory itself, which `~/bin` would mean and
         * which would open everything the sandbox is there to keep closed.
         */
        const pathToolchain = searchPath
          .split(process.platform === "win32" ? ";" : ":")
          // fnm keeps each shell's node under the runtime directory, which is hidden too.
          .filter((dir) =>
            [home, ...hidden].some((closed) => dir.startsWith(`${closed}/`))
          )
          .map((dir) => {
            const parent = path.dirname(dir);
            return path.basename(dir) === "bin" && parent !== home
              ? parent
              : dir;
          })
          .filter((dir) => dir !== home);

        /** Every file git reads, the ones an `include` pulls in as well. */
        const gitConfigFiles = runCommand(
          "git",
          ["config", "--global", "--list", "--show-origin", "--includes"],
          { cwd: home, timeout: "5 seconds" }
        ).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          ),
          Effect.map((result) =>
            result.stdout.split("\n").flatMap((line) => {
              const match: RegExpExecArray | null = GIT_ORIGIN_RE.exec(line);
              return match?.[1] ? [match[1]] : [];
            })
          ),
          // No git, or no configuration: the agent's shell manages without it.
          Effect.orElseSucceed((): string[] => [])
        );

        // On Linux the session's own directory is its `/tmp`, and the machine's is out of reach.
        const scratch = yield* resolveAll([
          ...COMMON_SCRATCH,
          ...(tools.platform === "darwin" ? ["/tmp", tmpdir] : []),
        ]);
        const reads = yield* resolveAll([
          ...(yield* gitConfigFiles),
          ...pathToolchain,
          ...COMMON_TOOLCHAIN,
          ...(options?.reads ?? []),
        ]);

        /*
         * A sandbox that is installed can still refuse to start: a kernel that restricts user
         * namespaces, or a path in the policy bubblewrap cannot mount (it once could not, for
         * fnm's). Tried once, with this machine's policy around `true`, so that a refusal is one
         * clear reason at startup instead of every agent failing to start.
         */
        const problem = possible
          ? yield* Effect.scoped(
              Effect.gen(function* () {
                const dir = yield* fs.realPath(
                  yield* fs.makeTempDirectoryScoped({
                    prefix: "ultrapaint-sandbox-check-",
                  })
                );
                const launch = sandboxLaunch(
                  { args: ["-c", "true"], command: "/bin/sh", env: {} },
                  {
                    agentDirs: [],
                    hidden,
                    home,
                    readOnly: [],
                    reads,
                    root: dir,
                    scratch,
                    tmpDir: dir,
                  },
                  tools
                );
                const result = yield* runCommand(
                  launch.command,
                  [...launch.args],
                  {
                    cwd: dir,
                    timeout: "10 seconds",
                  }
                ).pipe(
                  Effect.provideService(
                    ChildProcessSpawner.ChildProcessSpawner,
                    spawner
                  )
                );
                return result.exitCode === 0
                  ? undefined
                  : `${launch.command} refused to start: ${
                      result.stderr.trim().split("\n").at(-1) ||
                      `exit code ${result.exitCode}`
                    }`;
              })
            ).pipe(
              Effect.catch((error) =>
                Effect.succeed(
                  `the sandbox could not be tried: ${error.message}`
                )
              )
            )
          : undefined;
        if (problem) {
          yield* Effect.logWarning(`agents will not be confined: ${problem}`);
        }
        const available = possible && problem === undefined;

        return AgentSandbox.of({
          available,
          problem,
          session: Effect.fnUntraced(function* ({
            config,
            root,
            tmpDir,
            writable,
          }) {
            const base: AgentLaunch = {
              args: config.args,
              command: config.command,
              env: config.env,
            };
            if (!available) {
              return { confine: (launch: AgentLaunch) => launch, launch: base };
            }
            // A directory the agent keeps its state in has to exist before the sandbox can let
            // it in; a file (a login) is the agent's own to make, outside.
            const stateDirs = config.stateDirs ?? [];
            yield* Effect.forEach(
              stateDirs.filter((dir) => dir.endsWith("/")),
              (dir) =>
                Effect.ignore(
                  fs.makeDirectory(expand(dir), { recursive: true })
                )
            );
            /*
             * Seatbelt checks the path the kernel resolved, so a repository opened through a
             * symlink (`/tmp/app` is `/private/tmp/app`) needs its real name allowed as well.
             */
            const [, ...rootAliases] = yield* bothNames(root);
            // A design thread writes its designs only: the repository is read-only around them.
            const confined =
              writable !== undefined &&
              path.resolve(writable) !== path.resolve(root)
                ? yield* bothNames(writable)
                : null;
            /*
             * A repository without `.git` must not get one from the agent: the editor runs git
             * there outside the sandbox, and a `core.fsmonitor` in it would run too. Seatbelt
             * denies making it; bubblewrap seals it with an empty read-only directory, whose
             * mount point is made in the repository and taken away after. An empty `.git` is no
             * repository to git, which looks further up as it would without it. A design
             * thread's repository is read-only around its designs, `.git` and all.
             */
            const sealed =
              confined || tools.platform !== "linux"
                ? []
                : yield* Effect.filter(
                    [root, ...rootAliases].map((name) =>
                      path.join(name, ".git")
                    ),
                    (git) =>
                      Effect.map(
                        Effect.orElseSucceed(fs.exists(git), () => true),
                        (there) => !there
                      )
                  );
            yield* Effect.addFinalizer(() =>
              Effect.forEach(
                sealed,
                (git) =>
                  // Only while it is the empty directory the sandbox made: a repository made
                  // since, by the user, is theirs.
                  fs.readDirectory(git).pipe(
                    Effect.flatMap((entries) =>
                      entries.length === 0
                        ? fs.remove(git, { recursive: true })
                        : Effect.void
                    ),
                    Effect.ignore
                  ),
                { discard: true }
              )
            );
            const policy = {
              agentDirs: yield* resolveAll([
                ...stateDirs.map((dir) => dir.replace(TRAILING_SLASH_RE, "")),
                ...rootAliases,
              ]),
              hidden,
              home,
              // Under every name the repository goes by, like the repository itself.
              readOnly: confined
                ? [root, ...rootAliases]
                : [root, ...rootAliases].map((name) => path.join(name, ".git")),
              reads,
              ...(confined && { rewritable: confined }),
              root,
              scratch,
              sealed,
              tmpDir,
            };
            const confine = (launch: AgentLaunch) =>
              sandboxLaunch(launch, policy, tools);
            return {
              confine,
              launch: confine({
                ...base,
                env: { ...base.env, ...config.sandboxEnv },
              }),
            };
          }),
        });
      })
    );

  /** A machine without a sandbox, for a test: every agent runs as its configuration says. */
  static readonly layerTest = Layer.succeed(
    AgentSandbox,
    AgentSandbox.of({
      available: false,
      problem: undefined,
      session: ({ config }) =>
        Effect.succeed({
          confine: (launch: AgentLaunch) => launch,
          launch: {
            args: config.args,
            command: config.command,
            env: config.env,
          },
        }),
    })
  );

  /**
   * A machine that says it confines its agents, for a test of what a confined agent is told:
   * nothing is wrapped, and no process is started to be confined.
   */
  static readonly layerTestConfined = Layer.succeed(
    AgentSandbox,
    AgentSandbox.of({
      available: true,
      problem: undefined,
      session: ({ config }) =>
        Effect.succeed({
          confine: (launch: AgentLaunch) => launch,
          launch: {
            args: config.args,
            command: config.command,
            env: { ...config.env, ...config.sandboxEnv },
          },
        }),
    })
  );

  /** For the machine the server resolved at startup. */
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const { agentRuntime, machine } = yield* ServerConfig;
      return AgentSandbox.layerFor(machine, {
        reads: agentRuntime?.reads ?? [],
      });
    })
  );
}
