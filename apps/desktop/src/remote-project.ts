/**
 * The open project's server when the project is on another machine (PLAN-desktop D12): a
 * connection, the server started there or attached to, and its port forwarded here, as one
 * `RunningServer` the window loads the editor from. `ssh-server.ts` makes each part; this keeps
 * them together for as long as the project is open.
 */
import { Context, Effect, Layer, type Scope } from "effect";
import { ServerStartError } from "./errors.ts";
import { agentsWorking, type RunningServer } from "./project-server.ts";
import type { SshProject } from "./projects.ts";
import { RemoteServers } from "./ssh-server.ts";

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
          return {
            attached: server.ready.attached === true,
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
