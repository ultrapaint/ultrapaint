/**
 * The agents a test plays (`@ultrapaint/acp/scripted-agent`), behind the `AgentLauncher` a
 * thread starts its agent through. A thread's session asks the launcher as it always does; the
 * test takes the agent it got with `next`, then each prompt from it with `nextTurn`, and plays
 * the turn. Nothing is spawned and nothing is confined: a command the agent asks the editor to
 * run is run as asked.
 */
import {
  type AgentScript,
  makeScriptedAgent,
  type ScriptedAgent,
} from "@ultrapaint/acp/scripted-agent";
import type { AgentConfig } from "@ultrapaint/contracts/threads";
import { Context, Effect, Layer, Queue } from "effect";
import {
  AgentLauncher,
  type AgentLaunchOptions,
} from "../services/threads/agent-launcher.ts";

/** An agent the launcher started, with what it was started for. */
export interface LaunchedAgent extends ScriptedAgent {
  readonly config: AgentConfig;
  readonly root: string;
  readonly writable: string | undefined;
}

export class ScriptedAgents extends Context.Service<
  ScriptedAgents,
  {
    /** How many agents were started so far. */
    readonly launched: Effect.Effect<number>;
    /** The next agent started, in the order they were: waits for one. */
    readonly next: Effect.Effect<LaunchedAgent>;
    /**
     * How the agents started from now on answer before their first prompt: those of `agentId`,
     * or, without one, every agent that has no script of its own.
     */
    readonly script: (
      script: AgentScript,
      agentId?: string
    ) => Effect.Effect<void>;
  }
>()("ultrapaint/server/testing/ScriptedAgents") {
  /** The agents, and the launcher that starts them. */
  static readonly layer = Layer.effectContext(
    Effect.gen(function* () {
      const started = yield* Queue.unbounded<LaunchedAgent>();
      const scripts = new Map<string | undefined, AgentScript>();
      let count = 0;

      const launch = Effect.fnUntraced(function* (options: AgentLaunchOptions) {
        count += 1;
        const handlers = yield* options.handlers((command) => command);
        const { agent, control } = yield* makeScriptedAgent({
          handlers,
          name: `${options.config.id}-${count}`,
          script: scripts.get(options.config.id) ?? scripts.get(undefined),
        });
        yield* Queue.offer(started, {
          ...control,
          config: options.config,
          root: options.root,
          writable: options.writable,
        });
        return agent;
      });

      return Context.make(
        ScriptedAgents,
        ScriptedAgents.of({
          launched: Effect.sync(() => count),
          next: Queue.take(started),
          script: (script, agentId) =>
            Effect.sync(() => {
              scripts.set(agentId, script);
            }),
        })
      ).pipe(Context.add(AgentLauncher, AgentLauncher.of({ launch })));
    })
  );
}
