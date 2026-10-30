import type { AcpHandlers } from "@ultrapaint/acp/acp-agent";
import { AgentFailure } from "@ultrapaint/contracts/errors";
import type { AgentConfig, AgentOptions } from "@ultrapaint/contracts/threads";
import { Context, Effect, FileSystem, Layer } from "effect";
import { AppLog } from "../../app-log.ts";
import { ServerConfig } from "../../config.ts";
import { makeKeyedLock } from "../../keyed-lock.ts";
import { AgentConfigs } from "./agent-configs.ts";
import { AgentLauncher } from "./agent-launcher.ts";
import { AgentSandbox } from "./agent-sandbox.ts";
import { ChatPreferences } from "./chat-preferences.ts";
import { ThreadStore } from "./thread-store.ts";
import { mapConfigOptions } from "./transcript.ts";

/** A first `npx` run downloads the agent before it can answer. */
const PROBE_TIMEOUT = "2 minutes";

/** A probe asks for nothing, so whatever the agent asks of the editor is refused. */
const refuse = Effect.fail(
  new AgentFailure({ message: "the editor is only listing models" })
);
const refusing: AcpHandlers = {
  onElicitation: () => Effect.succeed({ action: "decline" }),
  onPermission: () => Effect.succeed({ outcome: { outcome: "cancelled" } }),
  onStderr: () => Effect.void,
  onUpdate: () => Effect.void,
  readTextFile: () => refuse,
  terminal: {
    create: () => refuse,
    kill: () => Effect.void,
    output: () => refuse,
    release: () => Effect.void,
    waitForExit: () => refuse,
  },
  writeTextFile: () => refuse,
};

/**
 * What an agent's sessions offer is only known once one has started. Discovery starts one
 * ahead of time, with no prompt and so no cost, so that a new thread can pick its model
 * before its first prompt: at launch for every agent, and later for one that was never
 * asked. Nothing here knows which agent runs; each says in `session/new` what it offers.
 */
export class AgentDiscovery extends Context.Service<
  AgentDiscovery,
  {
    /**
     * What the agent's sessions offer, starting one to ask if this run has not yet. The
     * answer is remembered, and threads still waiting for options are given them.
     */
    readonly discover: (
      agentId: string
    ) => Effect.Effect<AgentOptions, AgentFailure>;
    /** `discover` in the background, where `ServerConfig.discovery` allows it. */
    readonly discoverInBackground: (agentId: string) => Effect.Effect<void>;
  }
>()("ultrapaint/server/AgentDiscovery") {
  static readonly layer = Layer.effect(
    AgentDiscovery,
    Effect.gen(function* () {
      const { discovery } = yield* ServerConfig;
      const agents = yield* AgentConfigs;
      const sandbox = yield* AgentSandbox;
      const launcher = yield* AgentLauncher;
      const preferences = yield* ChatPreferences;
      const store = yield* ThreadStore;
      const log = yield* AppLog;
      const fs = yield* FileSystem.FileSystem;
      const serviceScope = yield* Effect.scope;
      // One probe per agent at a time; a second caller gets the first one's answer.
      const probing = makeKeyedLock();
      const discovered = new Set<string>();

      /** Starts the agent in an empty directory, asks for a session, and stops it. */
      const probe = (config: AgentConfig) =>
        Effect.gen(function* () {
          const dir = yield* Effect.orDie(
            fs.makeTempDirectoryScoped({ prefix: "ultrapaint-discover-" })
          );
          const agent = yield* launcher.launch({
            config,
            handlers: () => Effect.succeed(refusing),
            root: dir,
            tmpDir: dir,
          });
          yield* agent.initialize;
          // No `authenticate`: signing in is the user's to start, from a thread.
          const info = yield* agent.newSession(dir, {
            meta: sandbox.available ? config.sandboxMeta : undefined,
          });
          return {
            agentId: config.id,
            configOptions: mapConfigOptions(info.configOptions) ?? [],
            currentModeId: info.modes?.currentModeId,
            modes: info.modes?.availableModes.map((m) => ({
              id: m.id,
              name: m.name,
              ...(m.description ? { description: m.description } : {}),
            })),
          } satisfies AgentOptions;
        }).pipe(
          Effect.scoped,
          Effect.timeout(PROBE_TIMEOUT),
          Effect.mapError((error) => {
            const why =
              error._tag === "TimeoutError"
                ? `no answer within ${PROBE_TIMEOUT}`
                : error.message;
            const hint = config.authHint ? ` ${config.authHint}` : "";
            return new AgentFailure({
              message: `${config.name} did not list its models: ${why}.${hint}`,
            });
          })
        );

      /** Threads that have not started a session yet take the options as they are now. */
      const offerToWaitingThreads = Effect.fnUntraced(function* (
        agentId: string
      ) {
        const options = yield* preferences.optionsFor(agentId);
        for (const thread of yield* store.list) {
          if (
            thread.agentId === agentId &&
            thread.sessionId === undefined &&
            thread.configOptions === undefined &&
            thread.status === "idle"
          ) {
            yield* store.update(thread.id, options);
          }
        }
      });

      const discover = Effect.fn("AgentDiscovery.discover")(function* (
        agentId: string
      ) {
        const config = yield* Effect.mapError(
          agents.get(agentId),
          (error) => new AgentFailure({ message: error.message })
        );
        return yield* probing.withLock(
          agentId,
          Effect.gen(function* () {
            const known = (yield* preferences.options).find(
              (a) => a.agentId === agentId
            );
            if (known && discovered.has(agentId)) {
              return known;
            }
            const options = yield* probe(config);
            yield* preferences.remember(options);
            discovered.add(agentId);
            yield* offerToWaitingThreads(agentId);
            return options;
          })
        );
      });

      const discoverInBackground = (agentId: string) =>
        discovery
          ? discover(agentId).pipe(
              Effect.catch((error) => log.log("agent", "warn", error.message)),
              Effect.forkIn(serviceScope),
              Effect.asVoid
            )
          : Effect.void;

      // Every agent at launch, side by side: a missing one must not hold up the others.
      if (discovery) {
        yield* agents.list.pipe(
          Effect.flatMap((all) =>
            Effect.forEach(all, (a) => discoverInBackground(a.id))
          )
        );
      }

      return AgentDiscovery.of({ discover, discoverInBackground });
    })
  );
}
