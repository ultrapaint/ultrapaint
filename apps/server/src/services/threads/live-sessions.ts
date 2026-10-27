/**
 * A thread's live ACP session: started with the first prompt that needs one, in a scope forked
 * from the open project, with the agent sandboxed, given its terminals and the editor's MCP
 * server, and set to the options and mode the thread chose. Closing the scope, whoever does it,
 * ends the agent process, its terminals and any permission or question it still waits on.
 */
import type {
  AcpAgent,
  CreateElicitationResponse,
  McpServerConfig,
  RequestPermissionResponse,
} from "@ultrapaint/acp/acp-agent";
import type { AcpError } from "@ultrapaint/acp/errors";
import { makeTerminalManager } from "@ultrapaint/acp/terminal-manager";
import {
  AgentFailure,
  type Conflict,
  type ForbiddenPath,
  type NotConfigured,
  NotFound,
} from "@ultrapaint/contracts/errors";
import {
  type ConfigOption,
  EDITOR_MCP_SERVER,
  type Question,
  withNamedChoices,
} from "@ultrapaint/contracts/threads";
import { Deferred, Effect, Exit, type Fiber, Path, Scope } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { AppLog } from "../../app-log.ts";
import { connectHost, ServerConfig } from "../../config.ts";
import { EventBus } from "../../events.ts";
import { makeKeyedLock } from "../../keyed-lock.ts";
import { ListenPort } from "../../listen-port.ts";
import { ProjectManager } from "../../project.ts";
import { McpAccess } from "../mcp/access.ts";
import { MCP_PATH, MCP_TOKEN_HEADER } from "../mcp/route.ts";
import type { RepoPaths } from "../repo-paths.ts";
import type { AgentClient } from "./agent-client.ts";
import { AgentConfigs } from "./agent-configs.ts";
import { AgentLauncher } from "./agent-launcher.ts";
import { AgentSandbox } from "./agent-sandbox.ts";
import { ChatPreferences } from "./chat-preferences.ts";
import { ThreadStore } from "./thread-store.ts";
import { mapConfigOptions, type TurnCursor } from "./transcript.ts";

const AUTH_ERROR_RE = /auth/i;
/** Boolean options travel as strings in the editor and as booleans in ACP. */
export const BOOLEAN_VALUES: Record<string, boolean | undefined> = {
  false: false,
  true: true,
};
export const CANCELLED: RequestPermissionResponse = {
  outcome: { outcome: "cancelled" },
};

interface PendingPermission {
  readonly decision: Deferred.Deferred<RequestPermissionResponse>;
  /** What "remember this choice" is keyed by: the tool kind, else its title. */
  readonly rememberKey: string;
}

/** A question card the agent waits on, by the card's item id. */
interface PendingQuestions {
  readonly questions: readonly Question[];
  readonly reply: Deferred.Deferred<CreateElicitationResponse>;
}

export interface Live {
  readonly agent: AcpAgent;
  /** Question cards the agent is waiting on, until they are answered, declined or let go. */
  readonly asking: Map<string, PendingQuestions>;
  /** The briefing, and the recap of what came before, go out once, with the first prompt. */
  briefed: boolean;
  readonly pending: Map<string, PendingPermission>;
  readonly remembered: Map<string, string>;
  /** While a stored session is replayed by `session/load`, its updates are not new items. */
  replaying: boolean;
  /** The session was loaded, so the agent has the conversation back. */
  resumed: boolean;
  readonly scope: Scope.Closeable;
  turn: TurnCursor | null;
}

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

export type ThreadFailure =
  | NotFound
  | NotConfigured
  | Conflict
  | ForbiddenPath
  | AgentFailure;

export const agentFailure = (error: AcpError) =>
  new AgentFailure({ message: error.message });

export const makeLiveSessions = Effect.fnUntraced(function* (deps: {
  readonly client: AgentClient;
  readonly currentPaths: Effect.Effect<RepoPaths["Service"], NotConfigured>;
  readonly detached: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
}) {
  const { client, currentPaths, detached } = deps;
  const { handlersFor, letGo, onUpdate } = client;
  const store = yield* ThreadStore;
  const agents = yield* AgentConfigs;
  const sandbox = yield* AgentSandbox;
  const launcher = yield* AgentLauncher;
  const access = yield* McpAccess;
  const { host, mcp: mcpEnabled } = yield* ServerConfig;
  const listen = yield* ListenPort;
  const preferences = yield* ChatPreferences;
  const project = yield* ProjectManager;
  const events = yield* EventBus;
  const log = yield* AppLog;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const live = new Map<string, Live>();
  // One session start per thread, however many calls ask for it at once.
  const starting = makeKeyedLock();

  // ---- session lifecycle ----
  const stop = (threadId: string) =>
    Effect.suspend(() => {
      const session = live.get(threadId);
      live.delete(threadId);
      return session ? Scope.close(session.scope, Exit.void) : Effect.void;
    });

  /** Loads the stored session when the agent can, otherwise starts a new one. */
  const openSession = Effect.fnUntraced(function* (
    session: Live,
    storedSessionId: string | undefined,
    canLoad: boolean,
    root: string,
    meta: unknown,
    mcpServers: readonly McpServerConfig[]
  ) {
    if (storedSessionId && canLoad) {
      session.replaying = true;
      const loaded = yield* session.agent
        .loadSession(storedSessionId, root, mcpServers)
        .pipe(
          Effect.map(
            (info): SessionInfo => ({
              ...(info as Omit<SessionInfo, "sessionId"> | undefined),
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
              Effect.timeoutOption(session.agent.drained, "5 seconds"),
              Effect.sync(() => {
                session.replaying = false;
              })
            )
          )
        );
      if (loaded) {
        session.resumed = true;
        return loaded;
      }
    }
    return (yield* session.agent.newSession(root, {
      mcpServers,
      meta,
    })) as SessionInfo;
  });

  /** Sets on a fresh session the values the thread chose, where they differ and still exist. */
  const applyOptions = Effect.fnUntraced(function* (
    session: Live,
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
      current = yield* session.agent
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

  /**
   * Starts a thread's session. A start that does not finish (it failed, broke, or was
   * stopped because the thread was deleted while its agent booted) closes what it opened:
   * the agent process, its terminals and its MCP token.
   */
  const start = (threadId: string) =>
    Effect.suspend(() => {
      const opened: { scope: Scope.Closeable | null } = { scope: null };
      return startIn(threadId, opened).pipe(
        Effect.onError(() =>
          Effect.suspend(() => {
            const { scope } = opened;
            if (scope === null) {
              return Effect.void;
            }
            if (live.get(threadId)?.scope === scope) {
              live.delete(threadId);
            }
            return Scope.close(scope, Exit.void);
          })
        )
      );
    });

  const startIn = Effect.fnUntraced(function* (
    threadId: string,
    opened: { scope: Scope.Closeable | null }
  ) {
    const thread = yield* store.get(threadId);
    if (!thread) {
      return yield* new NotFound({ message: `unknown thread ${threadId}` });
    }
    const projectScope = yield* project.scope;
    const paths = yield* currentPaths;
    const config = yield* agents.get(thread.agentId);

    const scope = yield* Scope.fork(projectScope);
    opened.scope = scope;
    const holder: { session: Live | null } = { session: null };
    const boot = Effect.gen(function* () {
      // A design thread writes its designs only; an implement thread, the repository (ADR 0030).
      const writable =
        thread.purpose === "implement" ? undefined : paths.designsDir;
      const agent = yield* launcher.launch({
        config,
        handlers: (confine) =>
          Effect.map(
            makeTerminalManager({
              // A command we run for the agent must not reach further than one it runs itself.
              confine,
              onOutput: (terminalId, chunk) =>
                events.publish("agent.terminal", {
                  chunk,
                  terminalId,
                  threadId,
                }),
            }).pipe(
              Effect.provideService(
                ChildProcessSpawner.ChildProcessSpawner,
                spawner
              )
            ),
            (terminals) =>
              handlersFor(
                threadId,
                config.name,
                paths,
                terminals,
                () => holder.session as Live,
                writable
              )
          ),
        root: paths.root,
        writable,
      });
      const session: Live = {
        agent,
        asking: new Map(),
        briefed: false,
        pending: new Map(),
        remembered: new Map(),
        replaying: false,
        resumed: false,
        scope,
        turn: null,
      };
      holder.session = session;
      return session;
    }).pipe(Scope.provide(scope));
    const session = yield* boot.pipe(
      Effect.mapError(agentFailure),
      Effect.onError(() => Scope.close(scope, Exit.void)),
      Effect.tapError((error) =>
        store.update(threadId, { error: error.message, status: "error" })
      )
    );
    live.set(threadId, session);

    // Whoever closes the scope: nobody waits on a permission forever, and a thread that
    // was mid-turn does not stay "running".
    yield* Scope.addFinalizer(
      scope,
      Effect.gen(function* () {
        // The project scope can close this one directly, without going through `stop`.
        if (live.get(threadId) === session) {
          live.delete(threadId);
        }
        for (const pending of session.pending.values()) {
          yield* Deferred.succeed(pending.decision, CANCELLED);
        }
        yield* letGo(threadId, session);
        const current = yield* store.get(threadId);
        if (current && current.status !== "error") {
          yield* store.update(threadId, { status: "idle" });
        }
      })
    );
    // An agent names a file by absolute path; the editor knows it by its path in the
    // repository, and a path outside it is left as it came.
    const relative = (file: string) =>
      path.isAbsolute(file) ? paths.relative(file) : file;
    yield* Effect.forkIn(
      session.agent.consumeUpdates((n) =>
        onUpdate(threadId, session, n.update, relative)
      ),
      scope
    );
    // An exit we did not ask for. Forked outside the session scope because it closes it.
    yield* session.agent.exited.pipe(
      Effect.flatMap(({ code, signal }) =>
        Effect.gen(function* () {
          if (live.get(threadId) !== session) {
            return;
          }
          const status = (yield* store.get(threadId))?.status;
          if (status === "running" || status === "starting") {
            yield* store.update(threadId, {
              error: `agent exited (${signal ?? code})`,
              status: "error",
            });
          }
          yield* stop(threadId);
        })
      ),
      Effect.forkIn(projectScope)
    );

    // The agent is told about the editor's own MCP server, with a token that dies with the
    // session. `mcpCapabilities` is the agent saying it can reach one over http.
    const mcpServers: McpServerConfig[] = [];
    if (mcpEnabled) {
      const token = yield* Scope.provide(access.issue(threadId), session.scope);
      mcpServers.push({
        headers: [{ name: MCP_TOKEN_HEADER, value: token }],
        name: EDITOR_MCP_SERVER,
        type: "http",
        url: `http://${connectHost(host)}:${yield* listen.get}${MCP_PATH}`,
      });
    }

    const negotiate = Effect.gen(function* () {
      const init = yield* session.agent.initialize;
      const canLoad = init.agentCapabilities?.loadSession === true;
      const open = openSession(
        session,
        thread.sessionId,
        canLoad,
        paths.root,
        sandbox.available ? config.sandboxMeta : undefined,
        mcpServers
      );
      const [firstAuth] = init.authMethods ?? [];
      // Some agents need authentication before a session can be created.
      return yield* open.pipe(
        Effect.catchIf(
          (error) => !!firstAuth && AUTH_ERROR_RE.test(error.message),
          () =>
            Effect.andThen(
              session.agent.authenticate(firstAuth?.id ?? ""),
              open
            )
        )
      );
    });
    const info = yield* negotiate.pipe(
      Effect.mapError(agentFailure),
      Effect.tapError((error) =>
        Effect.andThen(
          stop(threadId),
          store.update(threadId, { error: error.message, status: "error" })
        )
      )
    );
    const modes = info.modes?.availableModes.map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
    }));
    const reported = mapConfigOptions(info.configOptions) ?? [];
    // A new session offers the agent's own defaults: what the next thread starts from.
    if (!session.resumed) {
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
      session,
      info.sessionId,
      reported,
      wanted
    );
    const wantedMode = (yield* store.get(threadId))?.currentModeId;
    const currentModeId =
      wantedMode &&
      wantedMode !== info.modes?.currentModeId &&
      modes?.some((m) => m.id === wantedMode)
        ? yield* session.agent.setMode(info.sessionId, wantedMode).pipe(
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
    // The status is the prompt's: the session starts inside its turn.
    yield* store.update(threadId, {
      configOptions,
      currentModeId,
      modes,
      sandboxed: sandbox.available,
      sandboxProblem: sandbox.problem,
      sessionId: info.sessionId,
    });
    return session;
  });

  /** Session starts under way, by thread: deleting the thread stops its agent mid-boot. */
  const booting = new Map<string, Fiber.Fiber<unknown, unknown>>();

  const ensureLive = (threadId: string) =>
    detached(
      starting.withLock(
        threadId,
        Effect.suspend(() => {
          const existing = live.get(threadId);
          if (existing) {
            return Effect.succeed(existing);
          }
          return Effect.withFiber((self) => {
            booting.set(threadId, self);
            return start(threadId).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  if (booting.get(threadId) === self) {
                    booting.delete(threadId);
                  }
                })
              )
            );
          });
        })
      )
    ).pipe(Effect.withSpan("ThreadService.ensureLive"));

  const sessionOf = Effect.fnUntraced(function* (threadId: string) {
    const session = yield* ensureLive(threadId);
    const sessionId = (yield* store.get(threadId))?.sessionId;
    if (!sessionId) {
      return yield* new AgentFailure({ message: "no session" });
    }
    return { session, sessionId };
  });

  return { booting, live, sessionOf, stop };
});

export type LiveSessions = Effect.Success<ReturnType<typeof makeLiveSessions>>;
