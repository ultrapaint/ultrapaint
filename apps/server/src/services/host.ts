import { createServer } from "node:net";
import type { HostStatus } from "@ultrapaint/contracts/project";
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
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { AppLog } from "../app-log.ts";
import { makeWriteAtomic } from "../atomic-write.ts";
import { connectHost, ServerConfig } from "../config.ts";
import { ComponentRegistry, PREVIEW_DIR } from "./component-registry.ts";
import { ProjectFramework } from "./framework.ts";
import { RepoPaths } from "./repo-paths.ts";
import { ProjectStyleSystem } from "./style-system.ts";

const freePort = (host: string) =>
  Effect.callback<number, Error>((resume) => {
    const server = createServer();
    server.on("error", (error) => resume(Effect.fail(error)));
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resume(Effect.succeed(port)));
    });
  });

/** True once anything answers on the port; Vite replies before its first build finishes. */
const probe = (url: string) =>
  Effect.tryPromise(() => fetch(url, { method: "HEAD" })).pipe(
    Effect.filterOrFail((res) => res.status < 500),
    Effect.asVoid
  );

interface Running {
  readonly scope: Scope.Closeable;
}

/**
 * Runs the preview host: what the project's framework generates, served by the script it
 * names, run from the package the pages resolve their imports from. The child lives in its own scope, so stopping the
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
      const { host } = yield* ServerConfig;
      const framework = yield* ProjectFramework;
      const styleSystem = yield* ProjectStyleSystem;
      const registry = yield* ComponentRegistry;
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

      const generate = Effect.gen(function* () {
        const dir = path.join(paths.designsDir, PREVIEW_DIR);
        const components = yield* registry.current;
        const generated = yield* Effect.tryPromise(() =>
          framework.preview.generate({
            anchorDir: paths.anchorDir,
            components,
            designsDir: paths.designsDir,
            dir,
            root: paths.root,
            settings: paths.settings,
            styles: styleSystem.previewCss({
              anchorDir: paths.anchorDir,
              dir,
              root: paths.root,
              settings: paths.settings,
            }),
          })
        ).pipe(
          Effect.mapError(
            (e) => `the preview could not be prepared: ${String(e.cause)}`
          )
        );
        yield* Effect.orDie(
          Effect.gen(function* () {
            // Ignored before anything is written into it: a snapshot of the working tree taken
            // meanwhile must not see the files, nor their temporary copies come and go.
            const ignore = path.join(dir, ".gitignore");
            if (!(yield* exists(ignore))) {
              yield* writeAtomic(ignore, "*\n");
            }
            for (const [name, content] of Object.entries(generated.files)) {
              yield* writeAtomic(path.join(dir, name), content);
            }
            // The directory is ours: a file an older version generated must not linger.
            const keep = new Set([
              ...Object.keys(generated.files),
              ".gitignore",
            ]);
            for (const name of yield* fs.readDirectory(dir)) {
              const file = path.join(dir, name);
              if (!keep.has(name) && (yield* fs.stat(file)).type === "File") {
                yield* fs.remove(file);
              }
            }
          })
        );
        return generated.serve;
      });

      // The last thing the preview said on stderr: why it exited, when it exits.
      let lastError = "";
      const pipeOutput = (
        stream: Stream.Stream<Uint8Array, unknown>,
        level: "info" | "warn"
      ) =>
        stream.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) => {
            const text = chunk.trimEnd();
            if (level === "warn" && text !== "") {
              lastError = text;
            }
            return log.log("host", level, text);
          }),
          Effect.ignore
        );

      const launch = Effect.gen(function* () {
        lastError = "";
        yield* setStatus({ state: "starting" });
        const serve = yield* generate;
        const port = yield* Effect.orDie(freePort(host));
        const url = `http://${connectHost(host)}:${port}`;

        const scope = yield* Scope.fork(layerScope);
        const stopped = yield* Deferred.make<void>();
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(
              process.execPath,
              [serve.script, ...serve.args, String(port), host],
              {
                cwd: paths.anchorDir,
                // `pnpm` puts its own store on NODE_PATH; the preview must only see what the
                // target repository can resolve, never this tool's dependencies.
                env: {
                  FORCE_COLOR: "0",
                  NODE_ENV: "development",
                  NODE_PATH: "",
                },
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
          Effect.map((code) => `the preview exited (${code})`),
          Effect.orElseSucceed(() => "the preview exited"),
          // Its output is piped on another fiber; give the last lines a moment to arrive.
          Effect.tap(() => Effect.sleep("50 millis")),
          Effect.map((reason) =>
            lastError ? `${reason}: ${lastError}` : reason
          )
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

        const outcome = yield* probe(url).pipe(
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
          // The watcher above reports the same thing; whichever comes first, the caller must
          // not be told the preview is still starting.
          return yield* setStatus({ error: yield* exited, state: "error" });
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
          url,
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
