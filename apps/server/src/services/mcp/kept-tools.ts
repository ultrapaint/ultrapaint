/**
 * The tools the editor's MCP server lists, kept in the user's directory as it starts
 * (`~/.ultrapaint/mcp-tools.json`, ADR 0083). `ultrapaint mcp` started in a folder with no project
 * offers them, a hub's folder among them: an agent is given the tools before any call has named
 * its project, by a folder or a link. Any server's list will do: the tools are the same for every
 * project of the same version. Beside them, the instructions a server gives at `initialize`, which
 * the command gives in a project's folder before that project's server has started (ADR 0164).
 */
import {
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { ServerConfig } from "../../config.ts";
import { eventMessages, KeptTools, RelayUnreachable } from "../../mcp-relay.ts";
import { McpAccess } from "./access.ts";
import { MCP_INSTRUCTIONS } from "./route.ts";

export const KEPT_TOOLS_FILE = "mcp-tools.json";

/** The kept file: the tools a server listed, and what it says at `initialize`. */
const KeptToolsFile = Schema.fromJsonString(KeptTools);
export const decodeKeptTools = Schema.decodeUnknownOption(KeptToolsFile);

/** The revision the server is asked in: stateless, a request needing no session. */
const STATELESS = "2026-07-28";

/** The server's answer to `tools/list`, whose tools are kept. */
const Listed = Schema.fromJsonString(Schema.Struct({ result: KeptTools }));
const decodeListed = Schema.decodeUnknownOption(Listed);

/** Once the server answers: its tools listed, as an agent is given them, and kept. */
export const KeepToolList = Layer.effectDiscard(
  Effect.gen(function* () {
    const { mcp, userDir } = yield* ServerConfig;
    if (!mcp) {
      return;
    }
    const access = yield* McpAccess;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const writeAtomic = makeWriteAtomic(fs, path);

    const keep = Effect.gen(function* () {
      const { header, url } = yield* access.endpoint;
      const token = yield* access.external;
      const unreachable = () =>
        new RelayUnreachable({ message: `Nothing answers at ${url}` });
      const text = yield* Effect.tryPromise({
        catch: unreachable,
        try: (signal) =>
          fetch(url, {
            body: JSON.stringify({
              id: 1,
              jsonrpc: "2.0",
              method: "tools/list",
              params: {
                _meta: {
                  "io.modelcontextprotocol/clientCapabilities": {},
                  "io.modelcontextprotocol/clientInfo": {
                    name: "ultrapaint",
                    version: "1",
                  },
                  "io.modelcontextprotocol/protocolVersion": STATELESS,
                },
              },
            }),
            headers: {
              accept: "application/json, text/event-stream",
              "content-type": "application/json",
              [header]: token,
              "mcp-method": "tools/list",
              "mcp-protocol-version": STATELESS,
            },
            method: "POST",
            signal,
          }).then((response) => response.text()),
      });
      // A JSON answer, or the same as an event.
      const answers = [
        text,
        ...(yield* eventMessages(Stream.make(text)).pipe(Stream.runCollect)),
      ];
      const listed = answers.find((answer) =>
        Option.isSome(decodeListed(answer))
      );
      const decoded = Option.flatMap(
        Option.fromNullishOr(listed),
        decodeListed
      );
      if (Option.isNone(decoded)) {
        return yield* Effect.logWarning(
          "the MCP tools could not be listed to keep"
        );
      }
      const kept = {
        instructions: MCP_INSTRUCTIONS,
        tools: decoded.value.result.tools,
      };
      yield* writeAtomic(
        path.join(userDir, KEPT_TOOLS_FILE),
        `${JSON.stringify(kept)}\n`
      );
    });
    // A list not kept costs only an agent in a folder with no project, which goes without tools.
    yield* Effect.forkScoped(Effect.ignore(keep, { log: true }));
  })
);
