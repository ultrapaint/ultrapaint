/**
 * A project's server on another machine (PLAN-desktop D12), through the system's `ssh`: one
 * connection per open project (`ssh.ts` says how it is made), the server started in the
 * project's folder there by the user's login shell, and its port forwarded to loopback here,
 * where the window loads the editor. Everything lives in the scope it was started in: closing it
 * ends the server's session, whose stdin closing stops the server (unless it was running already,
 * and is not the app's), then the connection, then its socket's directory.
 */
import { createServer } from "node:net";
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { LoginShell } from "./login-shell.ts";
import type { SshProject } from "./projects.ts";
import { DEFAULT_REMOTE_COMMAND } from "./projects.ts";
import { type ReadyLine, watchReadyLine } from "./ready-line.ts";
import {
  type Forward,
  forwardArgs,
  lastLines,
  loginShellCommand,
  masterArgs,
  remoteSessionDir,
  SshError,
  type SshTarget,
  serverScript,
  sessionArgs,
  sshEnv,
  sshFailure,
} from "./ssh.ts";

/** How `ssh` is run: the executable, and a configuration in place of the user's, for tests. */
interface SshLaunch {
  readonly configFile?: string | undefined;
  /**
   * Where unsaved sessions are kept on the remote machine, one directory per project:
   * `~/.ultrapaint/desktop-sessions` unless tests say otherwise.
   */
  readonly sessionsDir?: string | undefined;
  readonly ssh: string;
}

/** How long the connection may take: `ConnectTimeout` and then the authentication. */
const CONNECT_TIMEOUT = "40 seconds";
/** How long the server may take to say where it listens: a cold start, over a slow link. */
const READY_TIMEOUT = "2 minutes";

/** A free port on loopback here: `preferred` when it is free, any other otherwise. */
const freeLocalPort = (preferred?: number) =>
  Effect.callback<number, Error>((resume) => {
    const tryPort = (port: number) => {
      const server = createServer();
      server.once("error", (error) =>
        port === 0 ? resume(Effect.fail(error)) : tryPort(0)
      );
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const got = typeof address === "object" && address ? address.port : 0;
        server.close(() => resume(Effect.succeed(got)));
      });
    };
    tryPort(preferred ?? 0);
  });

/** One connection to the remote machine, as long as its scope lasts. */
export interface Connection {
  /** Completes, with why, when the connection is gone. */
  readonly closed: Effect.Effect<string>;
  /**
   * Forwards a port of the remote machine to loopback here, on `preferred` when it is free:
   * the local port.
   */
  readonly forward: (
    remoteHost: string,
    remotePort: number,
    preferred?: number
  ) => Effect.Effect<number, SshError>;
  /** Runs a command on the remote machine, through its login shell; its handle. */
  readonly session: (
    script: string
  ) => Effect.Effect<
    ChildProcessSpawner.ChildProcessHandle,
    SshError,
    Scope.Scope
  >;
  readonly target: SshTarget;
}

/** A server on the remote machine, reached through a port forwarded here. */
export interface RemoteServer {
  readonly connection: Connection;
  /** The server's own ready line, as it gave it on the remote machine. */
  readonly ready: ReadyLine;
  /**
   * Completes, with why, when the server stopped while the connection stays: its session
   * ended. Never, for a server the app attached to, whose session ends at once.
   */
  readonly stopped: Effect.Effect<string>;
  /** Where the editor is here: the forwarded port on loopback. */
  readonly url: string;
}

const Health = Schema.fromJsonString(
  Schema.Struct({ token: Schema.optional(Schema.String) })
);
const decodeHealth = Schema.decodeUnknownEffect(Health);

/** Whether the server at `url` answers as the run with `token`. */
export const answers = (url: string, token: string) =>
  Effect.tryPromise({
    catch: () => "no answer" as const,
    try: (signal) =>
      fetch(`${url}/api/health`, { signal }).then((response) =>
        response.ok ? response.text() : ""
      ),
  }).pipe(
    Effect.timeout("3 seconds"),
    Effect.flatMap(decodeHealth),
    Effect.map((health) => health.token === token),
    Effect.orElseSucceed(() => false)
  );

/** Lines of output kept for a message: the last ones say why. */
const keepLines = (kept: string[], line: string, limit = 50) => {
  kept.push(line);
  if (kept.length > limit) {
    kept.shift();
  }
};

export class RemoteServers extends Context.Service<
  RemoteServers,
  {
    /** Opens a connection to the project's machine, closed with the scope. */
    readonly connect: (
      project: SshProject
    ) => Effect.Effect<Connection, SshError, Scope.Scope>;
    /**
     * Stops a server the app started over a connection that has since dropped, and attached to
     * again: no session holds its stdin any more. By the pid it gave in its ready line, once its
     * port still answers with its token: the pid is that run's.
     */
    readonly stop: (
      connection: Connection,
      server: RemoteServer
    ) => Effect.Effect<void>;
    /**
     * Starts the project's server on the connection, or attaches to the one running there,
     * and forwards its port, on `preferred` when it is free.
     */
    readonly start: (
      connection: Connection,
      project: SshProject,
      preferred?: number
    ) => Effect.Effect<RemoteServer, SshError, Scope.Scope>;
  }
>()("ultrapaint/desktop/RemoteServers") {
  static readonly layer = (launch: SshLaunch) =>
    Layer.effect(
      RemoteServers,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        // The login shell's PATH finds `ssh`, and its SSH_AUTH_SOCK the agent.
        const { env: login } = yield* LoginShell;
        const env = sshEnv(process.env, login);

        const spawnSsh = (
          args: readonly string[],
          options: { readonly stdin: "pipe" | "ignore" }
        ) =>
          spawner
            .spawn(
              ChildProcess.make(launch.ssh, args, {
                env,
                extendEnv: false,
                forceKillAfter: "5 seconds",
                stdin: options.stdin,
              })
            )
            .pipe(
              Effect.mapError(
                (error) =>
                  new SshError({
                    message: `ssh could not be run: ${error.message}`,
                    retryable: false,
                  })
              )
            );

        /** Runs `ssh` to completion: its exit code and what it said. */
        const runSsh = (args: readonly string[]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawnSsh(args, { stdin: "ignore" });
              const [stderr, exitCode] = yield* Effect.all(
                [
                  Stream.mkString(Stream.decodeText(handle.stderr)),
                  handle.exitCode,
                  Stream.runDrain(handle.stdout),
                ],
                { concurrency: "unbounded" }
              );
              return { exitCode: Number(exitCode), stderr };
            })
          ).pipe(
            Effect.timeout("10 seconds"),
            Effect.mapError(
              (error) =>
                new SshError({
                  message:
                    error._tag === "SshError"
                      ? error.message
                      : `ssh did not answer: ${error.message}`,
                  retryable: true,
                })
            )
          );

        const connect = Effect.fn("RemoteServers.connect")(function* (
          project: SshProject
        ) {
          const target: SshTarget = {
            configFile: launch.configFile,
            host: project.host,
            port: project.port,
          };
          // The socket's directory is this user's alone (mkdtemp makes it 0700).
          const dir = yield* fs
            .makeTempDirectoryScoped({ prefix: "ultrapaint-ssh-" })
            .pipe(
              Effect.mapError(
                (error) =>
                  new SshError({
                    message: `no directory for the connection's socket: ${error.message}`,
                    retryable: false,
                  })
              )
            );
          const socket = path.join(dir, "s");
          // Its stdin is a pipe no one writes: when the app goes, it closes, and so does this.
          const master = yield* spawnSsh(masterArgs(target, socket), {
            stdin: "pipe",
          });
          const said: string[] = [];
          yield* master.stderr.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach((line) =>
              Effect.sync(() => {
                keepLines(said, line);
                process.stderr.write(`[ssh ${project.host}] ${line}\n`);
              })
            ),
            Effect.ignore,
            Effect.forkScoped
          );
          const closed = yield* Deferred.make<string>();
          const exited = yield* master.exitCode.pipe(
            Effect.map(Number),
            Effect.orElseSucceed(() => 255),
            Effect.tap((code) =>
              Deferred.succeed(
                closed,
                lastLines(said.join("\n"), 3) ||
                  `the connection to ${project.host} closed (${code})`
              )
            ),
            Effect.forkScoped
          );
          // Ready once the socket is there; an exit first is why it is not.
          yield* Effect.raceFirst(
            waitFor(fs.exists(socket)),
            Fiber.join(exited).pipe(
              Effect.flatMap((exitCode) =>
                Effect.fail(
                  sshFailure({
                    command: "ssh",
                    exitCode,
                    host: project.host,
                    stderr: said.join("\n"),
                  })
                )
              )
            )
          ).pipe(
            Effect.timeoutOrElse({
              duration: CONNECT_TIMEOUT,
              orElse: () =>
                Effect.fail(
                  new SshError({
                    message: `${project.host} did not let the app in within ${CONNECT_TIMEOUT}`,
                    retryable: true,
                  })
                ),
            })
          );

          const forwardOnce = (forward: Forward) =>
            Effect.flatMap(
              runSsh(forwardArgs(target, socket, forward)),
              ({ exitCode, stderr }) =>
                exitCode === 0
                  ? Effect.succeed(forward.local)
                  : Effect.fail(
                      new SshError({
                        message: `port ${forward.remotePort} of ${project.host} could not be forwarded: ${lastLines(stderr, 2)}`,
                        retryable: true,
                      })
                    )
            );

          const connection: Connection = {
            closed: Deferred.await(closed),
            forward: (remoteHost, remotePort, preferred) =>
              Effect.gen(function* () {
                const local = yield* freeLocalPort(preferred).pipe(
                  Effect.mapError(
                    (error) =>
                      new SshError({
                        message: `no port is free here: ${error.message}`,
                        retryable: false,
                      })
                  )
                );
                // A port taken between the look and the forward: another one.
                return yield* forwardOnce({
                  local,
                  remoteHost,
                  remotePort,
                }).pipe(
                  Effect.catch(() =>
                    Effect.flatMap(Effect.orDie(freeLocalPort()), (other) =>
                      forwardOnce({ local: other, remoteHost, remotePort })
                    )
                  )
                );
              }),
            session: (script) =>
              spawnSsh(sessionArgs(target, socket, loginShellCommand(script)), {
                stdin: "pipe",
              }),
            target,
          };
          return connection;
        });

        const start = Effect.fn("RemoteServers.start")(function* (
          connection: Connection,
          project: SshProject,
          preferred?: number
        ) {
          const command = project.command?.trim() || DEFAULT_REMOTE_COMMAND;
          const session = yield* connection.session(
            serverScript({
              command,
              path: project.path,
              sessionDir: launch.sessionsDir
                ? `${launch.sessionsDir}/${project.id}`
                : remoteSessionDir(project.id),
            })
          );
          const said: string[] = [];
          const logs = yield* session.stderr.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach((line) =>
              Effect.sync(() => {
                keepLines(said, line);
                process.stderr.write(`[server ${project.host}] ${line}\n`);
              })
            ),
            Effect.ignore,
            Effect.forkScoped
          );
          const failure = Effect.gen(function* () {
            const exitCode = yield* session.exitCode.pipe(
              Effect.map(Number),
              Effect.timeout("5 seconds"),
              Effect.orElseSucceed(() => -1)
            );
            // What it said last, once it has said it, is why.
            yield* Fiber.join(logs).pipe(
              Effect.timeout("1 second"),
              Effect.ignore
            );
            return sshFailure({
              command,
              exitCode,
              host: project.host,
              path: project.path,
              stderr: said.join("\n"),
            });
          });
          const ready = yield* watchReadyLine(session.stdout).pipe(
            Effect.timeoutOrElse({
              duration: READY_TIMEOUT,
              orElse: () =>
                Effect.fail(
                  new SshError({
                    message: `the server on ${project.host} did not say where it listens within ${READY_TIMEOUT}`,
                    retryable: true,
                  })
                ),
            }),
            Effect.catchTag("ServerStartError", () =>
              Effect.flatMap(failure, Effect.fail)
            )
          );
          const remoteHost = new URL(ready.url).hostname;
          const local = yield* connection.forward(
            remoteHost,
            ready.port,
            preferred
          );
          const stopped = ready.attached
            ? Effect.never
            : session.exitCode.pipe(
                Effect.map(
                  (code) =>
                    `the server on ${project.host} stopped (${Number(code)})${
                      said.length > 0
                        ? `:\n${lastLines(said.join("\n"), 3)}`
                        : ""
                    }`
                ),
                Effect.orElseSucceed(
                  () => `the server on ${project.host} stopped`
                )
              );
          return {
            connection,
            ready,
            stopped,
            url: `http://127.0.0.1:${local}`,
          } satisfies RemoteServer;
        });

        const stop = (connection: Connection, server: RemoteServer) =>
          Effect.gen(function* () {
            if (!(yield* answers(server.url, server.ready.token))) {
              return;
            }
            yield* Effect.scoped(
              Effect.flatMap(
                connection.session(
                  `kill -TERM ${Math.trunc(server.ready.pid)}`
                ),
                (handle) => handle.exitCode
              )
            );
          }).pipe(Effect.timeout("10 seconds"), Effect.ignore);

        return RemoteServers.of({ connect, start, stop });
      })
    );
}

/** Polls `check` until it says yes. */
const waitFor = <E>(check: Effect.Effect<boolean, E>) =>
  Effect.gen(function* () {
    while (!(yield* Effect.orElseSucceed(check, () => false))) {
      yield* Effect.sleep("50 millis");
    }
  });
