/**
 * The open project's server when the project is on another machine (PLAN-desktop D12): a
 * connection, the server started there or attached to, and its port forwarded here, as one
 * `RunningServer` the window loads the editor from. The preview's port is forwarded when the
 * editor first asks for it (`mapPreviewUrl`), and again when it moves. `ssh-server.ts` makes
 * each part; this keeps them together for as long as the project is open.
 */
import { Context, Effect, Layer, type Scope, Semaphore } from "effect";
import { ServerStartError } from "./errors.ts";
import {
  type Forwards,
  forwardOf,
  movePreview,
  remotePortOf,
  throughForward,
} from "./forwards.ts";
import { agentsWorking, type RunningServer } from "./project-server.ts";
import type { SshProject } from "./projects.ts";
import { RemoteServers } from "./ssh-server.ts";

/** How long the window may wait for a port to be forwarded before it gets the URL as it was. */
const FORWARD_TIMEOUT = "5 seconds";

export class RemoteProjects extends Context.Service<
  RemoteProjects,
  {
    /**
     * Connects to the project's machine and starts its server there, or attaches to the one
     * running; closing the scope stops what was started and closes the connection.
     */
    readonly start: (
      project: SshProject
    ) => Effect.Effect<RunningServer, ServerStartError, Scope.Scope>;
  }
>()("ultrapaint/desktop/RemoteProjects") {
  static readonly layer = Layer.effect(
    RemoteProjects,
    Effect.gen(function* () {
      const remote = yield* RemoteServers;

      const start = Effect.fn("RemoteProjects.start")(
        function* (project: SshProject) {
          const connection = yield* remote.connect(project);
          const server = yield* remote.start(connection, project);
          let forwards: Forwards = {
            server: {
              local: Number(new URL(server.url).port),
              remoteHost: new URL(server.ready.url).hostname,
              remotePort: server.ready.port,
            },
          };
          // One forward at a time: the editor asks for the same preview from several places.
          const forwarding = yield* Semaphore.make(1);

          const mapPreviewUrl = (url: string) =>
            forwarding.withPermits(1)(
              Effect.gen(function* () {
                const port = remotePortOf(url);
                if (port === undefined) {
                  // Not on the remote machine's loopback: reached as it is.
                  return { forwarded: true, url };
                }
                const known = forwardOf(forwards, port);
                if (known) {
                  return { forwarded: true, url: throughForward(url, known) };
                }
                const remoteHost = new URL(url).hostname;
                const local = yield* connection.forward(remoteHost, port);
                const moved = movePreview(forwards, {
                  local,
                  remoteHost,
                  remotePort: port,
                });
                forwards = moved.next;
                yield* Effect.forEach(moved.cancel, connection.cancel, {
                  discard: true,
                });
                return {
                  forwarded: true,
                  url: throughForward(url, {
                    local,
                    remoteHost,
                    remotePort: port,
                  }),
                };
              }).pipe(
                Effect.timeout(FORWARD_TIMEOUT),
                Effect.orElseSucceed(() => ({ forwarded: false, url }))
              )
            );

          return {
            attached: server.ready.attached === true,
            mapPreviewUrl,
            token: server.ready.token,
            url: server.url,
            working: agentsWorking(server.url, server.ready.token),
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
