/**
 * Calling the editor's MCP server the way an agent does, for tests: one JSON-RPC request at a
 * time over Streamable HTTP, on a session opened with `initialize`.
 */
import { Effect } from "effect";
import { MCP_TOKEN_HEADER } from "../services/mcp/route.ts";

const PROTOCOL = "2025-06-18";
const JSON_RPC = { "content-type": "application/json" };
const ACCEPT = { accept: "application/json, text/event-stream" };

export const callMcp = (
  port: number,
  token: string | undefined,
  body: Record<string, unknown>,
  sessionId?: string
) =>
  Effect.promise(() =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", ...body }),
      headers: {
        ...JSON_RPC,
        ...ACCEPT,
        ...(token ? { [MCP_TOKEN_HEADER]: token } : {}),
        ...(sessionId
          ? { "mcp-protocol-version": PROTOCOL, "mcp-session-id": sessionId }
          : {}),
      },
      method: "POST",
    })
  );

/** Initializes a session and returns its id, so tools can be called on it. */
export const openMcp = (port: number, token: string) =>
  Effect.gen(function* () {
    const response = yield* callMcp(port, token, {
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
        protocolVersion: PROTOCOL,
      },
    });
    const sessionId = response.headers.get("mcp-session-id") ?? undefined;
    yield* callMcp(
      port,
      token,
      { method: "notifications/initialized" },
      sessionId
    );
    return sessionId;
  });

export interface ToolResult {
  readonly result: {
    readonly content: readonly { readonly text: string }[];
    readonly isError?: boolean;
    readonly structuredContent: Record<string, unknown>;
  };
}

/** A caller of the session's tools: the name and its arguments, the parsed result back. */
export const toolCaller =
  (port: number, token: string, sessionId: string | undefined) =>
  (name: string, args: Record<string, unknown>) =>
    Effect.flatMap(
      callMcp(
        port,
        token,
        { method: "tools/call", params: { arguments: args, name } },
        sessionId
      ),
      (response) => Effect.promise(() => response.json() as Promise<ToolResult>)
    );
