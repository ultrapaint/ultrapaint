/**
 * The `ultrapaint` command of a source checkout: serves the built editor and the backend on
 * one port, from the directory it is run in, and opens the browser. The working directory
 * matters: the server looks for an `ultrapaint.json` from there upwards and proposes the
 * repository around it. Everything the command does not know (`--config`, `--port`,
 * `--help`…) goes to the server as it is.
 *
 * `--dev` runs the checkout's sources instead of a build: the server under `tsx watch`, which
 * restarts it when a file changes, and the editor under Vite, which reloads it. The browser
 * opens on Vite's port, and Vite proxies the API and the socket to the server. A session
 * started without a configuration is kept in a directory the command owns, so the server's
 * restarts keep it and quitting the command still throws it away. `pnpm dev` in the checkout
 * is this mode with development's ports and settings; a project that links the checkout gets
 * it as `ultrapaint --dev`.
 *
 * `scripts/cli.ts` is the command on the PATH (`pnpm install:cli`) and in a project's
 * `node_modules/.bin` (`ultrapaint@link:<checkout>`); `scripts/dev-runner.ts` is `pnpm dev`.
 * Both call `main` in their own process, so the children are always the command's own and go
 * with its scope.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Schedule, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const root = path.resolve(import.meta.dirname, "..");
const serverDir = path.join(root, "apps", "server");
const serverBin = path.join(serverDir, "src", "bin.ts");
// Otherwise tsx reads the tsconfig of the repository the command is run in.
const serverTsconfig = path.join(serverDir, "tsconfig.json");
const webDir = path.join(root, "apps", "web");
const webDist = path.join(webDir, "dist");
// The server is TypeScript that imports workspace packages as TypeScript; tsx runs it as it is.
const tsx = createRequire(path.join(serverDir, "package.json")).resolve(
  "tsx/cli"
);
// Vite does not export its bin; its package.json says where it is.
const vitePackage = createRequire(path.join(webDir, "package.json")).resolve(
  "vite/package.json"
);
const vite = path.join(
  path.dirname(vitePackage),
  (JSON.parse(readFileSync(vitePackage, "utf8")) as { bin: { vite: string } })
    .bin.vite
);

const DEFAULT_PORT = 4770;
const INFORMATIONAL = new Set(["--help", "-h", "--version", "-v"]);
/** Flags of the command itself; the server never sees them. */
const OWN_FLAGS = new Set(["--dev", "--no-open"]);
const OWN_HELP = `
FLAGS OF THE COMMAND
  --dev                Run the checkout's sources with hot reload instead of a build,
                       on every interface unless --host says otherwise
  --no-open            Do not open the browser

  With --dev, --host applies to the editor's dev server too, and ULTRAPAINT_WEB_PORT is its
  port (default: the server's port plus one).
`;

/** The value of `--name value` or `--name=value` in the arguments, if given. */
const flagValue = (args: readonly string[], name: string) => {
  const index = args.findIndex(
    (arg) => arg === name || arg.startsWith(`${name}=`)
  );
  return index === -1
    ? undefined
    : (args[index]?.split("=")[1] ?? args[index + 1]);
};

/** An address as it goes into a URL: an IPv6 one in brackets. */
const inUrl = (address: string) =>
  address.includes(":") ? `[${address}]` : address;

/** The addresses the editor is reachable at when bound to every interface. */
const machineAddresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((net) => net?.family === "IPv4" && !net.internal)
    .map((net) => net?.address ?? "");

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
  /** Given, the child's output is printed line by line under this name. */
  readonly name?: string;
}

const run = (
  command: string,
  commandArgs: readonly string[],
  cwd: string,
  options: RunOptions = {}
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const stdio = options.name
      ? {}
      : { stderr: "inherit" as const, stdout: "inherit" as const };
    const child = yield* spawner.spawn(
      ChildProcess.make(command, commandArgs, {
        cwd,
        env: options.env ?? {},
        extendEnv: true,
        forceKillAfter: "3 seconds",
        stdin: "ignore",
        ...stdio,
      })
    );
    const { name } = options;
    if (name) {
      yield* child.all.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) => Console.log(`[${name}] ${line}`))
      );
    }
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

/**
 * Waits for the address to answer. A request the server accepted before it was ready is
 * dropped and would wait forever, so each attempt is short; the whole wait is long, because
 * Vite's first page can take a while when it optimises dependencies.
 */
const answers = (url: string) =>
  Effect.tryPromise((signal) => fetch(url, { signal })).pipe(
    Effect.filterOrFail((response) => response.ok),
    Effect.timeout("2 seconds"),
    Effect.retry(Schedule.spaced("150 millis")),
    Effect.timeout("2 minutes")
  );

/** Runs the command with its arguments, in this process; returns when it is over. */
export const main = (args: readonly string[]): void => {
  const dev = args.includes("--dev");
  const open = !args.includes("--no-open");
  const serverArgs = args.filter((arg) => !OWN_FLAGS.has(arg));
  const informational = serverArgs.some((arg) => INFORMATIONAL.has(arg));

  const serverPort = Number(
    flagValue(serverArgs, "--port") ??
      process.env.ULTRAPAINT_PORT ??
      DEFAULT_PORT
  );
  const webPort = Number(process.env.ULTRAPAINT_WEB_PORT ?? serverPort + 1);
  // Development is reached from other machines as a matter of course; a build is not.
  const host =
    flagValue(serverArgs, "--host") ??
    process.env.ULTRAPAINT_HOST ??
    (dev ? "0.0.0.0" : "127.0.0.1");
  const wildcard = host === "0.0.0.0" || host === "::";
  // Where this machine reaches what is bound to `host`.
  const reach = wildcard ? "127.0.0.1" : inUrl(host);
  const serverUrl = `http://${reach}:${serverPort}`;
  const editorPort = dev ? webPort : serverPort;
  /** Where the editor is: served by the server from its build, or by Vite with `--dev`. */
  const editorUrl = `http://${reach}:${editorPort}`;
  // Bound to one address, the line above already names it.
  const fromNetwork = wildcard
    ? machineAddresses().map((address) => `http://${address}:${editorPort}`)
    : [];
  // Where the command was typed: the repository the user is in.
  const cwd = process.cwd();

  const openBrowser = Effect.gen(function* () {
    yield* answers(`${serverUrl}/api/health`);
    if (dev) {
      yield* answers(editorUrl);
    }
    yield* Console.log(`[ultrapaint] ${editorUrl}`);
    for (const url of fromNetwork) {
      yield* Console.log(`[ultrapaint] from the network: ${url}`);
    }
    if (!open) {
      return;
    }
    const opener: Record<string, readonly string[]> = {
      darwin: ["open", editorUrl],
      win32: ["cmd", "/c", "start", "", editorUrl],
    };
    const [command = "xdg-open", ...rest] = opener[process.platform] ?? [
      "xdg-open",
      editorUrl,
    ];
    // No browser to open is no reason to stop: the address is printed above.
    yield* Effect.ignore(run(command, rest, root));
  }).pipe(
    // Said once; the processes' own output says why.
    Effect.catch(() =>
      Console.log(`[ultrapaint] ${editorUrl} did not answer in two minutes`)
    )
  );

  /** The server from its sources, serving the built editor. */
  const serve = run(
    process.execPath,
    [
      tsx,
      "--tsconfig",
      serverTsconfig,
      serverBin,
      "--web-dist",
      webDist,
      ...serverArgs,
    ],
    cwd
  );

  /**
   * The server under `tsx watch` and the editor under Vite, side by side in one scope. `tsx
   * watch` restarts the server whenever a source changes; an unsaved session lives in a
   * directory of the command's scope so that it survives those restarts.
   */
  const develop = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const session =
      flagValue(serverArgs, "--session-dir") === undefined
        ? [
            "--session-dir",
            yield* fs.makeTempDirectoryScoped({
              prefix: "ultrapaint-session-",
            }),
          ]
        : [];
    return yield* Effect.all(
      [
        run(
          process.execPath,
          [
            tsx,
            "watch",
            "--clear-screen=false",
            "--tsconfig",
            serverTsconfig,
            serverBin,
            "--host",
            host,
            "--port",
            String(serverPort),
            ...session,
            ...serverArgs,
          ],
          cwd,
          { name: "server" }
        ),
        run(process.execPath, [vite], webDir, {
          env: {
            ULTRAPAINT_HOST: host,
            ULTRAPAINT_PORT: String(serverPort),
            ULTRAPAINT_WEB_PORT: String(webPort),
          },
          name: "web",
        }),
      ],
      { concurrency: "unbounded" }
    );
  });

  const program = Effect.gen(function* () {
    if (informational) {
      process.exitCode = Number(yield* serve);
      if (serverArgs.includes("--help") || serverArgs.includes("-h")) {
        yield* Console.log(OWN_HELP);
      }
      return;
    }
    yield* Effect.forkScoped(openBrowser);
    if (dev) {
      yield* develop;
      return;
    }
    yield* ensureEditor;
    process.exitCode = Number(yield* serve);
  });

  program.pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain
  );
};
