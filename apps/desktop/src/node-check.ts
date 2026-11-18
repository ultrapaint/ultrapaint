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
import { runCommand } from "./command.ts";
import { findExecutable } from "./which.ts";

/** What a new application's Vite needs: `^20.19.0 || >=22.12.0`. */
const MINIMUM = { major: 22, minor: 12 };
const SUPPORTED_20 = { major: 20, minor: 19 };

const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)/;

/**
 * How long `node --version` may take: a version manager's shim (Vite+, mise, Volta) may fetch the
 * Node it picks on its first run.
 */
const TIMEOUT_SECONDS = 30;

/** At most this much of what a failing `node` printed is kept, for the settings to show. */
const REASON_MAX = 300;

/** Whether Vite runs on this version of Node. */
export const supportedNode = (version: string) => {
  const match: RegExpExecArray | null = VERSION_RE.exec(version.trim());
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major === SUPPORTED_20.major) {
    return minor >= SUPPORTED_20.minor;
  }
  return (
    major > MINIMUM.major || (major === MINIMUM.major && minor >= MINIMUM.minor)
  );
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
export const statusOf = (
  path: string,
  result: { exitCode: number; stderr: string; stdout: string }
): NodeStatus => {
  const version = result.stdout.trim();
  if (result.exitCode === 0 && VERSION_RE.test(version)) {
    return supportedNode(version)
      ? { _tag: "Ready", path, version }
      : { _tag: "TooOld", path, version };
  }
  const said = lastLine(result.stderr) || lastLine(result.stdout);
  if (result.exitCode !== 0) {
    const code = `exit code ${result.exitCode}`;
    return { _tag: "Failed", path, reason: said ? `${said} (${code})` : code };
  }
  return {
    _tag: "Failed",
    path,
    reason: said
      ? `It printed “${said}”, not a version.`
      : "It printed nothing.",
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
        reason: `It didn’t answer within ${timeoutSeconds === 1 ? "a second" : `${timeoutSeconds} seconds`}.`,
      })
    ),
    // Not started at all: the system's reason (permission denied, a bad interpreter line).
    Effect.catch((error) =>
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
