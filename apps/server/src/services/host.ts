import { createServer } from "node:net";
import { PREVIEW_BASE } from "@ultrapaint/contracts/preview";
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
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { AppLog } from "../app-log.ts";
import { makeWriteAtomic } from "../atomic-write.ts";
import { connectHost, ServerConfig } from "../config.ts";
import { PreviewProxy } from "../preview-proxy.ts";
import {
  ComponentRegistry,
  LEGACY_PREVIEW_DIR,
  previewDirOf,
} from "./component-registry.ts";
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

/** Why the preview could not be started; the editor shows the message on the host status. */
export class HostStartError extends Schema.TaggedError<HostStartError>()(
  "HostStartError",
  { message: Schema.String }
) {}

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
  }
>()("ultrapaint/server/HostManager") {
  static readonly layer = Layer.effect(
    HostManager,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const { host, machine } = yield* ServerConfig;
      const framework = yield* ProjectFramework;
      const styleSystem = yield* ProjectStyleSystem;
      const registry = yield* ComponentRegistry;
      const proxy = yield* PreviewProxy;
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
        Effect.as(
          Effect.andThen(
            SubscriptionRef.set(status, next),
            proxy.setTarget(
              next.state === "running" ? (next.port ?? null) : null
            )
          ),
          next
        );
      // The project closing stops the preview: the editor's server forwards to nothing then.
      yield* Effect.addFinalizer(() => proxy.setTarget(null));

      /**
       * The directory the preview was generated into inside the designs directory before ADR
       * 0034, with its dependency cache: removed when it is ours, which its `.gitignore` of one
       * `*` says.
       */
      const removeLegacy = Effect.gen(function* () {
        const legacy = path.join(paths.designsDir, LEGACY_PREVIEW_DIR);
        const ignore = yield* fs
          .readFileString(path.join(legacy, ".gitignore"))
          .pipe(Effect.orElseSucceed(() => ""));
        if (ignore === "*\n") {
          yield* fs.remove(legacy, { recursive: true });
          yield* log.log(
            "host",
            "info",
            `removed ${legacy}: the preview is generated outside the repository now`
          );
        }
      }).pipe(Effect.ignore);

      const generate = Effect.gen(function* () {
        yield* removeLegacy;
        const dir = previewDirOf(machine.home, paths.designsDir, path.join);
        const components = yield* registry.current;
        const generated = yield* Effect.tryPromise(() =>
          framework.preview.generate({
            anchorDir: paths.anchorDir,
            base: PREVIEW_BASE,
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
            (e) =>
              new HostStartError({
                message: `the preview could not be prepared: ${String(e.cause)}`,
              })
          )
        );
        yield* Effect.mapError(
          Effect.gen(function* () {
            yield* fs.makeDirectory(dir, { recursive: true });
            for (const [name, content] of Object.entries(generated.files)) {
              yield* writeAtomic(path.join(dir, name), content);
            }
            // The directory is ours: a file an older version generated must not linger.
            const keep = new Set(Object.keys(generated.files));
            for (const name of yield* fs.readDirectory(dir)) {
              const file = path.join(dir, name);
              if (!keep.has(name) && (yield* fs.stat(file)).type === "File") {
                yield* fs.remove(file);
              }
            }
          }),
          (error) =>
            new HostStartError({
              message: `the preview could not be written: ${error.message}`,
            })
        );
        return generated;
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

      /** A start that did not get the preview running ends what it started. */
      const abandon = Effect.suspend(() => {
        const current = running;
        running = null;
        return current ? Scope.close(current.scope, Exit.void) : Effect.void;
      });

      const launch = Effect.gen(function* () {
        lastError = "";
        yield* setStatus({ state: "starting" });
        const { entry, serve } = yield* generate;
        const port = yield* freePort(host).pipe(
          Effect.mapError(
            (error) =>
              new HostStartError({
                message: `no port is free for the preview: ${error.message}`,
              })
          )
        );
        const url = `http://${connectHost(host)}:${port}${PREVIEW_BASE.slice(0, -1)}`;

        const scope = yield* Scope.fork(layerScope);
        const stopped = yield* Deferred.make<void>();
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(
              machine.node,
              [serve.script, ...serve.args, String(port), host],
              {
                cwd: paths.anchorDir,
                // `pnpm` puts its own store on NODE_PATH; the preview must only see what the
                // target repository can resolve, never this tool's dependencies.
                // React's production build draws the frames (ADR 0034): an edit takes half the
                // time. The dev server still serves the modules as they change; a component
                // changed is drawn again from the registry rather than refreshed in place.
                env: {
                  FORCE_COLOR: "0",
                  NODE_ENV: "production",
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
            Effect.mapError(
              (e) =>
                new HostStartError({
                  message: `vite could not be started: ${e.message}`,
                })
            ),
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
          yield* abandon;
          return yield* setStatus({ error: yield* exited, state: "error" });
        }
        if (outcome === "timeout") {
          // Stopped, so that the next start starts it again rather than find it running.
          yield* abandon;
          return yield* setStatus({
            error: "vite did not start listening within 30 s",
            state: "error",
          });
        }
        return yield* setStatus({
          entry,
          pid: Number(handle.pid),
          port,
          state: "running",
          url,
        });
      }).pipe(
        Effect.catchTag("HostStartError", (error) =>
          Effect.andThen(
            abandon,
            setStatus({ error: error.message, state: "error" })
          )
        ),
        // A bug of ours must not leave the preview "starting" for good either.
        Effect.catchDefect((defect) =>
          Effect.gen(function* () {
            const message =
              defect instanceof Error ? defect.message : String(defect);
            yield* log.log("host", "error", `the preview broke: ${message}`);
            yield* abandon;
            return yield* setStatus({
              error: `the preview could not be started: ${message}`,
              state: "error",
            });
          })
        )
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

      return HostManager.of({
        changes: SubscriptionRef.changes(status),
        start,
        status: SubscriptionRef.get(status),
      });
    })
  );
}
