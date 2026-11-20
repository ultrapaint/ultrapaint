/**
 * The server of the open project (PLAN-desktop D4): the same server the `ultrapaint` command
 * runs, started with Electron's own binary as Node (`ELECTRON_RUN_AS_NODE`), on a port the system
 * picks on loopback, and read from its ready line. It lives in the scope it was started in:
 * closing the scope stops it, through the handle that spawned it. A project whose server runs
 * already (D5) is found by the server itself, from the run file, which says so in its ready line
 * and exits: that server is attached to, and the scope holds nothing to stop.
 */
import {
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { APP_ORIGIN } from "./app-editor.ts";
import { ServerStartError } from "./errors.ts";
import { OpeningReport } from "./opening-report.ts";
import { watchReadyLine } from "./ready-line.ts";

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
  /**
   * The folder the person's folder (`.ultrapaint`) is in, the app's setting (ADR 0091): given as
   * `--user-dir`, so that every project's server and the app read the same one.
   */
  readonly userDirIn: string;
}

/** A server that answers for the project. */
export interface RunningServer {
  /**
   * How many agents are at work in it now, and how many wait on the person, as its health check
   * says; none when it does not answer, or another server answers in its place.
   */
  readonly agents: Effect.Effect<Option.Option<AgentCounts>>;
  /**
   * The server was running already, started by the `ultrapaint` command or another app (D5):
   * it is attached to, and not the app's to stop.
   */
  readonly attached: boolean;
  /**
   * Whether the process the app started for it has exited: the one sign it is gone, as a slow
   * or silent health check is not. Never for a server attached to, nor over SSH, which
   * reconnects by itself.
   */
  readonly exited: Effect.Effect<boolean>;
  readonly token: string;
  readonly url: string;
  /**
   * The version of `ultrapaint` it runs, as its health check says; none when it does not answer
   * or does not say. The app's own editor talks only to a server of the app's version (ADR 0100).
   */
  readonly version: Effect.Effect<string | undefined>;
}

/**
 * The agents of a server: at work and waiting on the person (a question, a permission) now, and
 * the turns that finished and failed since it started. A cancelled turn is counted apart by the
 * server, and is no one's news.
 */
export interface AgentCounts {
  readonly failed: number;
  readonly finished: number;
  readonly waiting: number;
  readonly working: number;
}

/** What a server that does not say is taken to have: no agents at all. */
export const NO_AGENTS: AgentCounts = {
  failed: 0,
  finished: 0,
  waiting: 0,
  working: 0,
};

/** What a server said of its agents, or none when it did not answer. */
export const countsOr = (said: Option.Option<AgentCounts>): AgentCounts =>
  Option.getOrElse(said, () => NO_AGENTS);

const Health = Schema.fromJsonString(
  Schema.Struct({
    failed: Schema.optional(Schema.Number),
    finished: Schema.optional(Schema.Number),
    token: Schema.optional(Schema.String),
    version: Schema.optional(Schema.String),
    waiting: Schema.optional(Schema.Number),
    working: Schema.optional(Schema.Number),
  })
);
const decodeHealth = Schema.decodeUnknownEffect(Health);

/** The health check of the server at `url`; none when it does not answer, or not as one. */
const healthOf = (url: string) =>
  Effect.tryPromise({
    catch: () => "no answer" as const,
    try: (signal) =>
      fetch(`${url}/api/health`, { signal }).then((response) =>
        response.ok ? response.text() : ""
      ),
  }).pipe(
    Effect.timeout("3 seconds"),
    Effect.flatMap(decodeHealth),
    // A server that does not answer, or not as a health check, says nothing: no version, no
    // agents at work, as callers read it.
    Effect.option
  );

/** The version the server at `url` runs; none when it does not say. */
export const serverVersion = (url: string) =>
  Effect.map(healthOf(url), (health) =>
    Option.isSome(health) ? health.value.version : undefined
  );

/**
 * The agents at work and waiting in the server at `url`, if it is the run with `token`; none when
 * it does not answer, or another run does.
 */
export const agentsOf = (url: string, token: string) =>
  Effect.map(healthOf(url), (health) =>
    Option.flatMap(health, (h) =>
      h.token === token
        ? Option.some<AgentCounts>({
            failed: h.failed ?? 0,
            finished: h.finished ?? 0,
            waiting: h.waiting ?? 0,
            working: h.working ?? 0,
          })
        : Option.none()
    )
  );

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
                  "--user-dir",
                  options.userDirIn,
                  // Its stdin is a pipe from this process, which no one writes: when the app
                  // goes, however it goes, the pipe closes and the server stops.
                  "--stop-with-stdin",
                  // The app's own editor talks to it from the app's origin (ADR 0100).
                  "--allowed-origin",
                  APP_ORIGIN,
                ],
                {
                  cwd: options.cwd,
                  env: serverEnv(process.env, options.env),
                  extendEnv: false,
                  // Long enough for the server to stop its agents.
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
          // And each to the open under way, which shows the last one (ADR 0099).
          const report = yield* OpeningReport;
          const logs = yield* handle.stderr.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach((line) =>
              Effect.andThen(
                Effect.sync(() => {
                  said.push(line);
                  if (said.length > 50) {
                    said.shift();
                  }
                  process.stderr.write(`[server] ${line}\n`);
                }),
                report.line(line)
              )
            ),
            Effect.ignore,
            Effect.forkScoped
          );
          const ready = yield* watchReadyLine(handle.stdout).pipe(
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
          const attached = ready.attached === true;
          return {
            agents: agentsOf(ready.url, ready.token),
            attached,
            exited: attached
              ? Effect.succeed(false)
              : handle.isRunning.pipe(
                  Effect.map((running) => !running),
                  // Unknown is not gone: the editor is loaded again rather than the server stopped.
                  Effect.orElseSucceed(() => false)
                ),
            token: ready.token,
            url: ready.url,
            version: serverVersion(ready.url),
          } satisfies RunningServer;
        });

        return ProjectServer.of({ start });
      })
    );
}
