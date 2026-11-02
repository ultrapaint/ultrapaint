/**
 * The editor's MCP server, on the same port as everything else.
 *
 * Reaching it needs the token the agent was given when its session was created. The server
 * listens on loopback, but a page in the browser is on loopback too, so without a token any
 * website the user has open could call the editor's tools.
 */
import { EDITOR_MCP_SERVER } from "@ultrapaint/contracts/threads";
import { Effect, Layer } from "effect";
import { McpProtocol, McpSchema, McpServer, Toolkit } from "effect/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { canvasesIn, NODES, PAGES } from "../threads/agent-docs.ts";
import { handoffCall, TOOLS } from "../threads/agent-ways.ts";
import {
  CallingThread,
  MCP_PATH,
  MCP_TOKEN_HEADER,
  McpAccess,
} from "./access.ts";
import { CanvasTools, CanvasToolsLive } from "./canvas-tools.ts";
import { CommentTools, CommentToolsLive } from "./comment-tools.ts";
import {
  DesignSystemTools,
  DesignSystemToolsLive,
} from "./design-system-tools.ts";
import { DocumentTools, DocumentToolsLive } from "./document-tools.ts";
import { FigmaTools, FigmaToolsLive } from "./figma-tools.ts";
import { HandoffTools, HandoffToolsLive } from "./handoff-tools.ts";
import { PageTools, PageToolsLive } from "./page-tools.ts";
import { rawTools } from "./raw-tools.ts";
import { SetupTools, SetupToolsLive } from "./setup-tools.ts";
import { SkillResources } from "./skill-resources.ts";
import { TaskPrompts } from "./task-prompts.ts";
import { leanSchema } from "./tool-helpers.ts";

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

/**
 * The editor's tools that answer with JSON, each file's toolkit merged: what agents call, and what
 * `TOOLS` names (`agent-ways.ts`). `get_screenshot` and `ask_user` answer by hand (`rawTools`).
 */
export const EditorTools = Toolkit.merge(
  PageTools,
  DocumentTools,
  DesignSystemTools,
  CommentTools,
  CanvasTools,
  HandoffTools,
  FigmaTools,
  SetupTools
);

/**
 * The handlers of every tool the server offers, which a test calls in-process
 * (`testing/project.ts`: `callTool`, `callRawTool`).
 */
export const ToolkitHandlers = Layer.mergeAll(
  PageToolsLive,
  DocumentToolsLive,
  DesignSystemToolsLive,
  CommentToolsLive,
  CanvasToolsLive,
  HandoffToolsLive,
  FigmaToolsLive,
  SetupToolsLive
);

/**
 * Every tool registered on the MCP server, each one's input schema without what JSON Schema says
 * anyway (`leanSchema`): every agent reads every tool's schema, every session.
 */
const Tools = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const lean = McpServer.McpServer.of({
      ...server,
      addTool: (options) =>
        server.addTool({
          ...options,
          tool: new McpSchema.Tool({
            ...options.tool,
            inputSchema: leanSchema(options.tool.inputSchema),
          }),
        }),
    });
    yield* Effect.provideService(
      McpServer.registerToolkit(EditorTools),
      McpServer.McpServer,
      lean
    );
    yield* Effect.forEach(yield* rawTools, lean.addTool, { discard: true });
  })
).pipe(Layer.provide(ToolkitHandlers));

/**
 * What an agent is told when it connects (ADR 0030): what the designs are, how to change them, and
 * how the code follows them. Every agent reads it, in the editor or outside it, so it says what
 * holds whatever the agent is doing; a thread's briefing says what its purpose asks (ADR 0030),
 * and a task the rest.
 */
export const MCP_INSTRUCTIONS = `ultrapaint keeps this repository's designs: pages, components and the design system. The design
is what the UI looks like and which states it has; the code is what it does, and follows the design.
${canvasesIn("the designs directory")}
${PAGES}
${NODES}
Change designs through these tools, not by editing their files: ${TOOLS.read_page} (a big page an outline
first, then a part at a time with node), then ${TOOLS.apply_operations}; ${TOOLS.get_document_format} has the whole
format, ${TOOLS.get_component} an instance to start from. Call ${TOOLS.focus} before changing nodes, so the user
sees where you work, and ${TOOLS.get_screenshot} to look at the result. A component's file in components/ is
written as a file. Token values are the design system's, never a stylesheet's.
To implement a design, ${handoffCall("list")} says what is ready or changed since it was implemented,
and "read" with its target gives the task, which says the rest. What the code must do that a design
cannot show (a permission, a validation, a call) is written down with "note", on a page's node or a
component (target component:Button, node a part).`;

export const McpRoute = Layer.mergeAll(Tools, SkillResources, TaskPrompts).pipe(
  Layer.provide(
    McpServer.layerHttp({
      description:
        "The Ultrapaint editor: the project's pages, routes and components.",
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
