/**
 * The `ultrapaint` command: serves the built editor and the backend on one port, from the
 * directory it is run in, and opens the browser. The working directory matters: the server
 * looks for an `ultrapaint.config.json` from there upwards and proposes the repository around it.
 * Everything the command does not know (`--config`, `--port`, `--help`…) goes to the server as
 * it is.
 *
 * It runs from a source checkout or from the package `pnpm pack:local` makes. In a checkout the
 * server runs from its sources under tsx, and the editor is built when it has no build or its
 * sources changed since. The package carries this file bundled as `cli.mjs`, with the server's
 * bundle in `server/` and the editor's build in `web/` next to it, and has no sources to run.
 *
 * `--dev`, in a checkout only, runs its sources instead of a build: the server under `tsx
 * watch`, which restarts it when a file changes, and the editor under Vite, which reloads it.
 * The browser opens on Vite's port, and Vite proxies the API and the socket to the server. A
 * session started without a configuration is kept in a directory the command owns, so the
 * server's restarts keep it and quitting the command still throws it away. `pnpm dev` in the
 * checkout is this mode with development's ports and settings; a project that links the
 * checkout gets it as `ultrapaint --dev`.
 *
 * `scripts/cli.ts` is the command on the PATH (`pnpm install:cli`) and in a project's
 * `node_modules/.bin` (`ultrapaint@link:<checkout>`); `scripts/dev-runner.ts` is `pnpm dev`.
 * Both call `main` in their own process, so the children are always the command's own and go
 * with its scope.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Console,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Option,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** Whether this is the package's bundled `cli.mjs` rather than a checkout's sources. */
const packaged = !import.meta.url.endsWith(".ts");
const root = packaged
  ? import.meta.dirname
  : path.resolve(import.meta.dirname, "..");
const serverDir = path.join(root, "apps", "server");
const serverBin = path.join(serverDir, "src", "bin.ts");
// Otherwise tsx reads the tsconfig of the repository the command is run in.
const serverTsconfig = path.join(serverDir, "tsconfig.json");
const webDir = path.join(root, "apps", "web");
const webDist = packaged ? path.join(root, "web") : path.join(webDir, "dist");
// The server is TypeScript that imports workspace packages as TypeScript; tsx runs it as it is.
const tsx = () =>
  createRequire(path.join(serverDir, "package.json")).resolve("tsx/cli");
/**
 * A development process under its guard (`dev-guard.ts`), which takes it down with what it started
 * when the runner goes away without stopping it.
 */
const guarded = (args: readonly string[]) => [
  "--experimental-strip-types",
  path.join(root, "scripts", "dev-guard.ts"),
  process.execPath,
  ...args,
];
// Vite does not export its bin; its package.json says where it is.
const vite = () => {
  const vitePackage = createRequire(path.join(webDir, "package.json")).resolve(
    "vite/package.json"
  );
  return path.join(
    path.dirname(vitePackage),
    (
      JSON.parse(readFileSync(vitePackage, "utf8")) as {
        bin: { vite: string };
      }
    ).bin.vite
  );
};
/** What starts the server, before its own flags: its bundle, or its sources under tsx. */
const serverEntry = (): readonly string[] =>
  packaged
    ? [path.join(root, "server", "bin.mjs")]
    : [tsx(), "--tsconfig", serverTsconfig, serverBin];

const DEFAULT_PORT = 4770;
const INFORMATIONAL = new Set(["--help", "-h", "--version", "-v"]);
/** Flags of the command itself; the server never sees them. */
const OWN_FLAGS = new Set(["--dev", "--no-open"]);
const OWN_HELP = packaged
  ? `
FLAGS OF THE COMMAND
  --no-open            Do not open the browser
`
  : `
FLAGS OF THE COMMAND
  --dev                Run the checkout's sources with hot reload instead of a build
  --no-open            Do not open the browser

  With --dev, --host and --allowed-host apply to the editor's dev server too, and
  ULTRAPAINT_WEB_PORT is its port (default: the server's port plus one).
`;

/** The server's ready line: where it listens. */
const decodeReady = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ url: Schema.String }))
);

/** The value of `--name value` or `--name=value` in the arguments, if given. */
const flagValue = (args: readonly string[], name: string) => {
  const index = args.findIndex(
    (arg) => arg === name || arg.startsWith(`${name}=`)
  );
  return index === -1
    ? undefined
    : (args[index]?.split("=")[1] ?? args[index + 1]);
};

/** Every value of a flag given more than once, `--name value` or `--name=value`. */
const flagValues = (args: readonly string[], name: string) =>
  args.flatMap((arg, index) => {
    if (arg.startsWith(`${name}=`)) {
      return [arg.slice(name.length + 1)];
    }
    const next = args[index + 1];
    return arg === name && next !== undefined ? [next] : [];
  });

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

/** The latest change under a directory, its installs and builds aside; a deletion counts too. */
const newestUnder = (dir: string): number => {
  let newest = statSync(dir).mtimeMs;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestUnder(full) : statSync(full).mtimeMs
    );
  }
  return newest;
};

/** The editor's package and the workspace packages it is built from, transitively. */
const editorPackages = (): readonly string[] => {
  const dirs = [webDir];
  for (const dir of dirs) {
    const { dependencies = {} } = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };
    for (const [name, version] of Object.entries(dependencies)) {
      const workspace = path.join(
        root,
        "packages",
        name.replace("@ultrapaint/", "")
      );
      if (version.startsWith("workspace:") && !dirs.includes(workspace)) {
        dirs.push(workspace);
      }
    }
  }
  return dirs;
};

/**
 * Whether the build is older than what it is built from. A pull or a checkout writes the files
 * it changes, so their times say the build no longer matches; the lockfile stands for the
 * installed dependencies. Times rather than a hash of the contents: a few hundred `stat`s cost
 * next to nothing at startup.
 */
const editorStale = (built: string) => {
  const lockfile = path.join(root, "pnpm-lock.yaml");
  const sources = [
    ...editorPackages().map(newestUnder),
    existsSync(lockfile) ? statSync(lockfile).mtimeMs : 0,
  ];
  return Math.max(...sources) > statSync(built).mtimeMs;
};

/** The editor is served as a built bundle, built again when its sources have changed since. */
const ensureEditor = Effect.gen(function* () {
  if (packaged) {
    return;
  }
  const built = path.join(webDist, "index.html");
  const fresh = !existsSync(built);
  if (!(fresh || editorStale(built))) {
    return;
  }
  yield* Console.log(
    fresh
      ? "[ultrapaint] building the editor, once…"
      : "[ultrapaint] the editor's sources changed since its build; building it again…"
  );
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
  const serverArgs = args.filter((arg) => !OWN_FLAGS.has(arg));
  // `ultrapaint new <folder>` writes a design and ends: its output is the answer, as for --help.
  const informational =
    serverArgs[0] === "new" || serverArgs.some((arg) => INFORMATIONAL.has(arg));
  // Asked for by whoever runs the command: the ready line is passed on as it is, and that one
  // opens the editor (the desktop app, over SSH too), not a browser here.
  const asked = serverArgs.includes("--ready-json");
  const open = !(args.includes("--no-open") || asked);
  // Whoever started it holds the other end of its stdin, which the server watches: the server
  // gets this command's own stdin rather than none, which would be closed from the start.
  const stopWithStdin = serverArgs.includes("--stop-with-stdin");
  // A build given is served as it is: not rebuilt, and not replaced by the checkout's.
  const givenWebDist = flagValue(serverArgs, "--web-dist") !== undefined;

  const serverPort = Number(
    flagValue(serverArgs, "--port") ??
      process.env.ULTRAPAINT_PORT ??
      DEFAULT_PORT
  );
  const webPort = Number(process.env.ULTRAPAINT_WEB_PORT ?? serverPort + 1);
  // Loopback, with --dev too: whoever reaches the port can run agents with the user's rights,
  // so another machine is let in only when `--host` names an address for it.
  const host =
    flagValue(serverArgs, "--host") ??
    process.env.ULTRAPAINT_HOST ??
    "127.0.0.1";
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

  /**
   * Where the editor is, once it answers: the server's ready line says so for a build; with
   * `--dev`, the server and Vite are asked until they answer.
   */
  const editorReady = (ready: Deferred.Deferred<string>) =>
    dev
      ? Effect.gen(function* () {
          yield* answers(`${serverUrl}/api/health`);
          yield* answers(editorUrl);
          return editorUrl;
        })
      : Deferred.await(ready).pipe(Effect.timeout("2 minutes"));

  // With the ready line asked for, stdout carries that line alone: whoever reads it may stop
  // reading once it has it.
  const say = (line: string) =>
    asked ? Console.error(line) : Console.log(line);

  const openBrowser = (ready: Deferred.Deferred<string>) =>
    Effect.gen(function* () {
      const url = yield* editorReady(ready);
      yield* say(`[ultrapaint] ${url}`);
      for (const address of fromNetwork) {
        yield* say(`[ultrapaint] from the network: ${address}`);
      }
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
      // No browser to open is no reason to stop: the address is printed above.
      yield* Effect.ignore(run(command, rest, root));
    }).pipe(
      // Said once; the processes' own output says why.
      Effect.catch(() =>
        say(`[ultrapaint] ${editorUrl} did not answer in two minutes`)
      )
    );

  /** The server, for `--help`, `--version` and `new`: its output is the answer. */
  const inform = Effect.suspend(() =>
    run(process.execPath, [...serverEntry(), ...serverArgs], cwd)
  );

  /**
   * The server from its sources, serving the built editor. It says on stdout, in one line of
   * JSON, where it listens once it does, and logs to stderr. A server already running for the
   * project answers with its own line, from another process, and this one ends: the editor is
   * that one's (PLAN-desktop D5).
   */
  const serve = (ready: Deferred.Deferred<string>) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(
        ChildProcess.make(
          process.execPath,
          [
            ...serverEntry(),
            ...(givenWebDist ? [] : ["--web-dist", webDist]),
            ...(asked ? [] : ["--ready-json"]),
            ...serverArgs,
          ],
          {
            cwd,
            env: {},
            extendEnv: true,
            forceKillAfter: "3 seconds",
            stderr: "inherit",
            stdin: stopWithStdin ? "inherit" : "ignore",
          }
        )
      );
      yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) =>
          Option.match(decodeReady(line), {
            onNone: () => say(line),
            onSome: (found) =>
              Effect.gen(function* () {
                if (asked) {
                  yield* Console.log(line);
                }
                yield* Deferred.succeed(ready, found.url);
              }),
          })
        ),
        Effect.forkScoped
      );
      return yield* child.exitCode;
    });

  /**
   * The server under `tsx watch` and the editor under Vite, side by side, each under a guard that
   * stops it should the runner be killed. `tsx watch` restarts the server whenever a source
   * changes; an unsaved session lives in a directory of the command's scope so that it survives
   * those restarts. Neither ends on its own, so the first to
   * end (Vite on a taken port, say) ends the session: each runs in a scope of its own, and the
   * other is stopped by closing it. The returned code is the command's.
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
    const [name, code] = yield* Effect.raceFirst(
      Effect.scoped(
        run(
          process.execPath,
          guarded([
            tsx(),
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
          ]),
          cwd,
          { name: "server" }
        )
      ).pipe(Effect.map((exit) => ["server", Number(exit)] as const)),
      Effect.scoped(
        run(process.execPath, guarded([vite()]), webDir, {
          env: {
            // Vite checks the Host of a request itself, before its proxy reaches the server.
            ULTRAPAINT_ALLOWED_HOSTS: flagValues(
              serverArgs,
              "--allowed-host"
            ).join(","),
            ULTRAPAINT_HOST: host,
            ULTRAPAINT_PORT: String(serverPort),
            ULTRAPAINT_WEB_PORT: String(webPort),
          },
          name: "web",
        })
      ).pipe(Effect.map((exit) => ["web", Number(exit)] as const))
    );
    yield* Console.error(
      `[ultrapaint] the ${name} process ended with code ${code}; stopping the session`
    );
    // Ending at all is a failure here, even with 0: the session was meant to run until stopped.
    return code === 0 ? 1 : code;
  });

  const program = Effect.gen(function* () {
    if (informational) {
      process.exitCode = Number(yield* inform);
      if (serverArgs.includes("--help") || serverArgs.includes("-h")) {
        yield* Console.log(OWN_HELP);
      }
      return;
    }
    if (dev && packaged) {
      yield* Console.error(
        "[ultrapaint] --dev runs a checkout's sources, and this package has none"
      );
      process.exitCode = 1;
      return;
    }
    const ready = yield* Deferred.make<string>();
    const opening = yield* Effect.forkScoped(openBrowser(ready));
    if (dev) {
      process.exitCode = yield* develop;
      return;
    }
    if (!givenWebDist) {
      yield* ensureEditor;
    }
    process.exitCode = Number(yield* serve(ready));
    // A server that was running already ends this one at once: its editor is still opened.
    if (process.exitCode === 0 && (yield* Deferred.isDone(ready))) {
      yield* Fiber.join(opening).pipe(
        Effect.timeout("10 seconds"),
        Effect.ignore
      );
    }
  });

  program.pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain
  );
};
