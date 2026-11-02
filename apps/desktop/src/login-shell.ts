/**
 * The environment a terminal has (PLAN-desktop D6). An app opened from the Dock or a launcher
 * gets the session's bare `PATH`, without what the shell's startup files add: fnm, nvm, Volta,
 * Homebrew, `~/.local/bin`. The login shell is asked once, at start, as T3 Code does, and what
 * it says goes to the servers the app starts, and through them to the preview and the agents.
 */
import { Context, Effect, Layer, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** What is read from the login shell. `PATH` above all; the rest when the app has none of it. */
const LOGIN_SHELL_NAMES = [
  "PATH",
  "SSH_AUTH_SOCK",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "HOMEBREW_PREFIX",
  "NVM_DIR",
  "FNM_DIR",
  "VOLTA_HOME",
  "PNPM_HOME",
] as const;

const startMark = (name: string) => `__ULTRAPAINT_ENV_${name}_START__`;
const endMark = (name: string) => `__ULTRAPAINT_ENV_${name}_END__`;

/**
 * A command that prints each variable between two marks: whatever the startup files print
 * around it (a greeting, a warning) is left outside.
 */
export const captureCommand = (names: readonly string[]) =>
  names
    .map(
      (name) =>
        `printf '%s\\n' '${startMark(name)}'; printenv ${name} || true; printf '%s\\n' '${endMark(name)}'`
    )
    .join("; ");

/** The variables `captureCommand` printed; an empty one is left out. */
export const extractEnvironment = (
  output: string,
  names: readonly string[]
): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const name of names) {
    const start = output.indexOf(startMark(name));
    if (start === -1) {
      continue;
    }
    const from = start + startMark(name).length;
    const end = output.indexOf(endMark(name), from);
    if (end === -1) {
      continue;
    }
    const value = output.slice(from, end).trim();
    if (value.length > 0) {
      found[name] = value;
    }
  }
  return found;
};

/** Search paths joined in order, each directory once. */
export const mergePaths = (...paths: readonly (string | undefined)[]) => {
  const seen = new Set<string>();
  for (const entry of paths.flatMap((p) => (p ?? "").split(":"))) {
    const dir = entry.trim();
    if (dir.length > 0) {
      seen.add(dir);
    }
  }
  return [...seen].join(":");
};

/** The shells to ask, in order: the user's, then the platform's default. */
export const shellCandidates = (
  shell: string | undefined,
  platform: NodeJS.Platform
) => [
  ...new Set(
    [shell?.trim(), platform === "darwin" ? "/bin/zsh" : "/bin/bash"].filter(
      (s): s is string => !!s
    )
  ),
];

/**
 * The environment for the servers the app starts: the login shell's `PATH` ahead of the app's
 * own, and the login shell's other variables where the app has none.
 */
export const childEnvironment = (
  inherited: Readonly<Record<string, string | undefined>>,
  login: Readonly<Record<string, string>>
): Record<string, string> => {
  const extra: Record<string, string> = {};
  for (const [name, value] of Object.entries(login)) {
    if (name !== "PATH" && !inherited[name]) {
      extra[name] = value;
    }
  }
  return { ...extra, PATH: mergePaths(login.PATH, inherited.PATH) };
};

/** How long a shell may take with its startup files before the app goes on without it. */
const SHELL_TIMEOUT = "5 seconds";

export class LoginShell extends Context.Service<
  LoginShell,
  {
    /** What the servers the app starts get on top of its own environment. */
    readonly env: Readonly<Record<string, string>>;
  }
>()("ultrapaint/desktop/LoginShell") {
  /** Asks the login shell once, as the layer is built. */
  static readonly layer = Layer.effect(
    LoginShell,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const run = (command: string, args: readonly string[]) =>
        spawner
          .string(
            ChildProcess.make(command, args, {
              forceKillAfter: "1 second",
              stderr: "ignore",
              stdin: "ignore",
            })
          )
          .pipe(
            Effect.timeoutOption(SHELL_TIMEOUT),
            Effect.map(Option.getOrElse(() => "")),
            // A shell that cannot be run says nothing; the next one is asked.
            Effect.orElseSucceed(() => "")
          );

      let login: Record<string, string> = {};
      for (const shell of shellCandidates(
        process.env.SHELL,
        process.platform
      )) {
        login = extractEnvironment(
          yield* run(shell, ["-ilc", captureCommand(LOGIN_SHELL_NAMES)]),
          LOGIN_SHELL_NAMES
        );
        if (login.PATH) {
          break;
        }
      }
      // macOS keeps a PATH for apps the Dock starts, which the shell's failing leaves to ask.
      if (!login.PATH && process.platform === "darwin") {
        const path = (yield* run("/bin/launchctl", ["getenv", "PATH"])).trim();
        if (path) {
          login = { ...login, PATH: path };
        }
      }
      return LoginShell.of({ env: childEnvironment(process.env, login) });
    })
  );

  /** A fixed environment, for tests. */
  static readonly layerTest = (env: Readonly<Record<string, string>>) =>
    Layer.succeed(LoginShell, LoginShell.of({ env }));
}
