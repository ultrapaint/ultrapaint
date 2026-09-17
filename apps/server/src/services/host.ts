import { createServer } from "node:net";
import type { HostStatus } from "@ultrapaint/contracts/project";
import { buildHostPlugin } from "@ultrapaint/host-plugin/build";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Schedule,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { AppLog } from "../app-log.ts";
import { makeWriteAtomic } from "../atomic-write.ts";
import { hostFiles } from "./host-files.ts";
import { RepoPaths } from "./repo-paths.ts";

const NO_VITE =
  "The designs package cannot resolve `vite`. Add `vite`, `@vitejs/plugin-react` and `@tailwindcss/vite` to its devDependencies and install.";

const freePort = Effect.callback<number, Error>((resume) => {
  const server = createServer();
  server.on("error", (error) => resume(Effect.fail(error)));
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(() => resume(Effect.succeed(port)));
  });
});

/** True once anything answers on the port; Vite replies before its first build finishes. */
const probe = (port: number) =>
  Effect.tryPromise(() =>
    fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" })
  ).pipe(
    Effect.filterOrFail((res) => res.status < 500),
    Effect.asVoid
  );

interface Running {
  readonly scope: Scope.Closeable;
}

/**
 * Runs the preview host: the target repository's own Vite, started inside the designs
 * package with a generated configuration. The child lives in its own scope, so stopping the
 * host, reopening the project and shutting the server down all end the same process.
 */
export class HostManager extends Context.Service<
  HostManager,
  {
    /** Emits the current status, then every change. */
    readonly changes: Stream.Stream<HostStatus>;
    readonly start: Effect.Effect<HostStatus>;
    readonly status: Effect.Effect<HostStatus>;
    readonly stop: Effect.Effect<HostStatus>;
  }
>()("ultrapaint/server/HostManager") {
  static readonly layer = Layer.effect(
    HostManager,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const log = yield* AppLog;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const layerScope = yield* Effect.scope;
      const writeAtomic = makeWriteAtomic(fs, path);
      const status = yield* SubscriptionRef.make<HostStatus>({
        state: "stopped",
      });
      // start and stop never interleave.
      const lifecycle = yield* Semaphore.make(1);
      let running: Running | null = null;

      const setStatus = (next: HostStatus) =>
        Effect.as(SubscriptionRef.set(status, next), next);

      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

      /** The designs package must resolve `vite`; it is driven through its JS API. */
      const resolvesVite = Effect.gen(function* () {
        const candidates = [paths.designsDir, paths.root].map((base) =>
          path.join(base, "node_modules", "vite", "package.json")
        );
        for (const candidate of candidates) {
          if (yield* exists(candidate)) {
            return true;
          }
        }
        return false;
      });

      const generate = Effect.fnUntraced(function* (built: {
        plugin: string;
        runtime: string;
      }) {
        const dir = path.join(paths.designsDir, ".ultrapaint");
        const files = hostFiles({
          built,
          designsDir: paths.designsDir,
          dir,
          root: paths.root,
          settings: paths.settings,
        });
        for (const [name, content] of Object.entries(files)) {
          yield* writeAtomic(path.join(dir, name), content);
        }
        const ignore = path.join(dir, ".gitignore");
        if (!(yield* exists(ignore))) {
          yield* writeAtomic(ignore, "*\n");
        }
        return dir;
      });

      const pipeOutput = (
        stream: Stream.Stream<Uint8Array, unknown>,
        level: "info" | "warn"
      ) =>
        stream.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) => log.log("host", level, chunk.trimEnd())),
          Effect.ignore
        );

      const launch = Effect.gen(function* () {
        if (!(yield* resolvesVite)) {
          return yield* setStatus({ error: NO_VITE, state: "error" });
        }
        yield* setStatus({ state: "starting" });
        const built = yield* Effect.tryPromise(() => buildHostPlugin()).pipe(
          Effect.mapError((e) => `host plugin build failed: ${String(e.cause)}`)
        );
        const dir = yield* Effect.orDie(generate(built));
        const port = yield* Effect.orDie(freePort);

        const scope = yield* Scope.fork(layerScope);
        const stopped = yield* Deferred.make<void>();
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(
              process.execPath,
              [path.join(dir, "serve.mjs"), String(port)],
              {
                cwd: paths.designsDir,
                env: { FORCE_COLOR: "0", NODE_ENV: "development" },
                extendEnv: true,
                forceKillAfter: "3 seconds",
                stdin: "ignore",
              }
            )
          )
          .pipe(
            Scope.provide(scope),
            Effect.mapError((e) => `vite could not be started: ${e.message}`),
            Effect.onError(() => Scope.close(scope, Exit.void))
          );
        running = { scope };
        yield* Scope.addFinalizer(scope, Deferred.succeed(stopped, undefined));
        yield* Effect.forkIn(pipeOutput(handle.stdout, "info"), scope);
        yield* Effect.forkIn(pipeOutput(handle.stderr, "warn"), scope);

        // An exit we did not ask for is an error the editor must see.
        const exited = handle.exitCode.pipe(
          Effect.map((code) => `vite exited (${code})`),
          Effect.orElseSucceed(() => "vite exited")
        );
        yield* Effect.forkIn(
          Effect.gen(function* () {
            const reason = yield* exited;
            if (yield* Deferred.isDone(stopped)) {
              return;
            }
            running = null;
            yield* setStatus({ error: reason, state: "error" });
            yield* Scope.close(scope, Exit.void);
          }),
          layerScope
        );

        const outcome = yield* probe(port).pipe(
          Effect.retry(Schedule.spaced("150 millis")),
          Effect.timeoutOption("30 seconds"),
          Effect.map((ready) =>
            ready._tag === "Some" ? ("ready" as const) : ("timeout" as const)
          ),
          // The retry never gives up on its own; the timeout is the only way out.
          Effect.orElseSucceed(() => "timeout" as const),
          Effect.raceFirst(Effect.as(exited, "exited" as const))
        );
        if (outcome === "exited") {
          return yield* SubscriptionRef.get(status);
        }
        if (outcome === "timeout") {
          return yield* setStatus({
            error: "vite did not start listening within 30 s",
            pid: Number(handle.pid),
            state: "error",
          });
        }
        return yield* setStatus({
          pid: Number(handle.pid),
          port,
          state: "running",
          url: `http://127.0.0.1:${port}`,
        });
      }).pipe(
        Effect.catch((error: string) => setStatus({ error, state: "error" }))
      );

      // A request that goes away mid-start must not leave the host half started: the work is
      // forked into the layer scope and the caller only waits for it.
      const detached = <A>(effect: Effect.Effect<A>) =>
        Effect.flatMap(Effect.forkIn(effect, layerScope), Fiber.join);

      const start = detached(
        lifecycle.withPermits(1)(
          Effect.suspend(() => (running ? SubscriptionRef.get(status) : launch))
        )
      ).pipe(Effect.withSpan("HostManager.start"));

      const stop = detached(
        lifecycle.withPermits(1)(
          Effect.gen(function* () {
            const current = running;
            if (!current) {
              return yield* SubscriptionRef.get(status);
            }
            running = null;
            yield* Scope.close(current.scope, Exit.void);
            return yield* setStatus({ state: "stopped" });
          })
        )
      ).pipe(Effect.withSpan("HostManager.stop"));

      return HostManager.of({
        changes: SubscriptionRef.changes(status),
        start,
        status: SubscriptionRef.get(status),
        stop,
      });
    })
  );
}
