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
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  client,
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
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type WriteTextFileRequest,
} from "@agentclientprotocol/sdk";
import { Deferred, Effect, Predicate, Queue, Result, type Scope } from "effect";
import {
  type AcpError,
  AcpProcessExited,
  AcpRequestError,
  AcpSpawnError,
} from "./errors.ts";
import type { AgentLaunch } from "./sandbox.ts";

export type {
  ContentBlock,
  CreateTerminalRequest,
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
  readonly onPermission: (
    request: RequestPermissionRequest
  ) => Effect.Effect<RequestPermissionResponse>;
  readonly onStderr: (text: string) => Effect.Effect<void>;
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

export interface AcpExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface AcpAgent {
  readonly authenticate: (methodId: string) => Effect.Effect<void, AcpError>;
  readonly cancel: (sessionId: string) => Effect.Effect<void, AcpError>;
  /**
   * Runs `handler` for every `session/update`, one at a time, in the order the agent sent
   * them. Never completes; fork it into the session's scope. Call it once.
   */
  readonly consumeUpdates: (
    handler: (notification: SessionNotification) => Effect.Effect<void>
  ) => Effect.Effect<never>;
  /**
   * Completes once `consumeUpdates` has finished handling every update received so far. A
   * prompt's response can arrive before its last update is processed; wait on this first.
   */
  readonly drained: Effect.Effect<void>;
  /** Completes when the agent process ends, for any reason. */
  readonly exited: Effect.Effect<AcpExit>;
  readonly initialize: Effect.Effect<InitializeResponse, AcpError>;
  readonly loadSession: (
    sessionId: string,
    cwd: string
  ) => Effect.Effect<LoadSessionResponse | undefined, AcpError>;
  readonly newSession: (
    cwd: string,
    meta?: unknown
  ) => Effect.Effect<NewSessionResponse, AcpError>;
  readonly pid: number | undefined;
  readonly prompt: (
    sessionId: string,
    blocks: ContentBlock[]
  ) => Effect.Effect<PromptResponse, AcpError>;
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

type Inbox = SessionNotification | Deferred.Deferred<void>;

const isMarker = (item: Inbox): item is Deferred.Deferred<void> =>
  Deferred.isDeferred(item);

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
  options: { readonly cwd: string; readonly handlers: AcpHandlers }
): Effect.Effect<AcpAgent, AcpSpawnError, Scope.Scope> =>
  Effect.gen(function* () {
    const { handlers } = options;
    const context = yield* Effect.context<never>();
    const run = Effect.runPromiseWith(context);
    const exitSignal = yield* Deferred.make<AcpExit>();
    const inbox = yield* Queue.unbounded<Inbox>();

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

    /** Runs a handler for the SDK; a typed failure becomes the rejection the agent sees. */
    const serve = async <A>(
      effect: Effect.Effect<A, { readonly message: string }>
    ): Promise<A> => {
      const result = await run(Effect.result(effect));
      if (Result.isSuccess(result)) {
        return result.success;
      }
      throw new Error(result.failure.message);
    };

    const app = client({ name: "ultrapaint" })
      .onNotification("session/update", (ctx) => {
        Queue.offerUnsafe(inbox, ctx.params);
      })
      .onRequest("session/request_permission", (ctx) =>
        serve(handlers.onPermission(ctx.params))
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
      // One item at a time, so a marker is reached only after the handler has finished with
      // everything queued before it. A stream would resolve markers a whole chunk early.
      consumeUpdates: (handler) =>
        Effect.forever(
          Effect.flatMap(Queue.take(inbox), (item) =>
            isMarker(item)
              ? Effect.asVoid(Deferred.succeed(item, undefined))
              : handler(item)
          )
        ),
      drained: Effect.gen(function* () {
        // The SDK answers a request synchronously but dispatches notifications through an
        // async handler chain, so updates sent before a response can reach us a few
        // microtasks after it. One macrotask later they have all been queued.
        yield* nextMacrotask;
        const marker = yield* Deferred.make<void>();
        yield* Queue.offer(inbox, marker);
        yield* Deferred.await(marker);
      }),
      exited: Deferred.await(exitSignal),
      initialize: call("initialize", () =>
        agent.request("initialize", {
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
          clientInfo: { name: "ultrapaint", version: "0.1.0" },
          protocolVersion: PROTOCOL_VERSION,
        })
      ),
      loadSession: (sessionId, cwd) =>
        Effect.map(
          call("session/load", () =>
            agent.request("session/load", { cwd, mcpServers: [], sessionId })
          ),
          (loaded) => loaded ?? undefined
        ),
      newSession: (cwd, meta) =>
        call("session/new", () =>
          agent.request("session/new", {
            cwd,
            mcpServers: [],
            ...(meta === undefined ? {} : { _meta: meta }),
          })
        ),
      pid: child.pid,
      prompt: (sessionId, blocks) =>
        call("session/prompt", () =>
          agent.request("session/prompt", { prompt: blocks, sessionId })
        ),
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
