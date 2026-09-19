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
  /** The user's home directory, everything of which is out of reach unless allowed. */
  readonly home: string;
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
  /** A temporary directory of this session's own; also the agent's `TMPDIR`. */
  readonly tmpDir: string;
}

const subpaths = (paths: readonly string[]) =>
  paths.map((p) => `(subpath ${JSON.stringify(p)})`).join(" ");

/**
 * A Seatbelt profile: reads are open except under the home directory, writes are closed except
 * the repository, the agent's own directories, the caches and the temporary directories.
 * Network is not restricted — an agent talks to its model.
 */
export const seatbeltProfile = (policy: SandboxPolicy): string => {
  const writable = [
    policy.root,
    policy.tmpDir,
    ...policy.agentDirs,
    ...policy.scratch,
  ];
  const reads = [...writable, ...policy.reads];
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-read-data (subpath ${JSON.stringify(policy.home)}))`,
    `(allow file-read-data ${subpaths(reads)})`,
    '(deny file-write* (subpath "/"))',
    `(allow file-write* ${subpaths(writable)} (subpath "/dev"))`,
  ].join("\n");
};

/** Whether this platform can confine an agent process. macOS today; Linux is next. */
export const sandboxAvailable = (platform: string): boolean =>
  platform === "darwin";

/**
 * Wraps the command that starts an agent so that it runs inside the sandbox. On a platform
 * without one the launch is returned unchanged; the caller tells the user.
 */
export const sandboxLaunch = (
  launch: AgentLaunch,
  policy: SandboxPolicy,
  platform: string = process.platform
): AgentLaunch => {
  if (!sandboxAvailable(platform)) {
    return launch;
  }
  return {
    args: ["-p", seatbeltProfile(policy), launch.command, ...launch.args],
    command: "/usr/bin/sandbox-exec",
    // Temporary files are written where the agent may write, and nowhere else.
    env: { ...launch.env, TMPDIR: policy.tmpDir },
  };
};
