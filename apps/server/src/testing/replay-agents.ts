/**
 * Agents that replay a transcript a real agent recorded (`@ultrapaint/acp/replay-agent`), behind
 * the `AgentLauncher` a thread starts its agent through, beside the scripted agents. A thread's
 * session asks the launcher as it always does, and speaks ACP through the SDK as it does to a
 * live agent; the test takes the replay with `next` and waits on its `done`. Nothing is spawned
 * and nothing is confined.
 */
import {
  makeReplayAgent,
  type ReplayAgent,
} from "@ultrapaint/acp/replay-agent";
import { Context, Effect, Layer, Queue } from "effect";
import { ServerConfig } from "../config.ts";
import { makeAgentClient } from "../services/threads/agent-client.ts";
import {
  AgentLauncher,
  type AgentLaunchOptions,
  hostless,
} from "../services/threads/agent-launcher.ts";

export class ReplayAgents extends Context.Service<
  ReplayAgents,
  {
    /** The replay of the next agent started, in the order they were: waits for one. */
    readonly next: Effect.Effect<ReplayAgent>;
  }
>()("ultrapaint/server/testing/ReplayAgents") {
  /**
   * Every agent started replays `transcript`; the launcher that starts them. Without one, the
   * launcher already there (the scripted agents') starts them, and there is no replay to take.
   */
  static readonly layer = (transcript: string | null) =>
    Layer.effectContext(
      Effect.gen(function* () {
        const { version } = yield* ServerConfig;
        const scripted = yield* AgentLauncher;
        const client = yield* makeAgentClient();
        const started = yield* Queue.unbounded<ReplayAgent>();

        const launch = Effect.fnUntraced(function* (
          options: AgentLaunchOptions
        ) {
          // The editor's side as the live launcher builds it; nothing is confined.
          const handlers = options.host
            ? yield* client.handlersFor(options.host, {
                agentName: options.config.name,
                confine: (command) => command,
                writable: options.writable,
              })
            : hostless(options);
          const { agent, control } = yield* makeReplayAgent({
            clientVersion: version,
            handlers,
            transcript: transcript ?? "",
          });
          yield* Queue.offer(started, control);
          return { ...agent, confined: false };
        });

        return Context.make(
          ReplayAgents,
          ReplayAgents.of({ next: Queue.take(started) })
        ).pipe(
          Context.add(
            AgentLauncher,
            transcript === null ? scripted : AgentLauncher.of({ launch })
          )
        );
      })
    );
}
