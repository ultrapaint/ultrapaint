/**
 * An ACP agent in memory, for tests: an `AcpAgent` whose side of the protocol the test plays.
 * Its handshake answers as a well-behaved agent's does, shaped by an `AgentScript`; each prompt
 * becomes a `ScriptedTurn` the test takes and plays out: session updates, a permission asked, a
 * form, the turn's end or its failure, or nothing until the host cancels it. There is no
 * process and no SDK, and nothing in the prompt decides what happens.
 *
 * It keeps the promises the live agent keeps: updates are handled one at a time in the order
 * they were sent, `drained` waits for those sent so far, and once the agent has exited every
 * call fails with `AcpProcessExited`, as when the process dies. Closing its scope stops it.
 */
import { Deferred, Effect, Queue, type Scope } from "effect";
import type {
  AcpAgent,
  AcpExit,
  AcpHandlers,
  ContentBlock,
  CreateElicitationRequest,
  CreateElicitationResponse,
  InitializeResponse,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
  StopReason,
} from "./acp-agent.ts";
import { type AcpError, AcpProcessExited, AcpRequestError } from "./errors.ts";

type ConfigOptions = NonNullable<NewSessionResponse["configOptions"]>;

/** How the agent answers the host before any prompt. Every field has a default. */
export interface AgentScript {
  /**
   * `initialize` waits for this: an agent slow to start, or, with `Effect.never`, one that
   * never answers.
   */
  readonly booting?: Effect.Effect<void>;
  /** What a new session offers: by default a `model` option, `fast` or `smart`. */
  readonly configOptions?: ConfigOptions;
  /** Whether the agent can resume a stored session (`session/load`). */
  readonly loadSession?: boolean;
  /** The modes a new session offers: by default `ask` and `auto`, in `ask`. */
  readonly modes?: NewSessionResponse["modes"];
  /** What `session/load` replays of the stored conversation before it answers. */
  readonly replay?: readonly SessionUpdate[];
  /** `session/new` is refused until `authenticate` was called, as by an agent not signed in. */
  readonly requiresAuth?: boolean;
}

/** A call the host made, by its ACP method, with what it sent. */
export interface ScriptedCall {
  readonly method: string;
  readonly params: unknown;
}

/** One prompt, as the agent receives it, and what the agent can do within its turn. */
export interface ScriptedTurn {
  /** Completes once the host has asked for the turn to stop (`session/cancel`). */
  readonly cancelled: Effect.Effect<void>;
  /** Puts a question to the user, as an MCP server the agent called does, and waits. */
  readonly elicit: (
    request: CreateElicitationRequest
  ) => Effect.Effect<CreateElicitationResponse>;
  /** Ends the turn: the prompt is answered with `stopReason`, `end_turn` unless said. */
  readonly end: (stopReason?: StopReason) => Effect.Effect<void>;
  /** Answers the prompt with an error whose message is the agent's own explanation. */
  readonly fail: (message: string) => Effect.Effect<void>;
  /** Everything the host sent: what leads the user's text, the text, the attachments. */
  readonly prompt: readonly ContentBlock[];
  /** Asks the user for permission through the host, and waits for the answer. */
  readonly requestPermission: (
    request: Omit<RequestPermissionRequest, "sessionId">
  ) => Effect.Effect<RequestPermissionResponse>;
  /** A chunk of the agent's reply. */
  readonly say: (text: string) => Effect.Effect<void>;
  readonly sessionId: string;
  /** The prompt's text blocks, in order. */
  readonly texts: readonly string[];
  /** A chunk of the agent's thinking. */
  readonly think: (text: string) => Effect.Effect<void>;
  /** Sends a session update, and waits until the host has handled it. */
  readonly update: (update: SessionUpdate) => Effect.Effect<void>;
}

/** The test's hold on the agent. */
export interface ScriptedAgent {
  /** Every call the host made, in order. */
  readonly calls: Effect.Effect<readonly ScriptedCall[]>;
  /** Ends the agent as a crash does, with exit code `code` (1 unless said). */
  readonly exit: (code?: number) => Effect.Effect<void>;
  /** What the host does for the agent: its files and terminals, beyond what a turn asks. */
  readonly host: AcpHandlers;
  /** The next prompt the host sends, waiting for one. */
  readonly nextTurn: Effect.Effect<ScriptedTurn>;
  /** Completes once the agent was stopped: its scope closed. */
  readonly stopped: Effect.Effect<void>;
}

const DEFAULT_OPTIONS: ConfigOptions = [
  {
    category: "model",
    currentValue: "fast",
    id: "model",
    name: "Model",
    options: [
      { name: "Fast", value: "fast" },
      { name: "Smart", value: "smart" },
    ],
    type: "select",
  },
];

const DEFAULT_MODES: NewSessionResponse["modes"] = {
  availableModes: [
    { id: "ask", name: "Ask" },
    { description: "Edits without asking", id: "auto", name: "Auto" },
  ],
  currentModeId: "ask",
};

type Inbox = SessionNotification | Deferred.Deferred<void>;

const isMarker = (item: Inbox): item is Deferred.Deferred<void> =>
  Deferred.isDeferred(item);

/**
 * An agent playing `script` against `handlers`, until the scope closes. `name` prefixes its
 * session ids, so that two agents in one test do not share any.
 */
export const makeScriptedAgent = Effect.fnUntraced(function* (options: {
  readonly handlers: AcpHandlers;
  readonly name: string;
  readonly script?: AgentScript | undefined;
}): Effect.fn.Return<
  { readonly agent: AcpAgent; readonly control: ScriptedAgent },
  never,
  Scope.Scope
> {
  const { handlers, name } = options;
  const script = options.script ?? {};
  const exitSignal = yield* Deferred.make<AcpExit>();
  const stopped = yield* Deferred.make<void>();
  const inbox = yield* Queue.unbounded<Inbox>();
  const turns = yield* Queue.unbounded<ScriptedTurn>();
  const calls: ScriptedCall[] = [];
  const sessionOptions = new Map<string, ConfigOptions>();
  const cancels = new Map<string, Deferred.Deferred<void>>();
  let authenticated = script.requiresAuth !== true;
  let sessions = 0;

  // Stopped, as a process is when its scope closes: whoever waits on its exit hears of it.
  yield* Effect.addFinalizer(() =>
    Effect.andThen(
      Deferred.succeed(stopped, undefined),
      Deferred.succeed(exitSignal, { code: null, signal: "SIGTERM" })
    )
  );

  const processExited = Effect.flatMap(
    Deferred.await(exitSignal),
    ({ code, signal }) =>
      Effect.fail(
        new AcpProcessExited({
          code,
          message: `agent exited (${signal ?? code})`,
          signal,
        })
      )
  );

  /** One call from the host, recorded; once the agent has exited, it fails as the SDK's do. */
  const call = <A>(
    method: string,
    params: unknown,
    answer: Effect.Effect<A, AcpError>
  ): Effect.Effect<A, AcpError> =>
    Effect.suspend(() => {
      calls.push({ method, params });
      return Effect.flatMap(Deferred.isDone(exitSignal), (exited) =>
        exited ? processExited : Effect.raceFirst(answer, processExited)
      );
    });

  const refused = (method: string, message: string) =>
    Effect.fail(new AcpRequestError({ code: -32_000, message, method }));

  /** Waits until the host has handled everything sent so far. */
  const drained = Effect.gen(function* () {
    const marker = yield* Deferred.make<void>();
    yield* Queue.offer(inbox, marker);
    yield* Deferred.await(marker);
  });

  const send = (sessionId: string, update: SessionUpdate) =>
    Effect.andThen(Queue.offer(inbox, { sessionId, update }), drained);

  const chunk = (
    sessionId: string,
    text: string,
    sessionUpdate: "agent_message_chunk" | "agent_thought_chunk"
  ) => send(sessionId, { content: { text, type: "text" }, sessionUpdate });

  const turnOf = (
    sessionId: string,
    prompt: readonly ContentBlock[],
    answer: Deferred.Deferred<PromptResponse, AcpError>,
    cancelled: Deferred.Deferred<void>
  ): ScriptedTurn => ({
    cancelled: Deferred.await(cancelled),
    elicit: (request) => handlers.onElicitation(request),
    end: (stopReason = "end_turn") =>
      Effect.asVoid(Deferred.succeed(answer, { stopReason })),
    fail: (message) =>
      Effect.asVoid(
        Deferred.fail(
          answer,
          new AcpRequestError({
            code: -32_603,
            message,
            method: "session/prompt",
          })
        )
      ),
    prompt,
    requestPermission: (request) =>
      handlers.onPermission({ ...request, sessionId }),
    say: (text) => chunk(sessionId, text, "agent_message_chunk"),
    sessionId,
    texts: prompt.flatMap((block) =>
      block.type === "text" ? [block.text] : []
    ),
    think: (text) => chunk(sessionId, text, "agent_thought_chunk"),
    update: (update) => send(sessionId, update),
  });

  const initialized: InitializeResponse = {
    agentCapabilities: { loadSession: script.loadSession === true },
    authMethods: script.requiresAuth
      ? [{ description: "test", id: "test-auth", name: "Test" }]
      : [],
    protocolVersion: 1,
  };

  const agent: AcpAgent = {
    authenticate: (methodId) =>
      call(
        "authenticate",
        { methodId },
        Effect.sync(() => {
          authenticated = true;
        })
      ),
    cancel: (sessionId) =>
      call(
        "session/cancel",
        { sessionId },
        Effect.suspend(() => {
          const cancelled = cancels.get(sessionId);
          return cancelled
            ? Effect.asVoid(Deferred.succeed(cancelled, undefined))
            : Effect.void;
        })
      ),
    consumeUpdates: (handler) =>
      Effect.forever(
        Effect.flatMap(Queue.take(inbox), (item) =>
          isMarker(item)
            ? Effect.asVoid(Deferred.succeed(item, undefined))
            : handler(item)
        )
      ),
    drained,
    exited: Deferred.await(exitSignal),
    initialize: call(
      "initialize",
      {},
      Effect.as(script.booting ?? Effect.void, initialized)
    ),
    loadSession: (sessionId, cwd, mcpServers) =>
      call(
        "session/load",
        { cwd, mcpServers, sessionId },
        Effect.gen(function* () {
          sessionOptions.set(
            sessionId,
            sessionOptions.get(sessionId) ??
              script.configOptions ??
              DEFAULT_OPTIONS
          );
          // A real agent replays the stored conversation; the host must not show it twice.
          for (const update of script.replay ?? []) {
            yield* Queue.offer(inbox, { sessionId, update });
          }
          return {};
        })
      ),
    newSession: (cwd, session) =>
      call(
        "session/new",
        { cwd, ...session },
        Effect.suspend(() => {
          if (!authenticated) {
            return refused("session/new", "Authentication required");
          }
          sessions += 1;
          const sessionId = `${name}-session-${sessions}`;
          const configOptions = script.configOptions ?? DEFAULT_OPTIONS;
          sessionOptions.set(sessionId, configOptions);
          return Effect.succeed({
            configOptions,
            modes: script.modes === undefined ? DEFAULT_MODES : script.modes,
            sessionId,
          });
        })
      ),
    pid: undefined,
    prompt: (sessionId, blocks) =>
      call(
        "session/prompt",
        { prompt: blocks, sessionId },
        Effect.gen(function* () {
          const answer = yield* Deferred.make<PromptResponse, AcpError>();
          const cancelled = yield* Deferred.make<void>();
          cancels.set(sessionId, cancelled);
          yield* Queue.offer(
            turns,
            turnOf(sessionId, [...blocks], answer, cancelled)
          );
          return yield* Deferred.await(answer).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (cancels.get(sessionId) === cancelled) {
                  cancels.delete(sessionId);
                }
              })
            )
          );
        })
      ),
    setConfigOption: (sessionId, configId, value) =>
      call(
        "session/set_config_option",
        { configId, sessionId, value },
        Effect.sync(() => {
          const configOptions = (sessionOptions.get(sessionId) ?? []).map(
            (option) =>
              option.id === configId
                ? ({ ...option, currentValue: value } as ConfigOptions[number])
                : option
          );
          sessionOptions.set(sessionId, configOptions);
          return { configOptions };
        })
      ),
    setMode: (sessionId, modeId) =>
      call("session/set_mode", { modeId, sessionId }, Effect.void),
  };

  return {
    agent,
    control: {
      calls: Effect.sync(() => [...calls]),
      exit: (code = 1) =>
        Effect.asVoid(Deferred.succeed(exitSignal, { code, signal: null })),
      host: handlers,
      nextTurn: Queue.take(turns),
      stopped: Deferred.await(stopped),
    },
  };
});
