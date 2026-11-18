/**
 * The user's Node (PLAN-desktop D7, ADR 0105): a new application's packages are installed with
 * it, and the application runs with it. The editor itself needs none (its server is the app's own
 * Node, and the canvas draws the editor's components). A missing, too old or failing Node is said
 * up front, rather than as an install that fails: a one-line notice over the editor, and what was
 * found, in full, in Settings › About.
 */

import type {
  NodeStatus,
  ShellNotice,
} from "@ultrapaint/contracts/shell-bridge";
import { Effect, Option } from "effect";
import { type CommandResult, runCommand } from "./command.ts";
import { findExecutable } from "./which.ts";

/** What a new application's Vite needs: `^20.19.0 || >=22.12.0`. */
const MINIMUM = { major: 22, minor: 12 };
const SUPPORTED_20 = { major: 20, minor: 19 };

/**
 * A version and nothing else, a pre-release's (`v25.0.0-rc.1`) too: a shim's "v24.3.0 is not
 * installed" is not one.
 */
const VERSION_RE =
  /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * How long `node --version` may take: a version manager's shim (Vite+, mise, Volta) may fetch the
 * Node it picks on its first run.
 */
const TIMEOUT_SECONDS = 30;

/** At most this much of what a failing `node` printed is kept, for the settings to show. */
const REASON_MAX = 300;

/** Whether a version reaches `floor`: a pre-release of the floor itself (`v22.12.0-rc.1`) comes before it. */
const reaches = (
  floor: { major: number; minor: number },
  major: number,
  minor: number,
  patch: number,
  preRelease: boolean
) =>
  major > floor.major ||
  (major === floor.major &&
    (minor > floor.minor ||
      (minor === floor.minor && (patch > 0 || !preRelease))));

/** Whether Vite runs on this version of Node. */
export const supportedNode = (version: string) => {
  const match: RegExpExecArray | null = VERSION_RE.exec(version.trim());
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const preRelease = match[4] !== undefined;
  if (major === SUPPORTED_20.major) {
    return reaches(SUPPORTED_20, major, minor, patch, preRelease);
  }
  return reaches(MINIMUM, major, minor, patch, preRelease);
};

/** The last line that says something, shortened to what a row can hold. */
const lastLine = (output: string) => {
  const line =
    output
      .split("\n")
      .map((l) => l.trim())
      .findLast((l) => l.length > 0) ?? "";
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX)}…` : line;
};

/** What `node --version` did, as the status it makes. */
export const statusOf = (path: string, result: CommandResult): NodeStatus => {
  const version = result.stdout.trim();
  if (result.exitCode === 0 && VERSION_RE.test(version)) {
    return supportedNode(version)
      ? { _tag: "Ready", path, version }
      : { _tag: "TooOld", path, version };
  }
  const warned = lastLine(result.stderr);
  if (result.exitCode !== 0) {
    const said = warned || lastLine(result.stdout);
    const code = `exit code ${result.exitCode}`;
    return { _tag: "Failed", path, reason: said ? `${said} (${code})` : code };
  }
  // It succeeded: what it printed is what failed to be a version, and a warning is said beside it.
  const printed = lastLine(result.stdout);
  const what = printed
    ? `It printed “${printed}”, not a version.`
    : "It printed nothing.";
  return {
    _tag: "Failed",
    path,
    reason: warned ? `${what} It warned: ${warned}` : what,
  };
};

/**
 * `node` on the login shell's `PATH`, and its version, asked with the environment the servers the
 * app starts get (`LoginShell`), so the Node a new application's install would meet.
 */
export const checkNode = Effect.fnUntraced(function* (
  env: Readonly<Record<string, string>>,
  timeoutSeconds = TIMEOUT_SECONDS
) {
  // A login shell that said no PATH leaves none to search.
  const searchPath: string | undefined = env.PATH;
  const found = yield* findExecutable("node", searchPath ?? "");
  if (Option.isNone(found)) {
    return { _tag: "Missing" } as NodeStatus;
  }
  const path = found.value;
  return yield* runCommand(path, ["--version"], {
    env,
    timeout: `${timeoutSeconds} seconds`,
  }).pipe(
    Effect.map((result) => statusOf(path, result)),
    Effect.catchTag("TimeoutError", () =>
      Effect.succeed<NodeStatus>({
        _tag: "Failed",
        path,
        reason: `It didn’t answer within ${timeoutSeconds} seconds.`,
      })
    ),
    // Not started at all: the system's reason (permission denied, a bad interpreter line).
    Effect.catchTag("PlatformError", (error) =>
      Effect.succeed<NodeStatus>({
        _tag: "Failed",
        path,
        reason: lastLine(error.message) || "It couldn’t be started.",
      })
    )
  );
});

/** The notice's one line: what is wrong, in a few words. */
const noticeTitle = (status: Exclude<NodeStatus, { _tag: "Ready" }>) => {
  if (status._tag === "TooOld") {
    return `Node.js ${status.version} is too old`;
  }
  return status._tag === "Failed"
    ? "Node.js didn’t run"
    : "Node.js is not installed";
};

/** The notice over the editor, when Node is not what a new application needs. */
export const nodeNotice = (status: NodeStatus): Option.Option<ShellNotice> =>
  status._tag === "Ready"
    ? Option.none()
    : Option.some({ id: "node", section: "about", title: noticeTitle(status) });
