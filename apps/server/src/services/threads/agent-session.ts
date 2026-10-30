/**
 * Opening an ACP session on an agent just launched: `initialize`, then the thread's stored
 * session reopened when the agent can, else a new one, and the options and mode the thread chose
 * set on it where they differ and still exist. An agent that must be signed in first is not signed
 * in blindly: the thread says how it signs in, and the user does. What it gives back is the
 * thread's to keep, with what the agent said it can do; the session module writes it.
 */
import type {
  AcpAgent,
  McpServerConfig,
  NewSessionResponse,
} from "@ultrapaint/acp/acp-agent";
import type { AcpError } from "@ultrapaint/acp/errors";
import {
  AUTH_REQUIRED,
  type Negotiated,
  negotiated,
  type SignInMethod,
} from "@ultrapaint/acp/negotiated";
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

/** Boolean options travel as strings in the editor and as booleans in ACP. */
export const BOOLEAN_VALUES: Record<string, boolean | undefined> = {
  false: false,
  true: true,
};

export const agentFailure = (error: AcpError) =>
  new AgentFailure({ message: error.message });

type SessionInfo = Pick<
  NewSessionResponse,
  "configOptions" | "modes" | "sessionId"
>;

/** "Codex is not signed in. It signs in with ChatGPT, or with Log in, in a terminal." */
export const signInText = (
  agentName: string,
  methods: readonly SignInMethod[]
) => {
  const ways = methods.map(
    (m) =>
      `${m.name}${m.description ? ` (${m.description})` : ""}${m.kind === "terminal" ? ", in a terminal" : ""}`
  );
  return ways.length === 0
    ? `${agentName} is not signed in.`
    : `${agentName} is not signed in. It signs in with ${ways.join(", or with ")}.`;
};

/** A session opened: what the thread keeps of it, and whether it had the conversation back. */
export interface OpenedSession {
  /** Whether the session was given the editor's MCP server. */
  readonly editorMcp: boolean;
  /** What the agent said it can do. */
  readonly negotiated: Negotiated;
  readonly patch: Pick<
    Thread,
    | "configOptions"
    | "currentModeId"
    | "modes"
    | "sandboxed"
    | "sandboxProblem"
    | "sessionId"
  >;
  /** The stored session was reopened: the agent has the conversation back. */
  readonly resumed: boolean;
}

export const makeSessionOpener = Effect.fnUntraced(function* () {
  const store = yield* ThreadStore;
  const sandbox = yield* AgentSandbox;
  const preferences = yield* ChatPreferences;
  const log = yield* AppLog;

  /** Opens the stored session again when the agent can, otherwise starts a new one. */
  const reopenOrCreate = Effect.fnUntraced(function* (
    agent: AcpAgent,
    storedSessionId: string | undefined,
    root: string,
    meta: unknown,
    mcpServers: readonly McpServerConfig[]
  ) {
    if (storedSessionId) {
      const reopened = yield* agent
        .reopen(storedSessionId, root, { mcpServers, meta })
        .pipe(
          // An expired or unknown session is not an error for the user: start fresh.
          Effect.catch((error) =>
            Effect.as(
              log.log(
                "agent",
                "warn",
                `session reopen failed, starting fresh: ${error.message}`
              ),
              null
            )
          )
        );
      if (reopened) {
        const info: SessionInfo = { ...reopened, sessionId: storedSessionId };
        return { info, resumed: true };
      }
    }
    const info: SessionInfo = yield* agent.newSession(root, {
      mcpServers,
      meta,
    });
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
              mapConfigOptions(response.configOptions) ??
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

  /**
   * The session the thread's prompts go to, on an agent launched for it. The editor's MCP
   * server is offered where the agent says it reaches one over http.
   */
  const open = Effect.fnUntraced(function* (options: {
    readonly agent: AcpAgent;
    readonly config: AgentConfig;
    readonly editorMcp: McpServerConfig | null;
    readonly root: string;
    readonly thread: Thread;
  }) {
    const { agent, config, editorMcp, root, thread } = options;
    const threadId = thread.id;
    const agreed = negotiated(
      yield* Effect.mapError(agent.initialize, agentFailure)
    );
    const mcpServers = editorMcp && agreed.mcpHttp ? [editorMcp] : [];
    const { info, resumed } = yield* reopenOrCreate(
      agent,
      thread.sessionId,
      root,
      sandbox.available ? config.sandboxMeta : undefined,
      mcpServers
    ).pipe(
      Effect.mapError((error) =>
        // ACP's own code, not the wording: the user signs in, the editor does not pick how.
        error._tag === "AcpRequestError" && error.code === AUTH_REQUIRED
          ? new AgentFailure({
              message: signInText(config.name, agreed.signIn),
            })
          : agentFailure(error)
      )
    );
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
      editorMcp: mcpServers.length > 0,
      negotiated: agreed,
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
