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

/** How tokens were made before: the time and a few random bits, which a page could guess. */
const GUESSABLE_TOKEN_RE = /^mcp_[0-9a-z]+_[0-9a-z]{5}$/;

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
    /** Whether this token may call at all, from a thread or from outside. */
    readonly allows: (token: string | undefined) => Effect.Effect<boolean>;
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
    /**
     * Whether the project's token was one made the old, guessable way and was replaced since the
     * server started: the agents outside the editor still send the old one, which is turned away.
     */
    readonly replaced: Effect.Effect<boolean>;
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
      const { host } = yield* ServerConfig;
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
      let replaced = false;

      /**
       * Read from the state directory the first time, written if it is not there, and kept. The
       * file is asked for at the moment of use, like everything else that touches the state:
       * saving an unsaved session moves the directory, and a token read from the old one is
       * still the right token, so only a different file is read again.
       */
      const external = making.withPermits(1)(
        Effect.gen(function* () {
          const file = path.join(yield* storage.stateDir, "mcp-token");
          if (known?.file === file) {
            return known.token;
          }
          const read = yield* Effect.orElseSucceed(
            Effect.map(fs.readFileString(file), (text) => text.trim()),
            () => ""
          );
          // One made the old way is replaced: the agent outside is given the new one to use.
          const existing = GUESSABLE_TOKEN_RE.test(read) ? "" : read;
          if (read && !existing) {
            replaced = true;
            yield* Effect.logWarning(
              "the MCP token was one a website could guess, and is replaced: copy the new one from the settings into agents outside the editor"
            );
          }
          if (existing) {
            // Written before it was kept to its owner; only they need to read it.
            yield* Effect.ignore(fs.chmod(file, 0o600));
          }
          const token = existing || (yield* newToken);
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

      return McpAccess.of({
        // A thread's token is answered from memory; only anything else is compared to the file.
        allows: (token) => {
          if (token === undefined) {
            return Effect.succeed(false);
          }
          if (threadOf(token) !== undefined) {
            return Effect.succeed(true);
          }
          return Effect.map(external, (project) => sameToken(token, project));
        },
        endpoint: Effect.map(listen.get, (port) => ({
          header: MCP_TOKEN_HEADER,
          url: `http://${connectHost(host)}:${port}${MCP_PATH}`,
        })),
        external,
        issue: (threadId) =>
          Effect.acquireRelease(
            Effect.map(newToken, (token) => {
              threads.set(token, threadId);
              return token;
            }),
            (token) => Effect.sync(() => threads.delete(token))
          ),
        replaced: Effect.map(external, () => replaced),
        threadOf,
      });
    })
  );
}
