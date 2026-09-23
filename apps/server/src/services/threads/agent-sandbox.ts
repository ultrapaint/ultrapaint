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

import { tmpdir } from "node:os";
import {
  type AgentLaunch,
  sandboxAvailable,
  sandboxLaunch,
} from "@ultrapaint/acp/sandbox";
import type { AgentConfig } from "@ultrapaint/contracts/threads";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
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
 * caches (the built-in agents are started with `npx`, which unpacks them into one) and the
 * system's temporary directories, which shell commands and the agents' own bookkeeping expect
 * to be writable. Nothing of the user's work lives in either.
 */
const COMMON_SCRATCH = [
  "/tmp",
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
    /** Whether this platform can confine an agent. Elsewhere the agent runs unconfined. */
    readonly available: boolean;
    /**
     * The sandbox for one session: `config` confined to `root`, with `tmpDir` as the only
     * temporary directory it may write to. Where there is no sandbox, nothing is wrapped.
     */
    readonly session: (options: {
      readonly config: AgentConfig;
      readonly root: string;
      readonly tmpDir: string;
    }) => Effect.Effect<AgentSandboxSession>;
  }
>()("ultrapaint/server/AgentSandbox") {
  /** For a machine described directly, as a script at the edge does. */
  static readonly layerFor = ({ home, path: searchPath }: Machine) =>
    Layer.effect(
      AgentSandbox,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const uid = String(process.getuid?.() ?? "");
        // Linux confines with bubblewrap, which is not always installed.
        const bubblewrap =
          process.platform === "linux"
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
        const tools = { bubblewrap, platform: process.platform };
        // A home directory that is not a real path cannot be closed: `--tmpfs ""` is no sandbox.
        const available = path.isAbsolute(home) && sandboxAvailable(tools);

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
          .filter((dir) => dir.startsWith(`${home}/`))
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

        const scratch = yield* resolveAll([...COMMON_SCRATCH, tmpdir()]);
        const reads = yield* resolveAll([
          ...(yield* gitConfigFiles),
          ...pathToolchain,
          ...COMMON_TOOLCHAIN,
        ]);

        return AgentSandbox.of({
          available,
          session: Effect.fnUntraced(function* ({ config, root, tmpDir }) {
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
            const policy = {
              agentDirs: yield* resolveAll([
                ...stateDirs.map((dir) => dir.replace(TRAILING_SLASH_RE, "")),
                ...rootAliases,
              ]),
              home,
              reads,
              root,
              scratch,
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

  /** For the machine the server resolved at startup. */
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const { machine } = yield* ServerConfig;
      return AgentSandbox.layerFor(machine);
    })
  );
}
