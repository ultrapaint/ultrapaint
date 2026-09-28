/**
 * The editor's MCP server, on the same port as everything else.
 *
 * Reaching it needs the token the agent was given when its session was created. The server
 * listens on loopback, but a page in the browser is on loopback too, so without a token any
 * website the user has open could call the editor's tools.
 */
import { EDITOR_MCP_SERVER } from "@ultrapaint/contracts/threads";
import { Effect, Layer } from "effect";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { CallingThread, McpAccess } from "./access.ts";
import { FigmaTools, FigmaToolsLive } from "./figma-tools.ts";
import { ScreenshotToolLive } from "./screenshot.ts";
import { EditorTools, EditorToolsLive } from "./tools.ts";

export const MCP_PATH = "/mcp";
export const MCP_TOKEN_HEADER = "x-ultrapaint-token";

/** Turns away anything reaching the MCP endpoint without a token of a live session. */
const TokenGate = HttpRouter.use(
  Effect.fnUntraced(function* (router) {
    const access = yield* McpAccess;
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
        // An agent from outside the editor has no thread, and the tools that need one say so.
        return yield* Effect.provideService(
          handler,
          CallingThread,
          access.threadOf(token)
        );
      })
    );
  })
);

const Tools = Layer.mergeAll(
  McpServer.toolkit(EditorTools).pipe(Layer.provide(EditorToolsLive)),
  McpServer.toolkit(FigmaTools).pipe(Layer.provide(FigmaToolsLive)),
  ScreenshotToolLive
);

export const McpRoute = Tools.pipe(
  Layer.provide(
    McpServer.layerHttp({
      description:
        "The ultrapaint editor: the project's pages, routes and component palette.",
      name: EDITOR_MCP_SERVER,
      path: MCP_PATH,
      protocols: [
        McpProtocol.v2025_11_25,
        McpProtocol.v2025_06_18,
        McpProtocol.v2025_03_26,
      ],
      version: "0.1.0",
    })
  ),
  Layer.merge(TokenGate)
);
