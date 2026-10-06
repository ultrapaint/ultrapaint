/**
 * The sandbox an agent process runs in. ACP has no way to tell an agent to stay inside a
 * directory, and every agent brings its own tools, so the confinement is made by the operating
 * system around the process: whatever the agent starts — its shell, its file tools, an `npx`
 * grandchild — inherits it, whichever agent it is.
 *
 * Pure: it turns a description of what the agent may touch into the command that starts it.
 * Finding out what this machine needs (the toolchain, git's configuration) belongs to the
 * server's `AgentSandbox` service.
 */

/** What starts an agent: the same shape before and after the sandbox wraps it. */
export interface AgentLaunch {
  readonly args: readonly string[];
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface SandboxPolicy {
  /** The agent's own directories: its login, its sessions, its state. Read and written. */
  readonly agentDirs: readonly string[];
  /**
   * Directories blanked like the home directory, and let back only where `reads` names something
   * inside them: the user's runtime directory, where the session bus, the user's systemd and the
   * keyring listen. A socket on a read-only mount still answers, and any of those would run a
   * command outside the sandbox for the asking. Bubblewrap only; macOS has no such directory.
   */
  readonly hidden: readonly string[];
  /** The user's home directory, everything of which is out of reach unless allowed. */
  readonly home: string;
  /**
   * Inside what is writable, what stays read-only: the repository's `.git`. The editor runs git
   * there outside the sandbox, on every turn, and a hook or a `core.fsmonitor` written into it
   * would run with it. Reading it is fine; `git status` and `git diff` still work.
   */
  readonly readOnly: readonly string[];
  /** The toolchain and configuration the agent's shell reads: read only. */
  readonly reads: readonly string[];
  /** The repository: the user's work, and the point of the exercise. Read and written. */
  readonly root: string;
  /**
   * Where the agent and its tools scribble: the package managers' caches and the system's
   * temporary directories. Read and written — an agent started through `npx` unpacks itself
   * into a cache, and shell commands expect a writable `/tmp`. No work of the user's lives here.
   */
  readonly scratch: readonly string[];
  /**
   * A temporary directory of this session's own; also the agent's `TMPDIR`. On Linux it is the
   * sandbox's `/tmp` too, so nothing another program left in the machine's `/tmp` (an X server's
   * socket, another session's files) is in reach.
   */
  readonly tmpDir: string;
}

/** A name `env` and bubblewrap's `--setenv` both take as it is. */
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The variables that tell the dynamic loader what to load into a process before its own code
 * runs. Inside the sandbox they would only reach what is already confined, but they are never
 * what an agent needs for a command, and a variable set on the wrong side of the sandbox is a
 * way out of it.
 */
const LOADER_ENV_RE = /^(LD_|DYLD_)/;

/** What of the environment an agent asked for a command may be set: no loader variables. */
export const agentEnv = (
  env: Readonly<Record<string, string>>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(([name]) => !LOADER_ENV_RE.test(name))
  );

/** The launch's variables, each a name that can be passed on the command line. */
const settable = (env: Readonly<Record<string, string>>) =>
  Object.entries(env).filter(([name]) => ENV_NAME_RE.test(name));

const subpaths = (paths: readonly string[]) =>
  paths.map((p) => `(subpath ${JSON.stringify(p)})`).join(" ");

/**
 * Drops every path an earlier one already contains. A rule nested inside another of the same kind
 * grants nothing extra, and on Linux it is worse than useless: a `PATH` entry like fnm's
 * `~/.local/state/fnm_multishells/<pid>` is a symlink, and bubblewrap cannot mount over a symlink
 * that sits inside a mount it has already made — it fails, and with it the whole launch. Its
 * parent (`~/.local`, from `~/.local/bin`) already covers it.
 *
 * Sorting puts a directory immediately before what it contains, and the trailing slash keeps
 * `/a` from swallowing `/a-b`.
 */
export const outermost = (paths: readonly string[]): string[] => {
  const kept: string[] = [];
  for (const path of [...new Set(paths)].sort()) {
    if (!kept.some((seen) => path === seen || path.startsWith(`${seen}/`))) {
      kept.push(path);
    }
  }
  return kept;
};

/**
 * A Seatbelt profile: reads are open except under the home directory, writes are closed except
 * the repository, the agent's own directories, the caches and the temporary directories.
 * Network is not restricted — an agent talks to its model.
 */
export const seatbeltProfile = (policy: SandboxPolicy): string => {
  const writable = outermost([
    policy.root,
    policy.tmpDir,
    ...policy.agentDirs,
    ...policy.scratch,
  ]);
  const reads = outermost([...writable, ...policy.reads]);
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-read-data (subpath ${JSON.stringify(policy.home)}))`,
    `(allow file-read-data ${subpaths(reads)})`,
    '(deny file-write* (subpath "/"))',
    `(allow file-write* ${subpaths(writable)} (subpath "/dev"))`,
    // Last, because the last rule that matches is the one Seatbelt applies.
    ...(policy.readOnly.length > 0
      ? [`(deny file-write* ${subpaths(outermost(policy.readOnly))})`]
      : []),
  ].join("\n");
};

/**
 * The same policy for bubblewrap: the filesystem read-only, the home directory blanked with an
 * empty tmpfs, and then only what the policy allows bound back over it — read-only for the
 * toolchain, read-write for the repository and the rest. The session's own temporary directory
 * is its `/tmp`. Network is left alone; processes, System V IPC and the terminal are the
 * sandbox's own.
 *
 * Order is the whole trick: every bind after the first covers what came before it.
 */
export const bubblewrapArgs = (policy: SandboxPolicy): string[] => {
  const writable = outermost([
    policy.root,
    ...policy.agentDirs,
    ...policy.scratch,
  ]);
  // A read-only bind under a writable one says nothing new; the writable bind comes later and
  // covers it either way.
  const reads = outermost([...writable, ...policy.reads]).filter(
    (path) => !writable.includes(path)
  );
  return [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    // Its own process tree: nothing outside it can be signalled or traced, nor its `/proc` read.
    "--unshare-pid",
    "--unshare-ipc",
    "--proc",
    "/proc",
    // Nothing of the home directory is there unless it is named below.
    "--tmpfs",
    policy.home,
    ...policy.hidden.flatMap((path) => ["--tmpfs", path]),
    // Before the binds below: a repository or a state directory under `/tmp` comes back over it.
    "--bind",
    policy.tmpDir,
    "/tmp",
    ...reads.flatMap((path) => ["--ro-bind-try", path, path]),
    ...writable.flatMap((path) => ["--bind-try", path, path]),
    // Over the writable binds, so that what is under them and must not change cannot.
    ...outermost(policy.readOnly).flatMap((path) => [
      "--ro-bind-try",
      path,
      path,
    ]),
    /*
     * The blank home is writable until this, and an agent writing `~/.npmrc` would be told it
     * worked while the file went nowhere. Read-only says the truth, and matches Seatbelt. It
     * comes last because the binds above have to make their mount points in it first, and it
     * touches only the tmpfs itself — what is mounted over it stays writable.
     */
    "--remount-ro",
    policy.home,
    // The address of the bus is no use without its socket, and says where to look for one.
    "--unsetenv",
    "DBUS_SESSION_BUS_ADDRESS",
    // No controlling terminal: a command cannot push keystrokes into the one the server runs in.
    "--new-session",
    // The agent goes when the server does, whatever happens to it.
    "--die-with-parent",
  ];
};

/** Where the sandbox of each platform comes from. */
export interface SandboxTools {
  /** `bwrap` on the PATH, when there is one. Linux only. */
  readonly bubblewrap?: string | undefined;
  readonly platform: string;
}

/** Whether these tools can confine an agent process. */
export const sandboxAvailable = (tools: SandboxTools): boolean =>
  tools.platform === "darwin" ||
  (tools.platform === "linux" && tools.bubblewrap !== undefined);

/**
 * Wraps the command that starts an agent so that it runs inside the sandbox. Where there is
 * none the launch is returned unchanged; the caller tells the user.
 *
 * The launch's variables are set inside the sandbox, by the sandbox, never on the process that
 * makes it: `bwrap` and `sandbox-exec` run unconfined until they have confined what they start,
 * and `LD_PRELOAD` on either would run its library there.
 */
export const sandboxLaunch = (
  launch: AgentLaunch,
  policy: SandboxPolicy,
  tools: SandboxTools = { platform: process.platform }
): AgentLaunch => {
  if (tools.platform === "darwin") {
    // Temporary files are written where the agent may write, and nowhere else.
    const env = settable({ ...launch.env, TMPDIR: policy.tmpDir });
    return {
      args: [
        "-p",
        seatbeltProfile(policy),
        "/usr/bin/env",
        ...env.map(([name, value]) => `${name}=${value}`),
        launch.command,
        ...launch.args,
      ],
      command: "/usr/bin/sandbox-exec",
      env: {},
    };
  }
  if (tools.platform === "linux" && tools.bubblewrap) {
    // The session's temporary directory is `/tmp` in there.
    const env = settable({ ...launch.env, TMPDIR: "/tmp" });
    return {
      args: [
        ...bubblewrapArgs(policy),
        ...env.flatMap(([name, value]) => ["--setenv", name, value]),
        "--",
        launch.command,
        ...launch.args,
      ],
      command: tools.bubblewrap,
      env: {},
    };
  }
  return launch;
};
