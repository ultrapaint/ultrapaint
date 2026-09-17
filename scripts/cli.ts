#!/usr/bin/env node
/**
 * The `ultrapaint` command of a source checkout: serves the built editor and the backend on
 * one port, from the directory it is run in, and opens the browser. The working directory
 * matters: the server looks for an `ultrapaint.json` from there upwards and proposes the
 * repository around it. Everything it does not know (`--config`, `--port`, `--help`…) goes to
 * the server as it is.
 *
 * `pnpm link --global` in the checkout puts it on the PATH.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Schedule } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const root = path.resolve(import.meta.dirname, "..");
const serverDir = path.join(root, "apps", "server");
const webDist = path.join(root, "apps", "web", "dist");
// The server is TypeScript that imports workspace packages as TypeScript; tsx runs it as it is.
const tsx = createRequire(path.join(serverDir, "package.json")).resolve(
  "tsx/cli"
);

const DEFAULT_PORT = 4770;
const INFORMATIONAL = new Set(["--help", "-h", "--version", "-v"]);

const args = process.argv.slice(2);
const open = !args.includes("--no-open");
const serverArgs = args.filter((arg) => arg !== "--no-open");
const informational = serverArgs.some((arg) => INFORMATIONAL.has(arg));

const portFlag = serverArgs.findIndex(
  (arg) => arg === "--port" || arg.startsWith("--port=")
);
const portValue =
  portFlag === -1
    ? process.env.ULTRAPAINT_PORT
    : (serverArgs[portFlag]?.split("=")[1] ?? serverArgs[portFlag + 1]);
const port = Number(portValue ?? DEFAULT_PORT);
const url = `http://127.0.0.1:${port}`;

const run = (command: string, commandArgs: readonly string[], cwd: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(command, commandArgs, {
        cwd,
        extendEnv: true,
        forceKillAfter: "3 seconds",
        stderr: "inherit",
        stdin: "ignore",
        stdout: "inherit",
      })
    );
    return yield* child.exitCode;
  });

/** The editor is served as a built bundle; a fresh checkout builds it once. */
const ensureEditor = Effect.gen(function* () {
  if (existsSync(path.join(webDist, "index.html"))) {
    return;
  }
  yield* Console.log("[ultrapaint] building the editor, once…");
  const code = yield* run("pnpm", ["-F", "@ultrapaint/web", "build"], root);
  if (Number(code) !== 0) {
    return yield* Effect.die(new Error("the editor could not be built"));
  }
});

const healthy = Effect.tryPromise(() => fetch(`${url}/api/health`)).pipe(
  Effect.filterOrFail((response) => response.ok)
);

const openBrowser = Effect.gen(function* () {
  yield* healthy.pipe(
    Effect.retry(Schedule.spaced("150 millis")),
    Effect.timeout("30 seconds")
  );
  yield* Console.log(`[ultrapaint] ${url}`);
  if (!open) {
    return;
  }
  const opener: Record<string, readonly string[]> = {
    darwin: ["open", url],
    win32: ["cmd", "/c", "start", "", url],
  };
  const [command = "xdg-open", ...rest] = opener[process.platform] ?? [
    "xdg-open",
    url,
  ];
  yield* run(command, rest, root);
  // No browser to open is no reason to stop: the address is printed above.
}).pipe(Effect.ignore);

const program = Effect.gen(function* () {
  if (!informational) {
    yield* ensureEditor;
    yield* Effect.forkScoped(openBrowser);
  }
  const code = yield* run(
    process.execPath,
    [
      tsx,
      // Otherwise tsx reads the tsconfig of the repository the command is run in.
      "--tsconfig",
      path.join(serverDir, "tsconfig.json"),
      path.join(serverDir, "src", "bin.ts"),
      "--web-dist",
      webDist,
      ...serverArgs,
    ],
    // Where the command was typed: the repository the user is in.
    process.cwd()
  );
  process.exitCode = Number(code);
});

program.pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
