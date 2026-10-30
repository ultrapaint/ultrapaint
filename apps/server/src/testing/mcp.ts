/**
 * Calling the editor's MCP server the way an agent does, for tests: one JSON-RPC request at a
 * time over Streamable HTTP, in the stateless revision both built-in agents speak. There is no
 * session to open: every request says which revision it is and what the client can do.
 */
import { Effect } from "effect";
import { MCP_TOKEN_HEADER } from "../services/mcp/access.ts";

const PROTOCOL = "2026-07-28";
const JSON_RPC = { "content-type": "application/json" };
const ACCEPT = { accept: "application/json, text/event-stream" };

/** What the client says it can do; a test of asking the user says it can answer forms. */
export type ClientCapabilities = Record<string, unknown>;

export const callMcp = (
  port: number,
  token: string | undefined,
  body: { readonly method: string; readonly params?: Record<string, unknown> },
  capabilities: ClientCapabilities = {},
  /** The endpoint as the request spells it; the router reaches it by other spellings too. */
  path = "/mcp"
) => {
  const params = body.params ?? {};
  const meta = (params._meta ?? {}) as Record<string, unknown>;
  // What a call names goes in a header too: a tool or a prompt by its name, a resource by its URI.
  const named = params.name ?? params.uri;
  const name = typeof named === "string" ? { "mcp-name": named } : {};
  return Effect.promise(() =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: body.method,
        params: {
          ...params,
          _meta: {
            ...meta,
            "io.modelcontextprotocol/clientCapabilities": capabilities,
            "io.modelcontextprotocol/clientInfo": {
              name: "test",
              version: "1",
            },
            "io.modelcontextprotocol/protocolVersion": PROTOCOL,
          },
        },
      }),
      headers: {
        ...JSON_RPC,
        ...ACCEPT,
        ...(token ? { [MCP_TOKEN_HEADER]: token } : {}),
        "mcp-method": body.method,
        "mcp-protocol-version": PROTOCOL,
        ...name,
      },
      method: "POST",
    })
  );
};

/** An agent that asks for an older revision opens a session with `initialize`, as Codex does without its flag. */
export const initializeLegacy = (
  port: number,
  token: string,
  protocolVersion: string
) =>
  Effect.promise(() =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
          protocolVersion,
        },
      }),
      headers: { ...JSON_RPC, ...ACCEPT, [MCP_TOKEN_HEADER]: token },
      method: "POST",
    }).then((response) => response.json() as Promise<JsonRpcResult>)
  );

export interface JsonRpcResult {
  readonly error?: { readonly code: number; readonly message: string };
  readonly result: Record<string, unknown>;
}

export interface ToolResult {
  readonly result: {
    readonly content: readonly { readonly text: string }[];
    readonly isError?: boolean;
    readonly structuredContent: Record<string, unknown>;
  };
}

/** A caller of the editor's tools: the name and its arguments, the parsed result back. */
export const toolCaller =
  (port: number, token: string) =>
  (name: string, args: Record<string, unknown>) =>
    Effect.flatMap(
      callMcp(port, token, {
        method: "tools/call",
        params: { arguments: args, name },
      }),
      (response) => Effect.promise(() => response.json() as Promise<ToolResult>)
    );
