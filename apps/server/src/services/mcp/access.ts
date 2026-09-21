/**
 * Who may call the editor's MCP server.
 *
 * Two kinds of caller. An agent of a thread is given a token when its session opens and it is
 * revoked when the session ends; that token also says which thread is calling, which is what
 * lets the canvas show what the agent is doing. An agent outside the editor — one in a terminal,
 * another editor — uses the project's own token, which the user copies from the settings and
 * which lasts as long as the project's state does.
 *
 * The server listens on loopback, but so does every page in the browser: without a token any
 * website the user has open could reach the editor's tools.
 */
import { Context, Effect, FileSystem, Layer, Path, type Scope } from "effect";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { makeId } from "../../ids.ts";
import { Storage } from "../storage.ts";

/**
 * The thread whose agent is making the call being served. The gate puts it there once it has
 * recognised the token, so a tool knows who is asking without every tool taking a token. An
 * agent from outside has no thread, and the tools that need one say so.
 */
export const CallingThread: Context.Reference<string | undefined> =
  Context.Reference<string | undefined>("ultrapaint/server/CallingThread", {
    defaultValue: (): string | undefined => undefined,
  });

export class McpAccess extends Context.Service<
  McpAccess,
  {
    /** Whether this token may call at all, from a thread or from outside. */
    readonly allows: (token: string | undefined) => Effect.Effect<boolean>;
    /** The project's own token, for agents outside the editor. Made once, kept with the state. */
    readonly external: Effect.Effect<string>;
    /** A token for this thread, valid until the surrounding scope closes. */
    readonly issue: (
      threadId: string
    ) => Effect.Effect<string, never, Scope.Scope>;
    /** The thread a token belongs to; nothing for the project's own token. */
    readonly threadOf: (token: string | undefined) => string | undefined;
  }
>()("ultrapaint/server/McpAccess") {
  static readonly layer = Layer.effect(
    McpAccess,
    Effect.gen(function* () {
      const storage = yield* Storage;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const threads = new Map<string, string>();
      const newToken = makeId("mcp");

      /**
       * Read from the state directory, written the first time it is asked for. Asked for at the
       * moment of use, like everything else that touches the state: saving an unsaved session
       * moves the directory while the server runs.
       */
      const external = Effect.gen(function* () {
        const file = path.join(yield* storage.stateDir, "mcp-token");
        const existing = yield* Effect.orElseSucceed(
          Effect.map(fs.readFileString(file), (text) => text.trim()),
          () => ""
        );
        if (existing) {
          return existing;
        }
        const token = yield* newToken;
        yield* Effect.orDie(writeAtomic(file, `${token}\n`));
        return token;
      });

      const threadOf = (token: string | undefined) =>
        token === undefined ? undefined : threads.get(token);

      return McpAccess.of({
        allows: (token) =>
          token === undefined
            ? Effect.succeed(false)
            : Effect.map(
                external,
                (project) => threadOf(token) !== undefined || token === project
              ),
        external,
        issue: (threadId) =>
          Effect.acquireRelease(
            Effect.map(newToken, (token) => {
              threads.set(token, threadId);
              return token;
            }),
            (token) => Effect.sync(() => threads.delete(token))
          ),
        threadOf,
      });
    })
  );
}
