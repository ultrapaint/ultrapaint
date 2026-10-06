/**
 * Agent threads. A thread has at most one ACP session at a time, with the target repository as
 * working directory, and starts it with the first prompt that needs one: creating a thread
 * spawns nothing, and the agent boots while the prompt already shows as running. The agent is
 * the thread's to change between prompts; the next session is then told what was said. Updates are projected into a transcript that the editor renders, permission
 * requests are routed to the UI, and every filesystem or terminal call the agent makes is
 * confined to the repository.
 *
 * A live session is a scope forked from the open project: closing the project, deleting the
 * thread or shutting down ends the agent process, its terminals and any pending permission.
 */
import {
  type AcpAgent,
  type AcpHandlers,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type McpServerConfig,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  spawnAcpAgent,
} from "@ultrapaint/acp/acp-agent";
import type { AcpError } from "@ultrapaint/acp/errors";
import {
  makeTerminalManager,
  type TerminalManager,
} from "@ultrapaint/acp/terminal-manager";
import {
  AgentFailure,
  Conflict,
  type ForbiddenPath,
  type NotConfigured,
  NotFound,
} from "@ultrapaint/contracts/errors";
import {
  type Answers,
  type ConfigOption,
  EDITOR_MCP_SERVER,
  type PromptInput,
  type Question,
  type QueuedPrompt,
  type Thread,
  type ThreadItem,
  type ThreadScope,
  withNamedChoices,
} from "@ultrapaint/contracts/threads";
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Scope,
} from "effect";
import { ChildProcessSpawner } from "effect/process";
import { AppLog } from "../../app-log.ts";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { connectHost, ServerConfig } from "../../config.ts";
import { EventBus } from "../../events.ts";
import { hashContent } from "../../hash.ts";
import { makeId } from "../../ids.ts";
import { makeKeyedLock } from "../../keyed-lock.ts";
import { ProjectManager } from "../../project.ts";
import { GitService, type GitSnapshot } from "../git.ts";
import { McpAccess } from "../mcp/access.ts";
import { MCP_PATH, MCP_TOKEN_HEADER } from "../mcp/route.ts";
import { RepoPaths } from "../repo-paths.ts";
import { AgentConfigs } from "./agent-configs.ts";
import { AgentDiscovery } from "./agent-discovery.ts";
import { AgentSandbox } from "./agent-sandbox.ts";
import { ProjectBriefing } from "./briefing.ts";
import { ChatPreferences } from "./chat-preferences.ts";
import { Checkpoints } from "./checkpoints.ts";
import { SlashCommands } from "./commands.ts";
import { answersText, contentOf, questionsOf } from "./elicitation.ts";
import { recapOf } from "./recap.ts";
import { ThreadStore } from "./thread-store.ts";
import {
  emptyCursor,
  mapConfigOptions,
  projectUpdate,
  type TurnCursor,
  turnUsage,
} from "./transcript.ts";

const AUTH_ERROR_RE = /auth/i;
const DATA_URL_RE = /^data:([^;]+);base64,(.*)$/s;
/** Boolean options travel as strings in the editor and as booleans in ACP. */
const BOOLEAN_VALUES: Record<string, boolean | undefined> = {
  false: false,
  true: true,
};
const CANCELLED: RequestPermissionResponse = {
  outcome: { outcome: "cancelled" },
};
/** Until the first prompt names it. */
const UNTITLED = "New chat";
const SWITCHED = "Switched to";

const TITLE_LIMIT = 48;

const PAGE_FILE_RE = /\.page\.json$/;
const SEPARATORS_RE = /[-_]+/g;

/** `settings/billing.page.json` reads as "Billing". */
const pageNameOf = (file: string): string => {
  const base = file.split("/").at(-1)?.replace(PAGE_FILE_RE, "") ?? file;
  const words = (base === "index" ? "home" : base).replace(SEPARATORS_RE, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * What a thread works on, from the attachments of its first prompt: the first node, or else the
 * first file, which is a page. Null when the prompt attached neither.
 */
export const scopeOf = (
  attachments: PromptInput["attachments"]
): ThreadScope | null => {
  const nodes = attachments.filter((a) => a.kind === "selection");
  const [first] = nodes;
  if (first) {
    return {
      file: first.file,
      name: first.name,
      nodeId: first.nodeId,
      ...(first.component ? { component: true } : {}),
      ...(nodes.length > 1 ? { count: nodes.length } : {}),
    };
  }
  const file = attachments.find((a) => a.kind === "file");
  return file ? { file: file.path, name: pageNameOf(file.path) } : null;
};

/** A thread's title from its first prompt: the first line, cut to fit the thread menu. */
const titleOf = (text: string) => {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) {
    return UNTITLED;
  }
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT)}…` : line;
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

interface Live {
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

type ThreadFailure =
  | NotFound
  | NotConfigured
  | Conflict
  | ForbiddenPath
  | AgentFailure;

const agentFailure = (error: AcpError) =>
  new AgentFailure({ message: error.message });

export class ThreadService extends Context.Service<
  ThreadService,
  {
    /**
     * The user's answers to a question card: recorded on the card, then sent to the agent as a
     * prompt of their own, which is how any ACP agent hears them.
     */
    readonly answer: (
      threadId: string,
      itemId: string,
      answers: Answers
    ) => Effect.Effect<void, ThreadFailure>;
    /**
     * How many cards the thread's agent has waited on so far. A tool that asked and hears
     * "declined" without this moving knows the user never saw its questions: the agent's own
     * client turned them down.
     */
    readonly cardsShown: (threadId: string) => Effect.Effect<number>;
    /** The user will not answer a card the agent waits on. */
    readonly decline: (
      threadId: string,
      itemId: string
    ) => Effect.Effect<void, ThreadFailure>;
    /** Puts an agent's questions to the user as a card in the thread. */
    readonly ask: (
      threadId: string,
      questions: readonly Question[]
    ) => Effect.Effect<void, NotFound>;
    readonly cancel: (threadId: string) => Effect.Effect<void, ThreadFailure>;
    /** Without an agent, the chat's default one. */
    readonly create: (
      agentId?: string,
      title?: string
    ) => Effect.Effect<Thread, ThreadFailure>;
    readonly delete: (threadId: string) => Effect.Effect<void>;
    /** Sends a prompt; while the agent works, it waits in the thread's queue instead. */
    readonly prompt: (input: PromptInput) => Effect.Effect<void, ThreadFailure>;
    /** Takes a queued prompt back out, to drop it or to edit it; null when it was already sent. */
    readonly unqueue: (
      threadId: string,
      id: string
    ) => Effect.Effect<QueuedPrompt | null, ThreadFailure>;
    /** Sends the oldest queued prompt now: after a stopped or failed turn, nothing sends it. */
    readonly sendQueued: (
      threadId: string
    ) => Effect.Effect<void, ThreadFailure>;
    readonly resolvePermission: (
      threadId: string,
      requestId: string,
      optionId: string,
      remember: boolean
    ) => Effect.Effect<void, ThreadFailure>;
    /** The agent the next prompt goes to. */
    readonly setAgent: (
      threadId: string,
      agentId: string
    ) => Effect.Effect<void, ThreadFailure>;
    readonly setConfigOption: (
      threadId: string,
      optionId: string,
      value: string
    ) => Effect.Effect<void, ThreadFailure>;
    readonly setMode: (
      threadId: string,
      modeId: string
    ) => Effect.Effect<void, ThreadFailure>;
  }
>()("ultrapaint/server/ThreadService") {
  static readonly layer = Layer.effect(
    ThreadService,
    Effect.gen(function* () {
      const store = yield* ThreadStore;
      const agents = yield* AgentConfigs;
      const sandbox = yield* AgentSandbox;
      const briefing = yield* ProjectBriefing;
      const commands = yield* SlashCommands;
      const access = yield* McpAccess;
      const {
        briefing: briefingEnabled,
        host,
        mcp: mcpEnabled,
        port,
      } = yield* ServerConfig;
      const checkpoints = yield* Checkpoints;
      const preferences = yield* ChatPreferences;
      const discovery = yield* AgentDiscovery;
      const project = yield* ProjectManager;
      const events = yield* EventBus;
      const log = yield* AppLog;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const serviceScope = yield* Effect.scope;
      const writeAtomic = makeWriteAtomic(fs, path);
      const live = new Map<string, Live>();
      // One session start per thread, however many calls ask for it at once.
      const starting = makeKeyedLock();
      // One prompt at a time per thread, so two cannot both find the thread idle.
      const opening = makeKeyedLock();
      /** Taking from a thread's queue, one at a time: a prompt is sent once. */
      const queueLock = makeKeyedLock();

      /**
       * Runs work to completion even if the caller goes away. RPC handlers are interrupted when
       * their socket closes (a page reload is enough), and a session start or the opening of a
       * turn that stops half way leaves the thread in a state nothing recovers from.
       */
      const detached = <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.flatMap(Effect.forkIn(effect, serviceScope), Fiber.join);

      const newItemId = makeId("item");
      const currentPaths = project.use(Effect.map(RepoPaths, (paths) => paths));

      // ---- transcript ----
      const onUpdate = Effect.fnUntraced(function* (
        threadId: string,
        session: Live,
        update: Parameters<typeof projectUpdate>[0],
        relative: (file: string) => string
      ) {
        if (session.replaying) {
          return;
        }
        // Ids are drawn up front because the projection itself is pure and synchronous.
        const ids = [yield* newItemId];
        const actions = projectUpdate(update, {
          hasItem: (itemId) => store.hasItem(threadId, itemId),
          newId: () => ids.pop() ?? `item_${ids.length}`,
          now: yield* Clock.currentTimeMillis,
          relative,
          turn: session.turn,
        });
        for (const action of actions) {
          if (action.type === "push") {
            yield* store.push(threadId, action.item);
          } else if (action.type === "patch") {
            yield* store.patchItem(threadId, action.itemId, action.patch);
          } else {
            yield* store.update(threadId, action.patch);
          }
        }
      });

      // ---- questions an MCP server asks through the agent ----
      const DECLINE: CreateElicitationResponse = { action: "decline" };
      const shown = new Map<string, number>();
      const CANCEL: CreateElicitationResponse = { action: "cancel" };

      /**
       * A form the agent waits on: drawn as a question card, answered when the user sends it.
       * A link to follow, or a field the card has no input for, is declined at once.
       */
      const onElicitation = Effect.fnUntraced(function* (
        threadId: string,
        session: Live,
        request: CreateElicitationRequest
      ) {
        const questions =
          request.mode === "form" && "requestedSchema" in request
            ? questionsOf(request.requestedSchema)
            : null;
        if (questions === null || questions.length === 0) {
          yield* log.log(
            "agent",
            "info",
            `declined a question the editor cannot show: ${request.message}`
          );
          return DECLINE;
        }
        const itemId = yield* newItemId;
        const reply = yield* Deferred.make<CreateElicitationResponse>();
        session.asking.set(itemId, { questions, reply });
        shown.set(threadId, (shown.get(threadId) ?? 0) + 1);
        yield* store.push(threadId, {
          answers: null,
          at: yield* Clock.currentTimeMillis,
          elicitation: { message: request.message },
          id: itemId,
          kind: "question",
          questions,
        });
        return yield* Deferred.await(reply).pipe(
          Effect.ensuring(Effect.sync(() => session.asking.delete(itemId)))
        );
      });

      /** The agent stops waiting: its open cards say so, and it hears `cancel` for each. */
      const letGo = Effect.fnUntraced(function* (
        threadId: string,
        session: Live
      ) {
        for (const [itemId, pending] of session.asking) {
          yield* store.patchItem(threadId, itemId, (item) =>
            item.kind === "question" && item.answers === null
              ? { ...item, outcome: "cancelled" as const }
              : item
          );
          yield* Deferred.succeed(pending.reply, CANCEL);
        }
        session.asking.clear();
      });

      // ---- permissions ----
      const onPermission = Effect.fnUntraced(function* (
        threadId: string,
        session: Live,
        request: RequestPermissionRequest
      ) {
        const { toolCall } = request;
        const rememberKey = toolCall.kind ?? toolCall.title ?? "tool";
        const remembered = session.remembered.get(rememberKey);
        if (
          remembered &&
          request.options.some((o) => o.optionId === remembered)
        ) {
          return {
            outcome: { optionId: remembered, outcome: "selected" },
          } satisfies RequestPermissionResponse;
        }
        const requestId = yield* makeId("perm");
        const detail = [
          ...(toolCall.locations ?? []).map((l) => l.path),
          ...(toolCall.rawInput
            ? [JSON.stringify(toolCall.rawInput).slice(0, 500)]
            : []),
        ].join("\n");
        const decision = yield* Deferred.make<RequestPermissionResponse>();
        session.pending.set(requestId, { decision, rememberKey });
        yield* store.push(threadId, {
          at: yield* Clock.currentTimeMillis,
          decision: null,
          id: requestId,
          kind: "permission",
          options: request.options.map((o) => ({
            kind: o.kind,
            name: o.name,
            optionId: o.optionId,
          })),
          requestId,
          title: toolCall.title ?? "Permission request",
          ...(detail ? { detail } : {}),
          ...(toolCall.toolCallId ? { toolCallId: toolCall.toolCallId } : {}),
        });
        const response = yield* Deferred.await(decision);
        session.pending.delete(requestId);
        const chosen =
          response.outcome.outcome === "selected"
            ? response.outcome.optionId
            : "cancelled";
        yield* store.patchItem(threadId, requestId, (i) =>
          i.kind === "permission" ? { ...i, decision: chosen } : i
        );
        return response;
      });

      // ---- what the host does for the agent ----
      const handlersFor = (
        threadId: string,
        agentName: string,
        paths: RepoPaths["Service"],
        terminals: TerminalManager,
        session: () => Live
      ): AcpHandlers => ({
        onElicitation: (request) => onElicitation(threadId, session(), request),
        onPermission: (request) => onPermission(threadId, session(), request),
        onStderr: (text) => log.log("agent", "info", `[${agentName}] ${text}`),
        readTextFile: Effect.fn("ThreadService.readTextFile")(
          function* (request) {
            const abs = yield* paths.resolve(request.path);
            const content = yield* fs.readFileString(abs);
            if (!(request.line || request.limit)) {
              return { content };
            }
            const start = Math.max(0, (request.line ?? 1) - 1);
            const end = request.limit ? start + request.limit : undefined;
            return {
              content: content.split("\n").slice(start, end).join("\n"),
            };
          }
        ),
        terminal: {
          create: Effect.fn("ThreadService.createTerminal")(
            function* (request) {
              const cwd = request.cwd
                ? yield* paths.resolve(request.cwd)
                : paths.root;
              const terminalId = yield* terminals.create({
                args: request.args ?? [],
                command: request.command,
                cwd,
                env: Object.fromEntries(
                  (request.env ?? []).map((e) => [e.name, e.value])
                ),
                outputByteLimit: request.outputByteLimit,
              });
              return { terminalId };
            }
          ),
          kill: (request) => terminals.kill(request.terminalId),
          output: (request) => terminals.output(request.terminalId),
          release: (request) => terminals.release(request.terminalId),
          waitForExit: (request) => terminals.waitForExit(request.terminalId),
        },
        writeTextFile: Effect.fn("ThreadService.writeTextFile")(
          function* (request) {
            const abs = yield* paths.resolve(request.path);
            yield* writeAtomic(abs, request.content);
            yield* events.publish("file.changed", {
              file: paths.relative(abs),
              hash: hashContent(request.content),
            });
          }
        ),
      });

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
          // The agent's only temporary directory, and it goes with the session.
          const tmpDir = yield* Effect.orDie(
            fs.makeTempDirectoryScoped({ prefix: "ultrapaint-agent-" })
          );
          const confined = yield* sandbox.session({
            config,
            root: paths.root,
            tmpDir,
          });
          const terminals = yield* makeTerminalManager({
            // A command we run for the agent must not reach further than one it runs itself.
            confine: confined.confine,
            onOutput: (terminalId, chunk) =>
              events.publish("agent.terminal", { chunk, terminalId, threadId }),
          });
          const agent = yield* spawnAcpAgent(confined.launch, {
            cwd: paths.root,
            handlers: handlersFor(
              threadId,
              config.name,
              paths,
              terminals,
              () => holder.session as Live
            ),
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
        }).pipe(
          Scope.provide(scope),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          )
        );
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
          const token = yield* Scope.provide(
            access.issue(threadId),
            session.scope
          );
          mcpServers.push({
            headers: [{ name: MCP_TOKEN_HEADER, value: token }],
            name: EDITOR_MCP_SERVER,
            type: "http",
            url: `http://${connectHost(host)}:${port}${MCP_PATH}`,
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

      // ---- prompting ----
      const attachmentBlocks = Effect.fnUntraced(function* (
        input: PromptInput,
        paths: RepoPaths["Service"]
      ) {
        const blocks: ContentBlock[] = [{ text: input.text, type: "text" }];
        const labels: string[] = [];
        for (const a of input.attachments) {
          if (a.kind === "file") {
            const abs = yield* paths.resolve(a.path);
            // A file attached and then deleted is sent as empty rather than failing the prompt.
            const text = yield* Effect.orElseSucceed(
              fs.readFileString(abs),
              () => ""
            );
            blocks.push({
              resource: { mimeType: "text/plain", text, uri: `file://${abs}` },
              type: "resource",
            });
            labels.push(a.path);
          } else if (a.kind === "selection") {
            const abs = yield* paths.resolve(a.file);
            blocks.push(
              {
                text: `The user has selected the node "${a.name}" (id ${a.nodeId}) in ${a.file} on the design canvas. Edits should target this node unless told otherwise.`,
                type: "text",
              },
              { name: a.file, type: "resource_link", uri: `file://${abs}` }
            );
            labels.push(`${a.name} @ ${a.file}`);
          } else {
            const match = a.dataUrl.match(DATA_URL_RE);
            if (match?.[1] && match[2] !== undefined) {
              blocks.push({
                data: match[2],
                mimeType: match[1],
                type: "image",
              });
            }
            labels.push(a.name);
          }
        }
        return { blocks, labels };
      });

      /** A turn that went wrong: the transcript says why, and the thread takes prompts again. */
      const failTurn = (threadId: string, message: string) =>
        Effect.gen(function* () {
          yield* store.push(threadId, {
            at: yield* Clock.currentTimeMillis,
            id: yield* newItemId,
            kind: "status",
            text: `Turn failed: ${message}`,
          });
          yield* store.update(threadId, { error: message, status: "error" });
        });

      /** A bug of ours in a turn: logged, and the turn fails rather than stay "running". */
      const turnBroke = (threadId: string, defect: unknown) => {
        const message =
          defect instanceof Error ? defect.message : String(defect);
        return Effect.andThen(
          log.log("agent", "error", `a turn of ${threadId} broke: ${message}`),
          failTurn(threadId, message)
        );
      };

      const runTurn = (
        threadId: string,
        session: Live,
        sessionId: string,
        blocks: ContentBlock[],
        snapshot: GitSnapshot
      ) =>
        session.agent.prompt(sessionId, blocks).pipe(
          // The response can overtake the last updates; the transcript must be complete first.
          // Bounded, so a stalled consumer cannot keep the thread "running" forever.
          Effect.tap(() =>
            Effect.timeoutOption(session.agent.drained, "5 seconds")
          ),
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.andThen(
                Effect.sync(() => {
                  session.turn = null;
                }),
                failTurn(threadId, error.message)
              ),
            onSuccess: (response) =>
              Effect.gen(function* () {
                // Before the status changes: a cancel that sees no turn leaves the status alone.
                session.turn = null;
                const changedFiles = yield* project
                  .use(
                    Effect.flatMap(GitService, (git) =>
                      git.changedSince(snapshot)
                    )
                  )
                  // Attribution is a nicety; a git failure must not fail the turn.
                  .pipe(Effect.orElseSucceed((): string[] => []));
                const usage = turnUsage(
                  (response as { _meta?: unknown })._meta
                );
                yield* store.push(threadId, {
                  at: yield* Clock.currentTimeMillis,
                  changedFiles,
                  id: yield* newItemId,
                  kind: "turn_end",
                  stopReason: response.stopReason,
                  ...(usage ? { usage } : {}),
                });
                yield* store.update(threadId, { status: "idle" });
                // A turn the user stopped leaves the queue for them to send or drop.
                if (response.stopReason !== "cancelled") {
                  yield* Effect.forkIn(
                    Effect.ignore(
                      Effect.suspend(() => sendQueued(threadId)),
                      { log: true }
                    ),
                    serviceScope
                  );
                }
              }),
          }),
          Effect.catchDefect((defect) => turnBroke(threadId, defect)),
          Effect.ensuring(
            Effect.sync(() => {
              session.turn = null;
            })
          )
        );

      /**
       * What leads a session's first prompt. A resumed session has the conversation back, and
       * the briefing with it if anything was ever asked. A new one is told the project, then
       * what was said before it.
       */
      const sessionContext = Effect.fnUntraced(function* (
        session: Live,
        earlier: readonly ThreadItem[]
      ) {
        if (session.resumed && earlier.some((i) => i.kind === "user")) {
          return [];
        }
        const about = briefingEnabled ? yield* briefing.text : undefined;
        const recap = session.resumed ? null : recapOf(earlier);
        return [about, recap].flatMap((text): ContentBlock[] =>
          text ? [{ text, type: "text" }] : []
        );
      });

      /**
       * A turn from the prompt to the agent: the session is started or resumed, told what it
       * needs, and the designs are checkpointed. The thread already shows as running.
       */
      const openTurn = Effect.fnUntraced(function* (
        input: PromptInput,
        earlier: readonly ThreadItem[],
        blocks: ContentBlock[]
      ) {
        const { threadId } = input;
        const { session, sessionId } = yield* sessionOf(threadId);
        if (!session.briefed) {
          session.briefed = true;
          blocks.unshift(...(yield* sessionContext(session, earlier)));
        }
        const snapshot = yield* project
          .use(Effect.flatMap(GitService, (git) => git.snapshot))
          .pipe(Effect.orElseSucceed((): GitSnapshot => new Map()));
        // Not cut short by a cancel: a checkpoint half written is worse than a late cancel.
        yield* Effect.uninterruptible(
          checkpoints.create(threadId, `Before: ${input.text.slice(0, 60)}`)
        );
        session.turn = emptyCursor();
        yield* Effect.forkIn(
          runTurn(threadId, session, sessionId, blocks, snapshot),
          session.scope
        );
      });

      /** Turns still on their way to the agent, by thread: a cancel stops them there. */
      const openings = new Map<string, Fiber.Fiber<void>>();

      const prompt = Effect.fn("ThreadService.prompt")(function* (
        input: PromptInput
      ) {
        const { threadId } = input;
        const thread = yield* store.get(threadId);
        if (!thread) {
          return yield* new NotFound({ message: `unknown thread ${threadId}` });
        }
        if (thread.status === "running" || thread.status === "cancelling") {
          // Sent when the turn ends: the user need not wait to say what comes next.
          const queued: QueuedPrompt = {
            at: yield* Clock.currentTimeMillis,
            attachments: input.attachments,
            id: yield* newItemId,
            text: input.text,
          };
          yield* store.update(threadId, {
            queued: [...(thread.queued ?? []), queued],
          });
          return;
        }
        const projectScope = yield* project.scope;
        const paths = yield* currentPaths;
        const { blocks, labels } = yield* attachmentBlocks(input, paths);
        // `/init`, `/implement`: the agent is given the task, the transcript keeps what was typed.
        const task = yield* commands.expand(input.text);
        if (task !== null) {
          blocks[0] = { text: task, type: "text" };
        }
        // A copy: the store's own list grows with the prompt about to be pushed.
        const earlier = [...(yield* store.items(threadId))];
        yield* store.push(threadId, {
          at: yield* Clock.currentTimeMillis,
          attachments: labels,
          id: yield* newItemId,
          kind: "user",
          text: input.text,
        });
        const first = !earlier.some((i) => i.kind === "user");
        const scope =
          first && !thread.scope ? scopeOf(input.attachments) : null;
        yield* store.update(threadId, {
          error: undefined,
          status: "running",
          ...(thread.title === UNTITLED && first
            ? { title: titleOf(input.text) }
            : {}),
          ...(scope ? { scope } : {}),
        });
        // The request returns now. Whatever the agent takes to start is part of the turn, and
        // the turn reports through the transcript.
        const turn = Effect.withFiber((self) =>
          openTurn(input, earlier, blocks).pipe(
            Effect.catch((error) =>
              store.update(threadId, { error: error.message, status: "error" })
            ),
            Effect.catchDefect((defect) => turnBroke(threadId, defect)),
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                yield* store.push(threadId, {
                  at: yield* Clock.currentTimeMillis,
                  changedFiles: [],
                  id: yield* newItemId,
                  kind: "turn_end",
                  stopReason: "cancelled",
                });
                yield* store.update(threadId, { status: "idle" });
              })
            ),
            Effect.ensuring(
              Effect.sync(() => {
                if (openings.get(threadId) === self) {
                  openings.delete(threadId);
                }
              })
            )
          )
        );
        openings.set(threadId, yield* Effect.forkIn(turn, projectScope));
      });

      const takeQueued = Effect.fnUntraced(function* (
        threadId: string,
        id: string | null
      ) {
        const thread = yield* store.get(threadId);
        if (!thread) {
          return yield* new NotFound({ message: `unknown thread ${threadId}` });
        }
        const queue = thread.queued ?? [];
        const taken = id === null ? queue[0] : queue.find((q) => q.id === id);
        if (!taken) {
          return null;
        }
        yield* store.update(threadId, {
          queued: queue.filter((q) => q.id !== taken.id),
        });
        return taken;
      });

      const unqueue = (threadId: string, id: string) =>
        queueLock.withLock(threadId, takeQueued(threadId, id));

      // Typed: a turn that ends sends the next prompt, which opens a turn.
      const sendQueued = (
        threadId: string
      ): Effect.Effect<void, ThreadFailure> =>
        queueLock.withLock(
          threadId,
          Effect.gen(function* () {
            const thread = yield* store.get(threadId);
            if (
              thread?.status === "running" ||
              thread?.status === "cancelling"
            ) {
              return;
            }
            const next = yield* takeQueued(threadId, null);
            if (next) {
              yield* opening.withLock(
                threadId,
                prompt({
                  attachments: next.attachments,
                  text: next.text,
                  threadId,
                })
              );
            }
          })
        );

      // ---- questions ----
      const ask = Effect.fn("ThreadService.ask")(function* (
        threadId: string,
        questions: readonly Question[]
      ) {
        if (!(yield* store.get(threadId))) {
          return yield* new NotFound({ message: `unknown thread ${threadId}` });
        }
        yield* store.push(threadId, {
          answers: null,
          at: yield* Clock.currentTimeMillis,
          id: yield* newItemId,
          kind: "question",
          questions,
        });
      });

      const answer = Effect.fn("ThreadService.answer")(function* (
        threadId: string,
        itemId: string,
        answers: Answers
      ) {
        const card = (yield* store.items(threadId)).find(
          (item) => item.id === itemId
        );
        if (card?.kind !== "question") {
          return yield* new NotFound({
            message: "the question is no longer in the thread",
          });
        }
        if (card.answers !== null || card.outcome !== undefined) {
          return yield* new Conflict({
            message: "the questions were already answered",
          });
        }
        if (card.elicitation !== undefined) {
          // The agent waits within its turn: the answers go back to it, not as a prompt.
          const waiting = live.get(threadId)?.asking.get(itemId);
          if (waiting === undefined) {
            return yield* new Conflict({
              message: "the agent no longer waits for these answers",
            });
          }
          yield* store.patchItem(threadId, itemId, (item) =>
            item.kind === "question" ? { ...item, answers } : item
          );
          yield* Deferred.succeed(waiting.reply, {
            action: "accept",
            content: contentOf(waiting.questions, answers),
          });
          return;
        }
        yield* store.patchItem(threadId, itemId, (item) =>
          item.kind === "question" ? { ...item, answers } : item
        );
        yield* prompt({
          attachments: [],
          text: answersText(card.questions, answers),
          threadId,
        });
      });

      const decline = Effect.fn("ThreadService.decline")(function* (
        threadId: string,
        itemId: string
      ) {
        const waiting = live.get(threadId)?.asking.get(itemId);
        if (waiting === undefined) {
          return yield* new NotFound({
            message: "the agent no longer waits for these answers",
          });
        }
        yield* store.patchItem(threadId, itemId, (item) =>
          item.kind === "question"
            ? { ...item, outcome: "declined" as const }
            : item
        );
        yield* Deferred.succeed(waiting.reply, DECLINE);
      });

      const resolvePermission = Effect.fn("ThreadService.resolvePermission")(
        function* (
          threadId: string,
          requestId: string,
          optionId: string,
          remember: boolean
        ) {
          const session = live.get(threadId);
          const pending = session?.pending.get(requestId);
          if (!(session && pending)) {
            return yield* new NotFound({
              message: "permission request is no longer pending",
            });
          }
          if (remember) {
            session.remembered.set(pending.rememberKey, optionId);
          }
          yield* Deferred.succeed(pending.decision, {
            outcome: { optionId, outcome: "selected" },
          });
        }
      );

      const create = Effect.fn("ThreadService.create")(function* (
        agentId?: string,
        title?: string
      ) {
        const known = yield* agents.list;
        const defaults = yield* preferences.defaults;
        const agent =
          agentId === undefined
            ? (known.find((a) => a.id === defaults.agentId) ?? known[0])
            : yield* agents.get(agentId);
        if (!agent) {
          return yield* new NotFound({ message: "no agent is configured" });
        }
        const now = yield* Clock.currentTimeMillis;
        const options = yield* preferences.optionsFor(agent.id);
        // Its models are not known yet: they reach the thread when the agent has said.
        if (options.configOptions === undefined) {
          yield* discovery.discoverInBackground(agent.id);
        }
        const thread: Thread = {
          ...options,
          agentId: agent.id,
          createdAt: now,
          id: yield* makeId("thread"),
          status: "idle",
          title: title ?? UNTITLED,
          updatedAt: now,
        };
        // Nothing is started: the first prompt brings the agent up.
        yield* store.add(thread);
        return thread;
      });

      const setAgent = Effect.fn("ThreadService.setAgent")(function* (
        threadId: string,
        agentId: string
      ) {
        const thread = yield* store.get(threadId);
        if (!thread) {
          return yield* new NotFound({ message: `unknown thread ${threadId}` });
        }
        if (thread.agentId === agentId) {
          return;
        }
        if (thread.status === "running" || thread.status === "cancelling") {
          return yield* new Conflict({
            message: "the agent is still working on the previous prompt",
          });
        }
        const agent = yield* agents.get(agentId);
        const options = yield* preferences.optionsFor(agentId);
        // A session belongs to its agent. The next one starts with the next prompt, and is
        // told what was said before it.
        yield* stop(threadId);
        yield* store.update(threadId, {
          configOptions: undefined,
          currentModeId: undefined,
          modes: undefined,
          sandboxed: undefined,
          sandboxProblem: undefined,
          ...options,
          agentId,
          error: undefined,
          sessionId: undefined,
          status: "idle",
        });
        if (options.configOptions === undefined) {
          yield* discovery.discoverInBackground(agentId);
        }
        const last = (yield* store.items(threadId)).at(-1);
        const text = `${SWITCHED} ${agent.name}`;
        // Switching again before a prompt replaces the note rather than stacking another.
        if (last?.kind === "status" && last.text.startsWith(SWITCHED)) {
          yield* store.patchItem(threadId, last.id, (item) =>
            item.kind === "status" ? { ...item, text } : item
          );
        } else if (last) {
          yield* store.push(threadId, {
            at: yield* Clock.currentTimeMillis,
            id: yield* newItemId,
            kind: "status",
            text,
          });
        }
      });

      /** Stops a turn that has not reached the agent yet. Whether there was one. */
      const stopOpening = (threadId: string) =>
        Effect.suspend(() => {
          const fiber = openings.get(threadId);
          return fiber
            ? Effect.as(Fiber.interrupt(fiber), true)
            : Effect.succeed(false);
        });

      return ThreadService.of({
        answer: (threadId, itemId, answers) =>
          detached(
            opening.withLock(threadId, answer(threadId, itemId, answers))
          ),
        ask,
        cancel: Effect.fn("ThreadService.cancel")(function* (threadId: string) {
          if (yield* stopOpening(threadId)) {
            return;
          }
          const session = live.get(threadId);
          const sessionId = (yield* store.get(threadId))?.sessionId;
          // Only a turn the agent is working on is stopped. One that has ended leaves the thread
          // as it is: nothing would take it out of "cancelling" again.
          if (!(session && sessionId) || session.turn === null) {
            return;
          }
          yield* store.update(threadId, { status: "cancelling" });
          // The client answers every permission request still open with `cancelled` (ACP).
          for (const pending of session.pending.values()) {
            yield* Deferred.succeed(pending.decision, CANCELLED);
          }
          // It will not wait for the cards it asked with either.
          yield* letGo(threadId, session);
          // The agent ends the turn itself and answers the prompt with `cancelled`.
          yield* Effect.mapError(session.agent.cancel(sessionId), agentFailure);
          // Unless the turn ended on its own meanwhile, and its end has already been written.
          if (
            session.turn === null &&
            (yield* store.get(threadId))?.status === "cancelling"
          ) {
            yield* store.update(threadId, { status: "idle" });
          }
        }),
        cardsShown: (threadId) => Effect.sync(() => shown.get(threadId) ?? 0),
        create,
        decline,
        delete: Effect.fn("ThreadService.delete")(function* (threadId: string) {
          yield* stopOpening(threadId);
          // Gone first, so that no session starts for it from here on.
          yield* store.remove(threadId);
          shown.delete(threadId);
          // An agent still booting is stopped there, with what its start opened.
          const boot = booting.get(threadId);
          if (boot) {
            yield* Fiber.interrupt(boot);
          }
          yield* stop(threadId);
        }),
        prompt: (input) =>
          detached(opening.withLock(input.threadId, prompt(input))),
        resolvePermission,
        sendQueued: (threadId) => detached(sendQueued(threadId)),
        setAgent,
        setConfigOption: Effect.fn("ThreadService.setConfigOption")(function* (
          threadId: string,
          optionId: string,
          value: string
        ) {
          const current = (yield* store.get(threadId))?.configOptions;
          const chosen = current?.map((o) =>
            o.id === optionId ? { ...o, currentValue: value } : o
          );
          const session = live.get(threadId);
          const sessionId = (yield* store.get(threadId))?.sessionId;
          // No session yet: the choice waits for the one the next prompt starts.
          if (!(session && sessionId)) {
            yield* store.update(threadId, { configOptions: chosen });
            return;
          }
          const parsed = BOOLEAN_VALUES[value] ?? value;
          const response = (yield* Effect.mapError(
            session.agent.setConfigOption(sessionId, optionId, parsed),
            agentFailure
          )) as { configOptions?: unknown } | undefined;
          yield* store.update(threadId, {
            configOptions: mapConfigOptions(response?.configOptions) ?? chosen,
          });
        }),
        setMode: Effect.fn("ThreadService.setMode")(function* (
          threadId: string,
          modeId: string
        ) {
          const session = live.get(threadId);
          const sessionId = (yield* store.get(threadId))?.sessionId;
          if (session && sessionId) {
            yield* Effect.mapError(
              session.agent.setMode(sessionId, modeId),
              agentFailure
            );
          }
          yield* store.update(threadId, { currentModeId: modeId });
        }),
        unqueue: (threadId, id) => detached(unqueue(threadId, id)),
      });
    })
  );
}
