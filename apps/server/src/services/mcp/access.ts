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
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { McpConnection } from "@ultrapaint/contracts/threads";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  type Scope,
  Semaphore,
} from "effect";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { connectHost, ServerConfig } from "../../config.ts";
import { ListenPort } from "../../listen-port.ts";
import { Storage } from "../storage.ts";

/** Where the editor's MCP server is served, and the header a caller's token goes in. */
export const MCP_PATH = "/mcp";
export const MCP_TOKEN_HEADER = "x-ultrapaint-token";

/**
 * A token nobody can guess: 256 bits from the operating system's generator. A page in the
 * browser can try tokens as fast as it can send requests.
 */
const newToken = Effect.sync(
  () => `mcp_${randomBytes(32).toString("base64url")}`
);

/** Whether two tokens are the same, in a time that does not say how much of them matched. */
const sameToken = (given: string, known: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(known);
  return a.length === b.length && timingSafeEqual(a, b);
};

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
    /**
     * Whether this token may call at all, from a thread or from outside. Nobody outside may when
     * the server was started without its MCP server.
     */
    readonly allows: (token: string | undefined) => Effect.Effect<boolean>;
    /**
     * How an agent outside the editor connects, as the settings show it: the address, the header
     * and the project's token, unless the server was started without its MCP server.
     */
    readonly connection: Effect.Effect<McpConnection>;
    /**
     * Where an agent reaches the editor's MCP server, once the server listens, and the header
     * its token goes in.
     */
    readonly endpoint: Effect.Effect<{
      readonly header: string;
      readonly url: string;
    }>;
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
      const { host, mcp: enabled } = yield* ServerConfig;
      const listen = yield* ListenPort;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const threads = new Map<string, string>();
      // Two first calls at once must not each invent a token and each write theirs.
      const making = yield* Semaphore.make(1);
      /** The project's token, as last read or made, and the state directory it belongs to. */
      let known: { readonly file: string; readonly token: string } | null =
        null;

      /**
       * Read from the state directory the first time, written if it is not there, and kept. The
       * file is asked for at the moment of use, like everything else that touches the state:
       * saving an unsaved session moves the directory, and only a different file is read again.
       * The token's file does not move with it, and the token handed out in the unsaved session
       * is still the right one: it is written where the state now is, unless that place already
       * keeps a token of its own.
       */
      const external = making.withPermits(1)(
        Effect.gen(function* () {
          const file = path.join(yield* storage.stateDir, "mcp-token");
          if (known?.file === file) {
            return known.token;
          }
          const existing = yield* Effect.orElseSucceed(
            Effect.map(fs.readFileString(file), (text) => text.trim()),
            () => ""
          );
          if (existing) {
            // Written before it was kept to its owner; only they need to read it.
            yield* Effect.ignore(fs.chmod(file, 0o600));
          }
          const token = existing || known?.token || (yield* newToken);
          if (!existing) {
            // A state directory that cannot be written still gets a token; it lasts until the
            // server stops, which is better than turning away every agent outside the editor.
            yield* writeAtomic(file, `${token}\n`, { mode: 0o600 }).pipe(
              Effect.catch((error) =>
                Effect.logWarning(
                  `the MCP token could not be kept: ${error.message}`
                )
              )
            );
          }
          known = { file, token };
          return token;
        })
      );

      const threadOf = (token: string | undefined) =>
        token === undefined ? undefined : threads.get(token);

      const endpoint = Effect.map(listen.get, (port) => ({
        header: MCP_TOKEN_HEADER,
        url: `http://${connectHost(host)}:${port}${MCP_PATH}`,
      }));

      return McpAccess.of({
        // A thread's token is answered from memory; only anything else is compared to the file.
        allows: (token) => {
          if (token === undefined) {
            return Effect.succeed(false);
          }
          if (threadOf(token) !== undefined) {
            return Effect.succeed(true);
          }
          // Started without its MCP server, the editor gives nobody outside a token: one an
          // earlier run left with the state opens nothing.
          if (!enabled) {
            return Effect.succeed(false);
          }
          return Effect.map(external, (project) => sameToken(token, project));
        },
        connection: Effect.gen(function* () {
          const { header, url } = yield* endpoint;
          const token = enabled ? yield* external : "";
          // No token is replaced on the way: the settings read the field all the same.
          return { enabled, header, replaced: false, token, url };
        }),
        endpoint,
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
