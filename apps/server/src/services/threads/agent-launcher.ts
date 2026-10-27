/**
 * Where an agent comes from. A launch names the agent, the repository it works in and what the
 * editor does for it; the launcher gives back an `AcpAgent` for as long as the scope, and
 * closing the scope stops it. The live launcher starts the agent's process confined by the
 * sandbox and speaks ACP to it through the SDK; a test gives an agent of its own, scripted in
 * memory (`testing/scripted-agents.ts`). Live sessions and discovery both ask here, and neither
 * knows whether a process runs.
 */
import {
  type AcpAgent,
  type AcpHandlers,
  spawnAcpAgent,
} from "@ultrapaint/acp/acp-agent";
import type { AcpSpawnError } from "@ultrapaint/acp/errors";
import type { AgentLaunch } from "@ultrapaint/acp/sandbox";
import type { AgentConfig } from "@ultrapaint/contracts/threads";
import { Context, Effect, FileSystem, Layer, type Scope } from "effect";
import { AgentSandbox } from "./agent-sandbox.ts";

/** One start of an agent. */
export interface AgentLaunchOptions {
  readonly config: AgentConfig;
  /**
   * What the editor does for the agent, made once the agent's sandbox is known: a command the
   * agent asks the editor to run goes through `confine`, so that it reaches no further than one
   * the agent runs itself. Made in the agent's scope, and gone with it.
   */
  readonly handlers: (
    confine: (launch: AgentLaunch) => AgentLaunch
  ) => Effect.Effect<AcpHandlers, never, Scope.Scope>;
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
      return AgentLauncher.of({
        launch: Effect.fn("AgentLauncher.launch")(function* (
          options: AgentLaunchOptions
        ) {
          const { config, root, writable } = options;
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
          return yield* spawnAcpAgent(confined.launch, {
            cwd: root,
            handlers: yield* options.handlers(confined.confine),
          });
        }),
      });
    })
  );
}
