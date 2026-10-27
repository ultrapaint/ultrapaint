/**
 * Opening an ACP session on an agent just launched: `initialize`, then the thread's stored
 * session loaded when the agent can, else a new one (signing in first when the agent asks), and
 * the options and mode the thread chose set on it where they differ and still exist. What it
 * gives back is the thread's to keep; the session module writes it.
 */
import type { AcpAgent, McpServerConfig } from "@ultrapaint/acp/acp-agent";
import type { AcpError } from "@ultrapaint/acp/errors";
import { AgentFailure } from "@ultrapaint/contracts/errors";
import {
  type AgentConfig,
  type ConfigOption,
  type Thread,
  withNamedChoices,
} from "@ultrapaint/contracts/threads";
import { Effect } from "effect";
import { AppLog } from "../../app-log.ts";
import { AgentSandbox } from "./agent-sandbox.ts";
import { ChatPreferences } from "./chat-preferences.ts";
import { ThreadStore } from "./thread-store.ts";
import { mapConfigOptions } from "./transcript.ts";

const AUTH_ERROR_RE = /auth/i;
/** Boolean options travel as strings in the editor and as booleans in ACP. */
export const BOOLEAN_VALUES: Record<string, boolean | undefined> = {
  false: false,
  true: true,
};

export const agentFailure = (error: AcpError) =>
  new AgentFailure({ message: error.message });

interface SessionInfo {
  readonly configOptions?: unknown;
  readonly modes?: {
    readonly availableModes: readonly {
      readonly description?: string | null;
      readonly id: string;
      readonly name: string;
    }[];
    readonly currentModeId: string;
  } | null;
  readonly sessionId: string;
}

/** A session opened: what the thread keeps of it, and whether it had the conversation back. */
export interface OpenedSession {
  readonly patch: Pick<
    Thread,
    | "configOptions"
    | "currentModeId"
    | "modes"
    | "sandboxed"
    | "sandboxProblem"
    | "sessionId"
  >;
  /** The stored session was loaded: the agent has the conversation back. */
  readonly resumed: boolean;
}

export const makeSessionOpener = Effect.fnUntraced(function* () {
  const store = yield* ThreadStore;
  const sandbox = yield* AgentSandbox;
  const preferences = yield* ChatPreferences;
  const log = yield* AppLog;

  /**
   * Loads the stored session when the agent can, otherwise starts a new one. While the stored
   * session is replayed its updates are not new items: `replaying` says when that is.
   */
  const loadOrCreate = Effect.fnUntraced(function* (
    agent: AcpAgent,
    storedSessionId: string | undefined,
    canLoad: boolean,
    root: string,
    meta: unknown,
    mcpServers: readonly McpServerConfig[],
    replaying: (on: boolean) => Effect.Effect<void>
  ) {
    if (storedSessionId && canLoad) {
      yield* replaying(true);
      const loaded = yield* agent
        .loadSession(storedSessionId, root, mcpServers)
        .pipe(
          Effect.map(
            (response): SessionInfo => ({
              ...(response as Omit<SessionInfo, "sessionId"> | undefined),
              sessionId: storedSessionId,
            })
          ),
          // An expired or unknown session is not an error for the user: start fresh.
          Effect.catch((error) =>
            Effect.as(
              log.log(
                "agent",
                "warn",
                `session load failed, starting fresh: ${error.message}`
              ),
              null
            )
          ),
          // The replayed updates can trail the response; they are still history.
          Effect.ensuring(
            Effect.andThen(
              Effect.timeoutOption(agent.drained, "5 seconds"),
              replaying(false)
            )
          )
        );
      if (loaded) {
        return { info: loaded, resumed: true };
      }
    }
    const info = (yield* agent.newSession(root, {
      mcpServers,
      meta,
    })) as SessionInfo;
    return { info, resumed: false };
  });

  /** Sets on a fresh session the values the thread chose, where they differ and still exist. */
  const applyOptions = Effect.fnUntraced(function* (
    agent: AcpAgent,
    sessionId: string,
    reported: readonly ConfigOption[],
    wanted: readonly ConfigOption[]
  ) {
    let current = reported;
    for (const want of wanted) {
      const offered = current.find((o) => o.id === want.id);
      if (
        !offered ||
        offered.currentValue === want.currentValue ||
        !offered.options.some((o) => o.value === want.currentValue)
      ) {
        continue;
      }
      const value = want.currentValue;
      current = yield* agent
        .setConfigOption(sessionId, want.id, BOOLEAN_VALUES[value] ?? value)
        .pipe(
          Effect.map(
            (response) =>
              mapConfigOptions(
                (response as { configOptions?: unknown } | undefined)
                  ?.configOptions
              ) ??
              current.map((o) =>
                o.id === want.id ? { ...o, currentValue: value } : o
              )
          ),
          // The session works with the agent's own value; the menu shows which one.
          Effect.catch((error) =>
            Effect.as(
              log.log(
                "agent",
                "warn",
                `option ${want.id} not applied: ${error.message}`
              ),
              current
            )
          )
        );
    }
    return current;
  });

  /** The session the thread's prompts go to, on an agent launched for it. */
  const open = Effect.fnUntraced(function* (options: {
    readonly agent: AcpAgent;
    readonly config: AgentConfig;
    readonly mcpServers: readonly McpServerConfig[];
    readonly replaying: (on: boolean) => Effect.Effect<void>;
    readonly root: string;
    readonly thread: Thread;
  }) {
    const { agent, config, mcpServers, replaying, root, thread } = options;
    const threadId = thread.id;
    const negotiate = Effect.gen(function* () {
      const init = yield* agent.initialize;
      const canLoad = init.agentCapabilities?.loadSession === true;
      const attempt = loadOrCreate(
        agent,
        thread.sessionId,
        canLoad,
        root,
        sandbox.available ? config.sandboxMeta : undefined,
        mcpServers,
        replaying
      );
      const [firstAuth] = init.authMethods ?? [];
      // Some agents need authentication before a session can be created.
      return yield* attempt.pipe(
        Effect.catchIf(
          (error) => !!firstAuth && AUTH_ERROR_RE.test(error.message),
          () => Effect.andThen(agent.authenticate(firstAuth?.id ?? ""), attempt)
        )
      );
    });
    const { info, resumed } = yield* Effect.mapError(negotiate, agentFailure);
    const modes = info.modes?.availableModes.map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
    }));
    const reported = mapConfigOptions(info.configOptions) ?? [];
    // A new session offers the agent's own defaults: what the next thread starts from.
    if (!resumed) {
      yield* preferences.remember({
        agentId: thread.agentId,
        configOptions: reported,
        currentModeId: info.modes?.currentModeId,
        modes,
      });
    }
    // Chosen before the session existed, or while it booted: the thread's, else the defaults.
    const wanted = withNamedChoices(
      (yield* store.get(threadId))?.configOptions ??
        (yield* preferences.optionsFor(thread.agentId)).configOptions ??
        []
    );
    const configOptions = yield* applyOptions(
      agent,
      info.sessionId,
      reported,
      wanted
    );
    const wantedMode = (yield* store.get(threadId))?.currentModeId;
    const currentModeId =
      wantedMode &&
      wantedMode !== info.modes?.currentModeId &&
      modes?.some((m) => m.id === wantedMode)
        ? yield* agent.setMode(info.sessionId, wantedMode).pipe(
            Effect.as(wantedMode),
            Effect.catch((error) =>
              Effect.as(
                log.log(
                  "agent",
                  "warn",
                  `mode ${wantedMode} not applied: ${error.message}`
                ),
                info.modes?.currentModeId
              )
            )
          )
        : info.modes?.currentModeId;
    const opened: OpenedSession = {
      patch: {
        configOptions,
        currentModeId,
        modes,
        sandboxed: sandbox.available,
        sandboxProblem: sandbox.problem,
        sessionId: info.sessionId,
      },
      resumed,
    };
    return opened;
  });

  return { open };
});
