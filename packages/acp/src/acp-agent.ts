/**
 * Effect wrapper over `@agentclientprotocol/sdk`. This is the only module in the tool that
 * imports the SDK. It owns the agent process for the lifetime of a scope, turns the SDK's
 * promise calls into effects with typed errors, and delivers session updates in order.
 *
 * Nothing outside this file sees an SDK value other than the protocol's plain data types, so
 * the implementation can be replaced without touching the thread service.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  client,
  type InitializeRequest,
  type InitializeResponse,
  type KillTerminalRequest,
  type LoadSessionResponse,
  type NewSessionResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type ReleaseTerminalRequest,
  RequestError,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type WriteTextFileRequest,
} from "@agentclientprotocol/sdk";
import { Deferred, Effect, Predicate, Result, type Scope } from "effect";
import {
  type AcpError,
  AcpProcessExited,
  AcpRequestError,
  AcpSpawnError,
} from "./errors.ts";
import type { AgentLaunch } from "./sandbox.ts";
import { makeUpdates, type Updates } from "./updates.ts";

export type {
  ContentBlock,
  CreateElicitationRequest,
  CreateElicitationResponse,
  CreateTerminalRequest,
  InitializeRequest,
  InitializeResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  ReadTextFileRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
  StopReason,
  ToolCallUpdate,
  WriteTextFileRequest,
} from "@agentclientprotocol/sdk";

/**
 * What the host does on behalf of the agent. A failing handler is reported to the agent as a
 * JSON-RPC error carrying the failure's message.
 */
export interface AcpHandlers {
  /**
   * Questions for the user from an MCP server the agent called, waited on within the turn. The
   * editor says it draws forms; anything it cannot draw it declines.
   */
  readonly onElicitation: (
    request: CreateElicitationRequest
  ) => Effect.Effect<CreateElicitationResponse>;
  readonly onPermission: (
    request: RequestPermissionRequest
  ) => Effect.Effect<RequestPermissionResponse>;
  readonly onStderr: (text: string) => Effect.Effect<void>;
  /**
   * Every `session/update`, one at a time, in the order the agent sent it; a replay of a
   * session reopened, which the host has already, is not among them.
   */
  readonly onUpdate: (notification: SessionNotification) => Effect.Effect<void>;
  readonly readTextFile: (
    request: ReadTextFileRequest
  ) => Effect.Effect<ReadTextFileResponse, { readonly message: string }>;
  readonly terminal: {
    readonly create: (
      request: CreateTerminalRequest
    ) => Effect.Effect<CreateTerminalResponse, { readonly message: string }>;
    readonly kill: (request: KillTerminalRequest) => Effect.Effect<void>;
    readonly output: (
      request: TerminalOutputRequest
    ) => Effect.Effect<TerminalOutputResponse, { readonly message: string }>;
    readonly release: (request: ReleaseTerminalRequest) => Effect.Effect<void>;
    readonly waitForExit: (
      request: WaitForTerminalExitRequest
    ) => Effect.Effect<
      WaitForTerminalExitResponse,
      { readonly message: string }
    >;
  };
  readonly writeTextFile: (
    request: WriteTextFileRequest
  ) => Effect.Effect<void, { readonly message: string }>;
}

/** An MCP server the agent may call, as ACP describes one. */
export interface McpServerConfig {
  readonly headers: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly name: string;
  readonly type: "http";
  readonly url: string;
}

/** What a session is opened with: the MCP servers it may call, and the agent's own `_meta`. */
export interface SessionOptions {
  readonly mcpServers?: readonly McpServerConfig[];
  readonly meta?: unknown;
}

/** What an agent says of a session it opened again: its options and modes, where it has any. */
export type SessionState = Pick<LoadSessionResponse, "configOptions" | "modes">;

export interface AcpExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface AcpAgent {
  readonly authenticate: (methodId: string) => Effect.Effect<void, AcpError>;
  readonly cancel: (sessionId: string) => Effect.Effect<void, AcpError>;
  /** Completes when the agent process ends, for any reason. */
  readonly exited: Effect.Effect<AcpExit>;
  /** The handshake; what the agent said of itself decides what `reopen` does. */
  readonly initialize: Effect.Effect<InitializeResponse, AcpError>;
  readonly newSession: (
    cwd: string,
    options?: SessionOptions
  ) => Effect.Effect<NewSessionResponse, AcpError>;
  readonly pid: number | undefined;
  /** A turn: over once the agent answered and every update it sent meanwhile was handled. */
  readonly prompt: (
    sessionId: string,
    blocks: ContentBlock[]
  ) => Effect.Effect<PromptResponse, AcpError>;
  /**
   * Opens a stored session again: resumed where the agent can (`session/resume`), else loaded
   * (`session/load`) with its replay kept from the host, which has it already. Null where the
   * agent can do neither, or before `initialize`.
   */
  readonly reopen: (
    sessionId: string,
    cwd: string,
    options?: SessionOptions
  ) => Effect.Effect<SessionState | null, AcpError>;
  readonly setConfigOption: (
    sessionId: string,
    configId: string,
    value: string | boolean
  ) => Effect.Effect<unknown, AcpError>;
  readonly setMode: (
    sessionId: string,
    modeId: string
  ) => Effect.Effect<void, AcpError>;
}

/**
 * What the editor says of itself when an agent starts: who it is, and what it does for the
 * agent. Every adapter sends this, so a scripted agent sees what a real one would.
 */
export const initializeRequest = (
  clientVersion: string
): InitializeRequest => ({
  clientCapabilities: {
    elicitation: { form: {} },
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
  },
  clientInfo: { name: "ultrapaint", version: clientVersion },
  protocolVersion: PROTOCOL_VERSION,
});

/** How a stored session is opened again, by what the agent said it can do; null when it cannot. */
export const reopening = (
  init: InitializeResponse | undefined
): "resume" | "load" | null => {
  const capabilities = init?.agentCapabilities;
  if (capabilities?.sessionCapabilities?.resume) {
    return "resume";
  }
  return capabilities?.loadSession === true ? "load" : null;
};

/**
 * A call whose answer the agent sends after updates of its own (a prompt's turn): answered once
 * they are handled too, whether it succeeded or not, so the host sees the turn whole. Not when
 * interrupted: the session is closing, and its updates with it.
 */
export const settling =
  (updates: Updates) =>
  <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    effect.pipe(
      Effect.tap(() => updates.settled),
      Effect.tapError(() => updates.settled)
    );

/** `_meta` on a request, when there is any. */
export const withMeta = (meta: unknown) =>
  meta === undefined ? {} : { _meta: meta as Record<string, unknown> };

const describe = (error: unknown): { code: number | null; message: string } => {
  if (!Predicate.isObject(error)) {
    return { code: null, message: String(error) };
  }
  const { code, data, message } = error as Record<string, unknown>;
  // ACP errors carry the agent's own explanation in `data`; prefer it to "Internal error".
  const detail = Predicate.isObject(data)
    ? (data as Record<string, unknown>).message
    : undefined;
  let text = String(error);
  if (Predicate.isString(detail)) {
    text = detail;
  } else if (Predicate.isString(message)) {
    text = message;
  }
  return { code: Predicate.isNumber(code) ? code : null, message: text };
};

const nextMacrotask = Effect.callback<void>((resume) => {
  const handle = setImmediate(() => resume(Effect.void));
  return Effect.sync(() => clearImmediate(handle));
});

const startProcess = (launch: AgentLaunch, cwd: string) =>
  Effect.callback<ChildProcess, AcpSpawnError>((resume) => {
    const child = spawn(launch.command, [...launch.args], {
      cwd,
      // Its own process group: `npx` wrappers start the real agent as a grandchild.
      detached: process.platform !== "win32",
      env: { ...process.env, ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.once("spawn", () => resume(Effect.succeed(child)));
    child.once("error", (error) =>
      resume(
        Effect.fail(
          new AcpSpawnError({ command: launch.command, message: error.message })
        )
      )
    );
  });

const signalGroup = (child: ChildProcess, signal: NodeJS.Signals) =>
  Effect.sync(() => {
    if (child.pid === undefined || child.exitCode !== null) {
      return;
    }
    try {
      if (process.platform === "win32") {
        child.kill(signal);
      } else {
        process.kill(-child.pid, signal);
      }
    } catch {
      // The group is already gone.
    }
  });

/**
 * Starts the agent described by a launch: command, args and env, already wrapped in whatever
 * confines it. The process and the connection end with the surrounding scope.
 */
export const spawnAcpAgent = (
  launch: AgentLaunch,
  options: {
    /** The editor's own version, which `initialize` tells the agent. */
    readonly clientVersion: string;
    readonly cwd: string;
    readonly handlers: AcpHandlers;
  }
): Effect.Effect<AcpAgent, AcpSpawnError, Scope.Scope> =>
  Effect.gen(function* () {
    const { handlers } = options;
    const context = yield* Effect.context<never>();
    const run = Effect.runPromiseWith(context);
    const exitSignal = yield* Deferred.make<AcpExit>();
    // The SDK answers a request synchronously but dispatches notifications through an async
    // handler chain, so updates sent before a response can reach us a few microtasks after it.
    // One macrotask later they have all been received.
    const updates = yield* makeUpdates(handlers.onUpdate, nextMacrotask);
    let initialized: InitializeResponse | undefined;

    const child = yield* Effect.acquireRelease(
      startProcess(launch, options.cwd),
      (process) =>
        signalGroup(process, "SIGTERM").pipe(
          Effect.andThen(
            Deferred.await(exitSignal).pipe(Effect.timeoutOption("3 seconds"))
          ),
          Effect.andThen(signalGroup(process, "SIGKILL"))
        )
    );
    child.once("exit", (code, signal) => {
      Deferred.doneUnsafe(exitSignal, Effect.succeed({ code, signal }));
    });
    child.stderr?.on("data", (chunk) => {
      run(handlers.onStderr(String(chunk).trimEnd())).catch(() => undefined);
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>
    );

    /**
     * Runs a handler for the SDK; a typed failure becomes the rejection the agent sees, with its
     * reason: a plain error reaches the agent as "Internal error" and nothing else, and a write
     * refused outside the designs directory has to say why for the agent to do otherwise.
     */
    const serve = async <A>(
      effect: Effect.Effect<A, { readonly message: string }>
    ): Promise<A> => {
      const result = await run(Effect.result(effect));
      if (Result.isSuccess(result)) {
        return result.success;
      }
      throw RequestError.internalError(undefined, result.failure.message);
    };

    const app = client({ name: "ultrapaint" })
      .onNotification("session/update", (ctx) => {
        updates.receive(ctx.params);
      })
      .onRequest("session/request_permission", (ctx) =>
        serve(handlers.onPermission(ctx.params))
      )
      .onRequest("elicitation/create", (ctx) =>
        serve(handlers.onElicitation(ctx.params))
      )
      .onRequest("fs/read_text_file", (ctx) =>
        serve(handlers.readTextFile(ctx.params))
      )
      .onRequest("fs/write_text_file", (ctx) =>
        serve(Effect.as(handlers.writeTextFile(ctx.params), {}))
      )
      .onRequest("terminal/create", (ctx) =>
        serve(handlers.terminal.create(ctx.params))
      )
      .onRequest("terminal/output", (ctx) =>
        serve(handlers.terminal.output(ctx.params))
      )
      .onRequest("terminal/wait_for_exit", (ctx) =>
        serve(handlers.terminal.waitForExit(ctx.params))
      )
      .onRequest("terminal/kill", (ctx) =>
        serve(Effect.as(handlers.terminal.kill(ctx.params), {}))
      )
      .onRequest("terminal/release", (ctx) =>
        serve(Effect.as(handlers.terminal.release(ctx.params), {}))
      );

    const connection = yield* Effect.acquireRelease(
      Effect.sync(() => app.connect(stream)),
      (open) => Effect.sync(() => open.close())
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

    /**
     * One SDK call with a typed failure. When the process dies the SDK rejects the pending
     * call slightly before Node reports the exit, so a failure waits a moment for the exit and
     * reports that instead: "agent exited" is the truth, "connection closed" a symptom.
     */
    const call = <A>(method: string, send: () => Promise<A>) =>
      Effect.tryPromise({
        catch: (error) => new AcpRequestError({ method, ...describe(error) }),
        try: send,
      }).pipe(
        Effect.catch((error) =>
          Deferred.await(exitSignal).pipe(
            Effect.timeoutOption("250 millis"),
            Effect.flatMap(
              (exit): Effect.Effect<never, AcpError> =>
                exit._tag === "Some" ? processExited : Effect.fail(error)
            )
          )
        ),
        Effect.raceFirst(processExited),
        Effect.withSpan(`AcpAgent.${method}`)
      );

    const { agent } = connection;

    return {
      authenticate: (methodId) =>
        Effect.asVoid(
          call("authenticate", () =>
            agent.request("authenticate", { methodId })
          )
        ),
      cancel: (sessionId) =>
        call("session/cancel", () =>
          agent.notify("session/cancel", { sessionId })
        ),
      exited: Deferred.await(exitSignal),
      initialize: call("initialize", () =>
        agent.request("initialize", initializeRequest(options.clientVersion))
      ).pipe(
        Effect.tap((response) =>
          Effect.sync(() => {
            initialized = response;
          })
        )
      ),
      newSession: (cwd, session) =>
        call("session/new", () =>
          agent.request("session/new", {
            cwd,
            mcpServers: [...(session?.mcpServers ?? [])],
            ...withMeta(session?.meta),
          })
        ),
      pid: child.pid,
      prompt: (sessionId, blocks) =>
        call("session/prompt", () =>
          agent.request("session/prompt", { prompt: blocks, sessionId })
        ).pipe(settling(updates)),
      reopen: (sessionId, cwd, session) =>
        Effect.suspend(() => {
          const request = {
            cwd,
            mcpServers: [...(session?.mcpServers ?? [])],
            sessionId,
            ...withMeta(session?.meta),
          };
          switch (reopening(initialized)) {
            case "resume":
              return Effect.map(
                call("session/resume", () =>
                  agent.request("session/resume", request)
                ),
                (resumed): SessionState => resumed ?? {}
              );
            case "load":
              return Effect.map(
                updates.dropping(
                  call("session/load", () =>
                    agent.request("session/load", request)
                  )
                ),
                (loaded): SessionState => loaded ?? {}
              );
            default:
              return Effect.succeed(null);
          }
        }),
      setConfigOption: (sessionId, configId, value) =>
        call("session/set_config_option", () =>
          agent.request(
            "session/set_config_option",
            typeof value === "boolean"
              ? { configId, sessionId, type: "boolean" as const, value }
              : { configId, sessionId, value }
          )
        ),
      setMode: (sessionId, modeId) =>
        Effect.asVoid(
          call("session/set_mode", () =>
            agent.request("session/set_mode", { modeId, sessionId })
          )
        ),
    } satisfies AcpAgent;
  });
