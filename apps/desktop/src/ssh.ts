/**
 * What the app asks of the system's `ssh` for a project on another machine (PLAN-desktop D12),
 * as arguments and a remote command, and what its failures mean for the user. Nothing here runs
 * anything: `ssh-server.ts` does, and the tests read these as they are.
 *
 * One connection per open project, a master (`ControlMaster`) on a socket in a private temporary
 * directory. Its own session runs `cat`, which ends when the app's end of its stdin closes, so
 * the connection goes with the app however the app goes. The server runs in a second session on
 * the same connection, and the ports are forwarded on it with `-O forward`, as they are needed.
 * The user's configuration, keys and agent apply, as they do to any `ssh` they run; what the app
 * relies on is set on the command line, which takes precedence over the configuration.
 */
import { Schema } from "effect";

/** Where a project's server runs: a host as `ssh` takes it, and its configuration. */
export interface SshTarget {
  /** A configuration file in place of `~/.ssh/config` (`-F`), for tests. */
  readonly configFile?: string | undefined;
  /** An alias of the configuration, a host name, or `user@host`. */
  readonly host: string;
  readonly port?: number | undefined;
}

/** Why `ssh` failed, in words for the user, and whether trying again later may help. */
export class SshError extends Schema.TaggedError<SshError>()("SshError", {
  message: Schema.String,
  /** The machine was not reached, or the connection dropped: it may be there in a while. */
  retryable: Schema.Boolean,
}) {}

/** A string as one word for a POSIX shell. */
export const shellQuote = (value: string) =>
  `'${value.replaceAll("'", `'\\''`)}'`;

/** A remote path as a shell word: `~` and `~/…` under the remote home, the rest as it is. */
export const remotePathWord = (path: string) => {
  if (path === "~") {
    return '"$HOME"';
  }
  return path.startsWith("~/")
    ? `"$HOME"/${shellQuote(path.slice(2))}`
    : shellQuote(path);
};

/** The exit code of the server's command when the project's folder is not there. */
export const NO_FOLDER_EXIT = 66;

/** Where an unsaved session on the remote machine is kept, as the app keeps a local one. */
export const remoteSessionDir = (projectId: string) =>
  `~/.ultrapaint/desktop-sessions/${projectId}`;

/**
 * The server's command as a POSIX script: into the folder, or a message and `NO_FOLDER_EXIT`;
 * then the command, the flags the app relies on after it. `command` is the user's, shell syntax.
 */
export const serverScript = (options: {
  readonly command: string;
  readonly path: string;
  readonly sessionDir: string;
}) => {
  const folder = remotePathWord(options.path);
  const missing = shellQuote(`ultrapaint: no folder ${options.path}`);
  return [
    `[ -d ${folder} ] && cd ${folder} || { printf '%s\\n' ${missing} >&2; exit ${NO_FOLDER_EXIT}; }`,
    // Loopback: the app reaches it through a forwarded port, and nothing else should.
    `exec ${options.command} --host 127.0.0.1 --port 0 --ready-json --stop-with-stdin --session-dir ${remotePathWord(options.sessionDir)}`,
  ].join("\n");
};

/**
 * The string `ssh` runs on the remote machine for a script: the user's login shell, interactive
 * so that what its startup files put on the `PATH` (fnm, nvm, Volta, `~/.local/bin`) is there as
 * in a terminal, which then runs the script with `/bin/sh`, whatever the login shell's syntax.
 */
export const loginShellCommand = (script: string) =>
  `exec "\${SHELL:-/bin/sh}" -ilc ${shellQuote(`exec /bin/sh -c ${shellQuote(script)}`)}`;

/** What every `ssh` the app runs is given: never a prompt, never a terminal. */
const common = (target: SshTarget) => [
  ...(target.configFile ? ["-F", target.configFile] : []),
  ...(target.port === undefined ? [] : ["-p", String(target.port)]),
  // A password or a passphrase cannot be typed: the agent or a key without one is needed.
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=15",
  "-T",
];

/**
 * The connection: a master on `socket`, in the foreground whatever the configuration says, with
 * none of the configuration's forwards, which could fail and are not the app's. It notices a
 * dropped connection within half a minute. Its session reads stdin until the app closes it.
 */
export const masterArgs = (target: SshTarget, socket: string) => [
  ...common(target),
  "-S",
  socket,
  "-o",
  "ControlMaster=yes",
  "-o",
  "ControlPersist=no",
  "-o",
  "ClearAllForwardings=yes",
  "-o",
  "RemoteCommand=none",
  "-o",
  "ServerAliveInterval=10",
  "-o",
  "ServerAliveCountMax=3",
  "--",
  target.host,
  "exec cat >/dev/null",
];

/** A session on the connection, running `command` (a string for the remote shell). */
export const sessionArgs = (
  target: SshTarget,
  socket: string,
  command: string
) => [
  ...common(target),
  "-S",
  socket,
  "-o",
  "ControlMaster=no",
  "-o",
  "RemoteCommand=none",
  "--",
  target.host,
  command,
];

/** A port of the remote machine forwarded to loopback here, as a local forward spells it. */
export interface Forward {
  readonly local: number;
  /** The address the remote machine reaches it at: `127.0.0.1`. */
  readonly remoteHost: string;
  readonly remotePort: number;
}

/** Adds a forward to the live connection, or cancels one. */
export const forwardArgs = (
  target: SshTarget,
  socket: string,
  operation: "forward" | "cancel",
  forward: Forward
) => [
  ...(target.configFile ? ["-F", target.configFile] : []),
  "-S",
  socket,
  "-O",
  operation,
  "-L",
  `127.0.0.1:${forward.local}:${forward.remoteHost}:${forward.remotePort}`,
  "--",
  target.host,
];

/** What a shell says when it starts interactively without a terminal: noise, not a reason. */
const SHELL_NOISE_RE =
  /cannot set terminal process group|no job control in this shell|Inappropriate ioctl/i;

/** The last lines that say something, for a message. */
export const lastLines = (stderr: string, count = 5) =>
  stderr
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "" && !SHELL_NOISE_RE.test(line))
    .slice(-count)
    .join("\n");

const UNREACHABLE_RE =
  /could not resolve hostname|connection refused|connection timed out|operation timed out|no route to host|network is unreachable|connection closed by|connection reset|broken pipe|timeout/i;
const HOST_KEY_RE =
  /host key verification failed|remote host identification has changed|host key for .* has changed/i;
const AUTH_RE =
  /permission denied|too many authentication failures|no more authentication methods|authentication failed/i;
const NODE_MISSING_RE =
  /env: ['‘]?node['’]?: no such file|node: (command )?not found|node: no such file/i;

/**
 * What a failed `ssh` means, from its exit code and what it and the remote shell said: 255 is
 * `ssh`'s own (the connection), 127 a command the login shell did not find, `NO_FOLDER_EXIT` the
 * project's folder.
 */
export const sshFailure = (options: {
  readonly command: string;
  readonly exitCode: number;
  readonly host: string;
  readonly path?: string | undefined;
  readonly stderr: string;
}): SshError => {
  const { command, exitCode, host } = options;
  const said = lastLines(options.stderr);
  const because = said ? `:\n${said}` : "";
  if (exitCode === 255) {
    if (HOST_KEY_RE.test(said)) {
      return new SshError({
        message: `The key of ${host} is not known yet, or it changed. Connect once in a terminal with ssh ${host}, which shows the key, and accept it there${because}`,
        retryable: false,
      });
    }
    if (AUTH_RE.test(said)) {
      return new SshError({
        message: `${host} did not accept a key. The app cannot type a password or a key's passphrase: load the key into your SSH agent (ssh-add), or set up a key for ${host} (ssh-copy-id ${host})${because}`,
        retryable: false,
      });
    }
    return new SshError({
      message: UNREACHABLE_RE.test(said)
        ? `${host} could not be reached${because}`
        : `ssh to ${host} failed${because}`,
      retryable: true,
    });
  }
  if (exitCode === 127) {
    return new SshError({
      message: NODE_MISSING_RE.test(said)
        ? `Node.js is not on the PATH of ${host}'s login shell. Install Node.js 24 or newer there (https://nodejs.org), or give the project's command with Node's full path${because}`
        : `${command} is not installed on ${host}, or not on its login shell's PATH. Install ultrapaint there from a release (pnpm add -g ./ultrapaint-<version>.tgz) or a checkout (pnpm install:cli), or give the project the command that runs it${because}`,
      retryable: false,
    });
  }
  if (exitCode === 126) {
    return new SshError({
      message: `${command} on ${host} is not a program that runs${because}`,
      retryable: false,
    });
  }
  if (exitCode === NO_FOLDER_EXIT && options.path !== undefined) {
    return new SshError({
      message: `There is no folder ${options.path} on ${host}`,
      retryable: false,
    });
  }
  return new SshError({
    message: `The server on ${host} stopped before it said where it listens (${exitCode})${because}`,
    retryable: false,
  });
};

/** The environment of the `ssh` the app runs: its own, without what is the app's alone. */
export const sshEnv = (
  inherited: Readonly<Record<string, string | undefined>>,
  login: Readonly<Record<string, string>>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries({ ...inherited, ...login }).flatMap(([name, value]) =>
      value === undefined ||
      name.startsWith("ULTRAPAINT_") ||
      name === "ELECTRON_RUN_AS_NODE"
        ? []
        : [[name, value]]
    )
  );
