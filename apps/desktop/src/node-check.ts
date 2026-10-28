/**
 * The user's Node (PLAN-desktop D7): a new application's packages are installed with it, and its
 * dev server runs with it. The app does not bring one; a missing or too old Node is said up
 * front, with how to install it, rather than as an install that fails.
 */

import type { ShellNotice } from "@ultrapaint/contracts/shell-bridge";
import { Effect, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { findExecutable } from "./which.ts";

/** What a new application's Vite needs: `^20.19.0 || >=22.12.0`. */
const MINIMUM = { major: 22, minor: 12 };
const SUPPORTED_20 = { major: 20, minor: 19 };

const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)/;

export type NodeStatus =
  | { readonly _tag: "Missing" }
  | {
      readonly _tag: "Found";
      readonly path: string;
      readonly supported: boolean;
      readonly version: string;
    };

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

/** `node` on the search path, and its version. */
export const checkNode = Effect.fnUntraced(function* (searchPath: string) {
  const found = yield* findExecutable("node", searchPath);
  if (Option.isNone(found)) {
    return { _tag: "Missing" } as NodeStatus;
  }
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const version = yield* spawner
    .string(
      ChildProcess.make(found.value, ["--version"], {
        env: { PATH: searchPath },
        extendEnv: true,
        stdin: "ignore",
      })
    )
    .pipe(
      Effect.timeout("10 seconds"),
      Effect.map((out) => out.trim()),
      Effect.orElseSucceed(() => "")
    );
  return {
    _tag: "Found",
    path: found.value,
    supported: supportedNode(version),
    version: version || "unknown",
  } as NodeStatus;
});

/** A notice for the editor's banner, when Node is not what the preview needs. */
export const nodeNotice = (
  status: NodeStatus,
  platform: NodeJS.Platform
): Option.Option<ShellNotice> => {
  if (status._tag === "Found" && status.supported) {
    return Option.none();
  }
  return Option.some({
    ...(platform === "darwin" ? { command: "brew install node" } : {}),
    detail:
      "The preview runs your project's components with Node.js 22.12 or newer, and installs its packages with it. Install it, then restart Ultrapaint.",
    id: "node",
    link: { label: "Download Node.js", url: "https://nodejs.org/en/download" },
    title:
      status._tag === "Missing"
        ? "Node.js is not installed"
        : `Node.js ${status.version} is too old`,
  });
};
