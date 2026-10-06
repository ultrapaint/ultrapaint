/**
 * The editor's MCP server, on the same port as everything else.
 *
 * Reaching it needs the token the agent was given when its session was created. The server
 * listens on loopback, but a page in the browser is on loopback too, so without a token any
 * website the user has open could call the editor's tools.
 */
import { EDITOR_MCP_SERVER } from "@ultrapaint/contracts/threads";
import { Effect, Layer } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { CallingThread, McpAccess } from "./access.ts";
import { AskUserToolLive } from "./ask-user.ts";
import { FigmaTools, FigmaToolsLive } from "./figma-tools.ts";
import { ScreenshotToolLive } from "./screenshot.ts";
import { SetupTools, SetupToolsLive } from "./setup-tools.ts";
import { EditorTools, EditorToolsLive } from "./tools.ts";

export const MCP_PATH = "/mcp";
export const MCP_TOKEN_HEADER = "x-ultrapaint-token";
const MCP_VERSION_HEADER = "mcp-protocol-version";

/** Turns away anything reaching the MCP endpoint without a token of a live session. */
const TokenGate = HttpRouter.use(
  Effect.fnUntraced(function* (router) {
    const access = yield* McpAccess;
    /** Who has been heard speaking which protocol revision, so each is logged once. */
    const heard = new Set<string>();
    yield* router.addGlobalMiddleware((handler) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!request.url.startsWith(MCP_PATH)) {
          return yield* handler;
        }
        const token = request.headers[MCP_TOKEN_HEADER];
        if (!(yield* access.allows(token))) {
          return HttpServerResponse.text("unknown token", { status: 403 });
        }
        const thread = access.threadOf(token);
        // Which revision an agent negotiated is otherwise invisible, and it decides what the
        // agent can do: only 2026-07-28 asks the user without holding a request open.
        const version = request.headers[MCP_VERSION_HEADER];
        const caller =
          thread === undefined
            ? "an agent outside the editor"
            : `thread ${thread}`;
        if (version !== undefined && !heard.has(`${caller} ${version}`)) {
          heard.add(`${caller} ${version}`);
          yield* Effect.logInfo(`MCP: ${caller} speaks ${version}`);
        }
        // An agent from outside the editor has no thread, and the tools that need one say so.
        return yield* Effect.provideService(handler, CallingThread, thread);
      })
    );
  })
);

const Tools = Layer.mergeAll(
  McpServer.toolkit(EditorTools).pipe(Layer.provide(EditorToolsLive)),
  McpServer.toolkit(FigmaTools).pipe(Layer.provide(FigmaToolsLive)),
  McpServer.toolkit(SetupTools).pipe(Layer.provide(SetupToolsLive)),
  ScreenshotToolLive,
  AskUserToolLive
);

export const McpRoute = Tools.pipe(
  Layer.provide(
    McpServer.layerHttp({
      description:
        "The ultrapaint editor: the project's pages, routes and components.",
      name: EDITOR_MCP_SERVER,
      path: MCP_PATH,
      // The stateless revision first. Codex speaks it only behind a flag that is off by default
      // and otherwise asks for 2025-06-18, so the two before it stay until that changes.
      protocols: [
        McpProtocol.v2026_07_28,
        McpProtocol.v2025_11_25,
        McpProtocol.v2025_06_18,
      ],
      version: "0.1.0",
    })
  ),
  Layer.merge(TokenGate)
);
