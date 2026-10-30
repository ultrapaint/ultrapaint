/**
 * Where an agent comes from. A launch names the agent, the repository it works in and the host
 * it works for; the launcher gives back an `AcpAgent` for as long as the scope, and closing the
 * scope stops it. It builds the editor's side of the launch itself (`agent-client.ts`): the
 * files and terminals the agent asks for, its terminals confined as the agent is. The live
 * launcher starts the agent's process confined by the sandbox and speaks ACP to it through the
 * SDK; a test gives an agent of its own, scripted in memory (`testing/scripted-agents.ts`).
 * Live sessions and discovery both ask here, and neither knows whether a process runs.
 */
import {
  type AcpAgent,
  refusingHandlers,
  spawnAcpAgent,
} from "@ultrapaint/acp/acp-agent";
import type { AcpSpawnError } from "@ultrapaint/acp/errors";
import type { AgentConfig } from "@ultrapaint/contracts/threads";
import { Context, Effect, FileSystem, Layer, type Scope } from "effect";
import { ServerConfig } from "../../config.ts";
import { type AgentHost, makeAgentClient } from "./agent-client.ts";
import { AgentSandbox } from "./agent-sandbox.ts";

/** One start of an agent. */
export interface AgentLaunchOptions {
  readonly config: AgentConfig;
  /**
   * The thread the agent works for. Without one the agent is only asked something (what its
   * sessions offer), and whatever it asks of the editor is refused.
   */
  readonly host: AgentHost | null;
  /** The agent's working directory, and the repository its sandbox confines it to. */
  readonly root: string;
  /**
   * The only temporary directory the agent may write to. Left out, one of its own, which goes
   * with the scope.
   */
  readonly tmpDir?: string | undefined;
  /**
   * The only part of the repository the agent may write, when not all of it: a design thread's
   * designs directory (ADR 0030).
   */
  readonly writable?: string | undefined;
}

/** What an agent without a thread is refused, whatever it asks. */
export const LISTING_ONLY = "the editor is only listing models";

export class AgentLauncher extends Context.Service<
  AgentLauncher,
  {
    /** The agent of this launch, until the scope closes. */
    readonly launch: (
      options: AgentLaunchOptions
    ) => Effect.Effect<AcpAgent, AcpSpawnError, Scope.Scope>;
  }
>()("ultrapaint/server/AgentLauncher") {
  /** The agent's own process, in the sandbox `AgentSandbox` makes for the session. */
  static readonly layer = Layer.effect(
    AgentLauncher,
    Effect.gen(function* () {
      const sandbox = yield* AgentSandbox;
      const fs = yield* FileSystem.FileSystem;
      const { version } = yield* ServerConfig;
      const client = yield* makeAgentClient();
      return AgentLauncher.of({
        launch: Effect.fn("AgentLauncher.launch")(function* (
          options: AgentLaunchOptions
        ) {
          const { config, host, root, writable } = options;
          const tmpDir =
            options.tmpDir ??
            (yield* Effect.orDie(
              fs.makeTempDirectoryScoped({ prefix: "ultrapaint-agent-" })
            ));
          const confined = yield* sandbox.session({
            config,
            root,
            tmpDir,
            writable,
          });
          const handlers = host
            ? yield* client.handlersFor(host, {
                agentName: config.name,
                confine: confined.confine,
                writable,
              })
            : refusingHandlers(LISTING_ONLY);
          return yield* spawnAcpAgent(confined.launch, {
            clientVersion: version,
            cwd: root,
            handlers,
          });
        }),
      });
    })
  );
}
