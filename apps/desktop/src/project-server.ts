/**
 * The server of the open project (PLAN-desktop D4): the same server the `ultrapaint` command
 * runs, started with Electron's own binary as Node (`ELECTRON_RUN_AS_NODE`), on a port the system
 * picks on loopback, and read from its ready line. It lives in the scope it was started in:
 * closing the scope stops it, through the handle that spawned it.
 */
import { Context, Effect, Fiber, Layer, type Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { ServerStartError } from "./errors.ts";
import { firstReadyLine } from "./ready-line.ts";

/** How the server is started: the executable, and what comes before the server's own flags. */
export interface ServerLaunch {
  readonly args: readonly string[];
  readonly command: string;
  /** The editor's build, which the server serves. */
  readonly webDist: string;
}

export interface ServerOptions {
  /** The project's folder: the server finds its configuration from there. */
  readonly cwd: string;
  /** Variables for the server on top of the app's own: the login shell's `PATH`, and the like. */
  readonly env: Readonly<Record<string, string>>;
  /**
   * Where a folder without a configuration keeps its unsaved session, so that it survives a
   * restart of the app. The app's to remove, with the project.
   */
  readonly sessionDir: string;
}

/** A server that answers for the project. */
export interface RunningServer {
  readonly token: string;
  readonly url: string;
}

/** How long a server may take to say it listens: a cold start compiles the server's sources. */
const READY_TIMEOUT = "90 seconds";

/** Variables the server reads its flags from: the app passes flags, never these. */
const SERVER_ENV_RE = /^ULTRAPAINT_/;

/**
 * The server's environment: the app's own without what would change the server's mind about
 * where it is or how it stores (the app gives those as flags), with `extra` over it, and
 * Electron's binary told to run as Node.
 */
export const serverEnv = (
  inherited: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>>
): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(inherited).flatMap(([name, value]) =>
      value === undefined || SERVER_ENV_RE.test(name) ? [] : [[name, value]]
    )
  ),
  ...extra,
  ELECTRON_RUN_AS_NODE: "1",
});

/** The last lines the server wrote on stderr, which say why it stopped when it does. */
const tail = (lines: readonly string[]) => lines.slice(-5).join("\n");

export class ProjectServer extends Context.Service<
  ProjectServer,
  {
    /** Starts the project's server, which stops when the scope closes. */
    readonly start: (
      options: ServerOptions
    ) => Effect.Effect<RunningServer, ServerStartError, Scope.Scope>;
  }
>()("ultrapaint/desktop/ProjectServer") {
  static readonly layer = (launch: ServerLaunch) =>
    Layer.effect(
      ProjectServer,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

        const start = Effect.fn("ProjectServer.start")(function* (
          options: ServerOptions
        ) {
          const handle = yield* spawner
            .spawn(
              ChildProcess.make(
                launch.command,
                [
                  ...launch.args,
                  "--host",
                  "127.0.0.1",
                  "--port",
                  "0",
                  "--ready-json",
                  "--web-dist",
                  launch.webDist,
                  "--session-dir",
                  options.sessionDir,
                  // Its stdin is a pipe from this process, which no one writes: when the app
                  // goes, however it goes, the pipe closes and the server stops.
                  "--stop-with-stdin",
                ],
                {
                  cwd: options.cwd,
                  env: serverEnv(process.env, options.env),
                  extendEnv: false,
                  // Long enough for the server to stop its agents and the preview.
                  forceKillAfter: "10 seconds",
                  stdin: "pipe",
                }
              )
            )
            .pipe(
              Effect.mapError(
                (error) =>
                  new ServerStartError({
                    message: `the server could not be started: ${error.message}`,
                  })
              )
            );
          // Its logs, for whoever started the app from a terminal, and the last of them for an
          // error that needs a reason.
          const said: string[] = [];
          const logs = yield* handle.stderr.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach((line) =>
              Effect.sync(() => {
                said.push(line);
                if (said.length > 50) {
                  said.shift();
                }
                process.stderr.write(`[server] ${line}\n`);
              })
            ),
            Effect.ignore,
            Effect.forkScoped
          );
          const ready = yield* firstReadyLine(handle.stdout).pipe(
            Effect.timeoutOrElse({
              duration: READY_TIMEOUT,
              orElse: () =>
                Effect.fail(
                  new ServerStartError({
                    message: `the server did not say where it listens within ${READY_TIMEOUT}`,
                  })
                ),
            }),
            Effect.catch((error) =>
              // What it said last, once it has said it, is why.
              Fiber.join(logs).pipe(
                Effect.timeout("1 second"),
                Effect.ignore,
                Effect.andThen(
                  Effect.fail(
                    new ServerStartError({
                      message:
                        said.length > 0
                          ? `${error.message}:\n${tail(said)}`
                          : error.message,
                    })
                  )
                )
              )
            )
          );
          return { token: ready.token, url: ready.url } satisfies RunningServer;
        });

        return ProjectServer.of({ start });
      })
    );
}
