/**
 * Thin wrapper over `@agentclientprotocol/sdk`. This is the only module in the tool that
 * imports the SDK: it spawns an agent process, wires stdio to an ACP client connection,
 * and exposes typed methods for the handful of calls the editor makes.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  type ClientConnection,
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
import type { AgentConfig } from "@ultrapaint/contracts/threads";

export type {
  ContentBlock,
  InitializeResponse,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
  StopReason,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";

/** Everything the host (our server) does on behalf of the agent. */
export interface AcpHostHandlers {
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onLog: (level: "info" | "warn" | "error", text: string) => void;
  onPermission: (
    request: RequestPermissionRequest
  ) => Promise<RequestPermissionResponse>;
  onUpdate: (notification: SessionNotification) => void;
  readTextFile: (request: ReadTextFileRequest) => Promise<ReadTextFileResponse>;
  terminal: {
    create: (request: CreateTerminalRequest) => Promise<CreateTerminalResponse>;
    output: (request: TerminalOutputRequest) => Promise<TerminalOutputResponse>;
    waitForExit: (
      request: WaitForTerminalExitRequest
    ) => Promise<WaitForTerminalExitResponse>;
    kill: (request: KillTerminalRequest) => Promise<void>;
    release: (request: ReleaseTerminalRequest) => Promise<void>;
  };
  writeTextFile: (request: WriteTextFileRequest) => Promise<void>;
}

export interface AcpAgentProcess {
  authenticate: (methodId: string) => Promise<void>;
  cancel: (sessionId: string) => Promise<void>;
  readonly capabilities: InitializeResponse | null;
  close: () => void;
  initialize: () => Promise<InitializeResponse>;
  loadSession: (
    sessionId: string,
    cwd: string
  ) => Promise<LoadSessionResponse | undefined>;
  newSession: (cwd: string) => Promise<NewSessionResponse>;
  readonly pid: number | undefined;
  prompt: (
    sessionId: string,
    blocks: ContentBlock[]
  ) => Promise<PromptResponse>;
  setConfigOption: (
    sessionId: string,
    configId: string,
    value: string | boolean
  ) => Promise<unknown>;
  setMode: (sessionId: string, modeId: string) => Promise<void>;
}

/**
 * Spawns the agent described by a launch configuration and returns a typed handle. The
 * configuration is data only: command, args and env. Nothing here knows which agent runs.
 */
export const spawnAgent = (
  config: AgentConfig,
  options: { cwd: string; handlers: AcpHostHandlers }
): AcpAgentProcess => {
  const { handlers } = options;
  const child: ChildProcess = spawn(config.command, [...config.args], {
    cwd: options.cwd,
    env: { ...process.env, ...config.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr?.on("data", (d) => handlers.onLog("info", String(d).trimEnd()));
  child.on("exit", (code, signal) => handlers.onExit(code, signal));
  child.on("error", (error) =>
    handlers.onLog("error", `agent process error: ${error.message}`)
  );

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>
  );

  const app = client({ name: "ultrapaint" })
    .onNotification("session/update", (ctx) => handlers.onUpdate(ctx.params))
    .onRequest("session/request_permission", (ctx) =>
      handlers.onPermission(ctx.params)
    )
    .onRequest("fs/read_text_file", (ctx) => handlers.readTextFile(ctx.params))
    .onRequest("fs/write_text_file", async (ctx) => {
      await handlers.writeTextFile(ctx.params);
      return {};
    })
    .onRequest("terminal/create", (ctx) => handlers.terminal.create(ctx.params))
    .onRequest("terminal/output", (ctx) => handlers.terminal.output(ctx.params))
    .onRequest("terminal/wait_for_exit", (ctx) =>
      handlers.terminal.waitForExit(ctx.params)
    )
    .onRequest("terminal/kill", async (ctx) => {
      await handlers.terminal.kill(ctx.params);
      return {};
    })
    .onRequest("terminal/release", async (ctx) => {
      await handlers.terminal.release(ctx.params);
      return {};
    });

  const connection: ClientConnection = app.connect(stream);
  let capabilities: InitializeResponse | null = null;

  return {
    async authenticate(methodId) {
      await connection.agent.request("authenticate", { methodId });
    },
    cancel(sessionId) {
      return connection.agent.notify("session/cancel", { sessionId });
    },
    get capabilities() {
      return capabilities;
    },
    close() {
      connection.close();
      if (child.pid && child.exitCode === null) {
        child.kill("SIGTERM");
      }
    },
    async initialize() {
      capabilities = await connection.agent.request("initialize", {
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: "ultrapaint", version: "0.1.0" },
        protocolVersion: PROTOCOL_VERSION,
      });
      return capabilities;
    },
    async loadSession(sessionId, cwd) {
      return (
        (await connection.agent.request("session/load", {
          cwd,
          mcpServers: [],
          sessionId,
        })) ?? undefined
      );
    },
    newSession(cwd) {
      return connection.agent.request("session/new", { cwd, mcpServers: [] });
    },
    get pid() {
      return child.pid;
    },
    prompt(sessionId, blocks) {
      return connection.agent.request("session/prompt", {
        prompt: blocks,
        sessionId,
      });
    },
    setConfigOption(sessionId, configId, value) {
      const params =
        typeof value === "boolean"
          ? { configId, sessionId, type: "boolean" as const, value }
          : { configId, sessionId, value };
      return connection.agent.request("session/set_config_option", params);
    },
    async setMode(sessionId, modeId) {
      await connection.agent.request("session/set_mode", { modeId, sessionId });
    },
  };
};
