/**
 * Who may call the editor's MCP server. One token per agent session, handed to the agent when
 * its session is created and revoked when the session ends.
 *
 * The server listens on loopback, but so does every page in the browser: without a token any
 * website the user has open could reach the editor's tools. The token also says which thread is
 * calling, which is what lets the canvas attribute what the tools do.
 */
import { Context, Effect, Layer, type Scope } from "effect";
import { makeId } from "../../ids.ts";

export class McpAccess extends Context.Service<
  McpAccess,
  {
    /** A token for this thread, valid until the surrounding scope closes. */
    readonly issue: (
      threadId: string
    ) => Effect.Effect<string, never, Scope.Scope>;
    /** The thread a token belongs to, or nothing when it is unknown or expired. */
    readonly threadOf: (token: string | undefined) => string | undefined;
  }
>()("ultrapaint/server/McpAccess") {
  static readonly layer = Layer.sync(McpAccess, () => {
    const threads = new Map<string, string>();
    const newToken = makeId("mcp");
    return McpAccess.of({
      issue: (threadId) =>
        Effect.acquireRelease(
          Effect.map(newToken, (token) => {
            threads.set(token, threadId);
            return token;
          }),
          (token) => Effect.sync(() => threads.delete(token))
        ),
      threadOf: (token) =>
        token === undefined ? undefined : threads.get(token),
    });
  });
}
