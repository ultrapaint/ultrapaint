/**
 * An ACP agent in memory, for tests: an `AcpAgent` whose side of the protocol the test plays.
 * Its handshake answers as a well-behaved agent's does, shaped by an `AgentScript`; each prompt
 * becomes a `ScriptedTurn` the test takes and plays out: session updates, a permission asked, a
 * form, the turn's end or its failure, or nothing until the host cancels it. There is no
 * process and no SDK, and nothing in the prompt decides what happens.
 *
 * It keeps the promises the live agent keeps (`updates.ts`): updates are handled one at a time in
 * the order they were sent, a turn's `update` and the prompt's answer wait until the host has
 * handled what came before, a session loaded replays what the host does not hear again, and
 * once the agent has exited every call fails with `AcpProcessExited`, as when the process dies.
 * Closing its scope stops it.
 */
import { Deferred, Effect, Queue, type Scope } from "effect";
import {
  type AcpAgent,
  type AcpExit,
  type AcpHandlers,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type InitializeResponse,
  initializeRequest,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionState,
  type SessionUpdate,
  type StopReason,
  settling,
  withMeta,
} from "./acp-agent.ts";
import { type AcpError, AcpProcessExited, AcpRequestError } from "./errors.ts";
import { BASELINE, negotiated } from "./negotiated.ts";
import { makeUpdates } from "./updates.ts";

type ConfigOptions = NonNullable<NewSessionResponse["configOptions"]>;

/** How the agent answers the host before any prompt. Every field has a default. */
export interface AgentScript {
  /** The ways it says it signs in; with `requiresAuth`, one of its own by default. */
  readonly authMethods?: InitializeResponse["authMethods"];
  /**
   * `initialize` waits for this: an agent slow to start, or, with `Effect.never`, one that
   * never answers.
   */
  readonly booting?: Effect.Effect<void>;
  /**
   * What it says it can do, over what a well-behaved agent says: it takes pictures and files
   * embedded in a prompt, and reaches an MCP server over http.
   */
  readonly capabilities?: InitializeResponse["agentCapabilities"];
  /** What a new session offers: by default a `model` option, `fast` or `smart`. */
  readonly configOptions?: ConfigOptions;
  /** Whether the agent can load a stored session (`session/load`), replaying it. */
  readonly loadSession?: boolean;
  /** The modes a new session offers: by default `ask` and `auto`, in `ask`. */
  readonly modes?: NewSessionResponse["modes"];
  /** What `session/load` replays of the stored conversation before it answers. */
  readonly replay?: readonly SessionUpdate[];
  /** `session/new` is refused until `authenticate` was called, as by an agent not signed in. */
  readonly requiresAuth?: boolean;
  /** Whether the agent can resume a stored session without replaying it (`session/resume`). */
  readonly resume?: boolean;
}

/** A call the host made, by its ACP method, with what it sent. */
export interface ScriptedCall {
  readonly method: string;
  readonly params: unknown;
}

/** One prompt, as the agent receives it, and what the agent can do within its turn. */
export interface ScriptedTurn {
  /** Ends the turn with this answer: why it stopped, and what it spent. */
  readonly answer: (response: PromptResponse) => Effect.Effect<void>;
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

/**
 * An agent playing `script` against `handlers`, until the scope closes. `name` prefixes its
 * session ids, so that two agents in one test do not share any.
 */
export const makeScriptedAgent = Effect.fnUntraced(function* (options: {
  /** The editor's version, which `initialize` tells the agent. */
  readonly clientVersion: string;
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
  const updates = yield* makeUpdates(handlers.onUpdate);
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

  /** An update, sent and handled. */
  const send = (sessionId: string, update: SessionUpdate) =>
    Effect.andThen(
      Effect.sync(() => updates.receive({ sessionId, update })),
      updates.settled
    );

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
    answer: (response) => Effect.asVoid(Deferred.succeed(answer, response)),
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
    agentCapabilities: {
      loadSession: script.loadSession === true,
      // What a well-behaved agent takes: pictures, files embedded, an MCP server over http.
      mcpCapabilities: { http: true },
      promptCapabilities: { embeddedContext: true, image: true },
      ...(script.resume === true && {
        sessionCapabilities: { resume: {} },
      }),
      ...script.capabilities,
    },
    authMethods:
      script.authMethods ??
      (script.requiresAuth
        ? [{ description: "test", id: "test-auth", name: "Test" }]
        : []),
    protocolVersion: 1,
  };
  /** What the agent said in `initialize`, once it has. */
  let known = BASELINE;

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
    exited: Deferred.await(exitSignal),
    initialize: call(
      "initialize",
      initializeRequest(options.clientVersion),
      Effect.andThen(
        script.booting ?? Effect.void,
        Effect.sync(() => {
          known = negotiated(initialized);
          return initialized;
        })
      )
    ),
    newSession: (cwd, session) =>
      call(
        "session/new",
        {
          cwd,
          mcpServers: [...(session?.mcpServers ?? [])],
          ...withMeta(session?.meta),
        },
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
      ).pipe(settling(updates)),
    reopen: (sessionId, cwd, session) =>
      Effect.suspend(() => {
        const way = known.reopen;
        if (way === null) {
          return Effect.succeed(null);
        }
        const params = {
          cwd,
          mcpServers: [...(session?.mcpServers ?? [])],
          sessionId,
          ...withMeta(session?.meta),
        };
        const reopened = Effect.sync((): SessionState => {
          sessionOptions.set(
            sessionId,
            sessionOptions.get(sessionId) ??
              script.configOptions ??
              DEFAULT_OPTIONS
          );
          return {};
        });
        if (way === "resume") {
          return call("session/resume", params, reopened);
        }
        // A session loaded replays the stored conversation, which the host has already.
        const replay = Effect.sync(() => {
          for (const update of script.replay ?? []) {
            updates.receive({ sessionId, update });
          }
        });
        return updates.dropping(
          call("session/load", params, Effect.andThen(replay, reopened))
        );
      }),
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
