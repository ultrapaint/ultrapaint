/**
 * The open project's server when the project is on another machine (PLAN-desktop D12): a
 * connection, the server started there or attached to, and its port forwarded here, as one
 * `RunningServer` the window loads the editor from: the server's port is the one port forwarded.
 * `ssh-server.ts` makes each part;
 * this keeps them together for as long as the project is open.
 *
 * A connection that drops, or a server that stops, is made again: with a growing wait between
 * attempts, the window saying so meanwhile, and the port forwarded on the port it had, so
 * that the editor's socket finds its server again where it was. The server is started again if
 * it died, or attached to if it still runs; the window loads the editor again only when it is
 * another server, or another port.
 */

import type { ShellStatus } from "@ultrapaint/contracts/shell-bridge";
import { Context, Duration, Effect, Exit, Layer, Result, Scope } from "effect";
import { ServerStartError } from "./errors.ts";
import { agentsWorking, type RunningServer } from "./project-server.ts";
import type { SshProject } from "./projects.ts";
import type { SshError } from "./ssh.ts";
import {
  answers,
  type Connection,
  type RemoteServer,
  RemoteServers,
} from "./ssh-server.ts";

/** How often a server the app attached to is asked whether it still answers. */
const HEALTH_EVERY = "5 seconds";
/** How many unanswered asks in a row mean it stopped. */
const HEALTH_MISSES = 3;
/** The longest wait between two attempts to reconnect. */
const MAX_DELAY_SECONDS = 30;

/**
 * The wait before the next attempt, after `attempt` failed: 1, 2, 4… seconds up to half a
 * minute. A failure that waiting will not mend (a key refused, the command missing) waits the
 * longest: it is tried again for when the user mended it.
 */
export const reconnectDelay = (attempt: number, retryable: boolean) =>
  Duration.seconds(
    retryable
      ? Math.min(MAX_DELAY_SECONDS, 2 ** Math.max(0, attempt - 1))
      : MAX_DELAY_SECONDS
  );

/** What the remote project's server tells the app as it goes. */
export interface RemoteHooks {
  /** The editor is elsewhere now: at another port, or another server's. Load it there. */
  readonly moved: (url: string) => Effect.Effect<void>;
  /** What to show while it reconnects; `null` once it is back. */
  readonly status: (status: ShellStatus | null) => Effect.Effect<void>;
}

/** One connection and the server on it, in a scope of their own. */
interface Live {
  readonly connection: Connection;
  readonly scope: Scope.Closeable;
  readonly server: RemoteServer;
}

/** The port here the server is forwarded to. */
const localPortOf = (server: RemoteServer) => Number(new URL(server.url).port);

export class RemoteProjects extends Context.Service<
  RemoteProjects,
  {
    /**
     * Connects to the project's machine and starts its server there, or attaches to the one
     * running, and keeps it reachable until the scope closes: then what the app started stops
     * and the connection closes.
     */
    readonly start: (
      project: SshProject,
      hooks: RemoteHooks
    ) => Effect.Effect<RunningServer, ServerStartError, Scope.Scope>;
  }
>()("ultrapaint/desktop/RemoteProjects") {
  static readonly layer = Layer.effect(
    RemoteProjects,
    Effect.gen(function* () {
      const remote = yield* RemoteServers;

      const start = Effect.fn("RemoteProjects.start")(
        function* (project: SshProject, hooks: RemoteHooks) {
          /** A connection and the server on it, its port on the one it had when free. */
          const open = (preferred?: number) =>
            Effect.gen(function* () {
              const scope = yield* Scope.make();
              return yield* Effect.gen(function* () {
                const connection = yield* remote.connect(project);
                const server = yield* remote.start(
                  connection,
                  project,
                  preferred
                );
                return { connection, scope, server } satisfies Live;
              }).pipe(
                Scope.provide(scope),
                Effect.onError(() => Scope.close(scope, Exit.void))
              );
            });

          let live = yield* open();
          let local = localPortOf(live.server);
          // Whether the server is the app's to stop: it started it, here or before a drop.
          let owned = live.server.ready.attached !== true;
          // The app's own server, attached to again after a drop: no session holds its stdin.
          let adopted = false;

          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              const was = live;
              if (owned && adopted) {
                yield* remote.stop(was.connection, was.server);
              }
              yield* Scope.close(was.scope, Exit.void);
            })
          );

          /** Completes, with why, when the server can no longer be reached. */
          const lost = (current: Live) =>
            Effect.raceAll([
              current.connection.closed,
              current.server.stopped,
              // A server the app attached to has no session of its own to end: it is asked.
              current.server.ready.attached
                ? Effect.gen(function* () {
                    let misses = 0;
                    while (misses < HEALTH_MISSES) {
                      yield* Effect.sleep(HEALTH_EVERY);
                      misses = (yield* answers(
                        current.server.url,
                        current.server.ready.token
                      ))
                        ? 0
                        : misses + 1;
                    }
                    return `the server on ${project.host} stopped answering`;
                  })
                : Effect.never,
            ]);

          /** Tries until a connection and a server are back; says so meanwhile. */
          const reconnect = (reason: string) =>
            Effect.gen(function* () {
              yield* hooks.status({
                detail: reason,
                message: `Reconnecting to ${project.host}…`,
              });
              for (let attempt = 1; ; attempt += 1) {
                const result = yield* Effect.result(open(local));
                if (Result.isSuccess(result)) {
                  return result.success;
                }
                const error: SshError = result.failure;
                const delay = reconnectDelay(attempt, error.retryable);
                yield* hooks.status({
                  detail: `${error.message}\nTrying again in ${Duration.toSeconds(delay)} s.`,
                  message: error.retryable
                    ? `Reconnecting to ${project.host}…`
                    : `Cannot reconnect to ${project.host}`,
                });
                yield* Effect.sleep(delay);
              }
            });

          /** Takes the new connection on; true when the editor moved. */
          const takeOn = (next: Live) => {
            const { ready } = next.server;
            const same = ready.token === live.server.ready.token;
            if (ready.attached !== true) {
              owned = true;
              adopted = false;
            } else if (same) {
              adopted = owned;
            } else {
              // Someone else's server took the project's place meanwhile.
              owned = false;
              adopted = false;
            }
            const after = localPortOf(next.server);
            const moved = !same || after !== local;
            live = next;
            local = after;
            return moved;
          };

          yield* Effect.forkScoped(
            Effect.forever(
              Effect.gen(function* () {
                const reason = yield* lost(live);
                yield* Scope.close(live.scope, Exit.void);
                const next = yield* reconnect(reason);
                const moved = takeOn(next);
                yield* hooks.status(null);
                if (moved) {
                  yield* hooks.moved(next.server.url);
                }
              })
            )
          );

          return {
            get attached() {
              return !owned;
            },
            get token() {
              return live.server.ready.token;
            },
            get url() {
              return live.server.url;
            },
            working: Effect.suspend(() =>
              agentsWorking(live.server.url, live.server.ready.token)
            ),
          } satisfies RunningServer;
        },
        Effect.mapError(
          (error) => new ServerStartError({ message: error.message })
        )
      );

      return RemoteProjects.of({ start });
    })
  );
}
