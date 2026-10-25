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

/**
 * Turns away anything reaching the MCP endpoint without a token of a live session. It is given
 * to the MCP routes themselves rather than run on every request: the router finds a route by a
 * path it has decoded and folded (`/MCP`, `//mcp` and `/%6dcp` all reach it), so a gate that
 * read the path for itself would let those through.
 */
const TokenGate = HttpRouter.middleware(
  Effect.gen(function* () {
    const access = yield* McpAccess;
    /** Who has been heard speaking which protocol revision, so each is logged once. */
    const heard = new Set<string>();
    return (handler) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
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
      });
  })
);

const Tools = Layer.mergeAll(
  McpServer.toolkit(EditorTools).pipe(Layer.provide(EditorToolsLive)),
  McpServer.toolkit(FigmaTools).pipe(Layer.provide(FigmaToolsLive)),
  McpServer.toolkit(SetupTools).pipe(Layer.provide(SetupToolsLive)),
  ScreenshotToolLive,
  AskUserToolLive
);

/**
 * What an agent is told when it connects (ADR 0030): the designs lead and the code follows, and
 * how to keep the two linked. An agent in the editor is briefed as well; one outside it reads
 * only this.
 */
export const MCP_INSTRUCTIONS = `ultrapaint keeps this repository's designs: pages, component specs and the design system, in the
designs directory. The design is what the UI looks like and which states it has; the code is what
it does. The design leads, and the code follows it through the handoff tool:
- Before implementing UI, call handoff with action "list" to see what is ready or changed since it
  was implemented, and "read" with its target for the task, which says what changed.
- After implementing a page or a component, call handoff "mark" with the files that implement it.
- When the code has to do something a design cannot show (a permission, a validation, a call),
  or when you change UI in a way the design does not say, call handoff "note" on the page's node.
- Change a design only through the tools (apply_operations, write_design_system), never by
  editing its JSON by hand; change token values in the design system, not in the stylesheet.`;

export const McpRoute = Tools.pipe(
  Layer.provide(
    McpServer.layerHttp({
      description:
        "The ultrapaint editor: the project's pages, routes and components.",
      instructions: MCP_INSTRUCTIONS,
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
    }).pipe(Layer.provide(TokenGate.layer))
  )
);
