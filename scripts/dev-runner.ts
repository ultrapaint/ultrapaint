/**
 * Starts the server and the web dev server together, on ports derived from the checkout path
 * so several worktrees can run side by side. Both children live in one scope: Ctrl-C closes it
 * and ends each child's whole process group, including what `tsx watch` and Vite started.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const root = path.resolve(import.meta.dirname, "..");
const hash = createHash("sha1").update(root).digest();
const base = 4700 + ((hash[0] as number) % 40) * 2;
const serverPort = Number(process.env.ULTRAPAINT_PORT ?? base);
const webPort = Number(process.env.ULTRAPAINT_WEB_PORT ?? base + 1);

// Everything after `pnpm dev --` goes to the server: `--config <file>` to work from a
// configuration file, `--ephemeral` to try the unsaved mode. Without either, development keeps
// its settings the way the desktop app does, in `~/.ultrapaint`.
// The server runs from `apps/server`, so a relative `--config` is resolved here, against the
// directory `pnpm dev` was typed in.
const invokedFrom = process.env.INIT_CWD ?? process.cwd();
const serverArgs = process.argv
  .slice(2)
  .filter((arg) => arg !== "--")
  .map((arg, index, all) => {
    if (all[index - 1] === "--config") {
      return path.resolve(invokedFrom, arg);
    }
    return arg.startsWith("--config=")
      ? `--config=${path.resolve(invokedFrom, arg.slice("--config=".length))}`
      : arg;
  });
const picksStorage =
  serverArgs.some(
    (arg) => arg === "--ephemeral" || arg.startsWith("--config")
  ) || process.env.ULTRAPAINT_CONFIG !== undefined;
const home =
  process.env.ULTRAPAINT_HOME ??
  path.join(process.env.HOME ?? root, ".ultrapaint");

const run = Effect.fn("run")(function* (
  name: string,
  app: string,
  args: readonly string[] = []
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make("pnpm", ["dev", ...args], {
      cwd: path.join(root, "apps", app),
      env: {
        ULTRAPAINT_PORT: String(serverPort),
        ULTRAPAINT_WEB_PORT: String(webPort),
        ...(picksStorage ? {} : { ULTRAPAINT_HOME: home }),
      },
      extendEnv: true,
      forceKillAfter: "2 seconds",
      stdin: "ignore",
    })
  );
  yield* child.all.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) => Console.log(`[${name}] ${line}`))
  );
  const code = yield* child.exitCode;
  yield* Console.log(`[dev-runner] ${name} exited (${code})`);
});

Console.log(
  `[dev-runner] server http://127.0.0.1:${serverPort}  web http://127.0.0.1:${webPort}`
).pipe(
  Effect.andThen(
    Effect.all([run("server", "server", serverArgs), run("web", "web")], {
      concurrency: "unbounded",
    })
  ),
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
