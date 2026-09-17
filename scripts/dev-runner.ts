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

const run = Effect.fn("run")(function* (name: string, app: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make("pnpm", ["dev"], {
      cwd: path.join(root, "apps", app),
      env: {
        ULTRAPAINT_PORT: String(serverPort),
        ULTRAPAINT_WEB_PORT: String(webPort),
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
    Effect.all([run("server", "server"), run("web", "web")], {
      concurrency: "unbounded",
    })
  ),
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
