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
import { RawTools } from "./raw-tools.ts";
import { SetupTools, SetupToolsLive } from "./setup-tools.ts";
import { SkillResources } from "./skill-resources.ts";
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
 * `TOOLS` names (`agent-ways.ts`). `get_screenshot` and `ask_user` answer by hand (`RawTools`).
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
  SetupToolsLive,
  RawTools.layer
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
    const { all } = yield* RawTools;
    yield* Effect.forEach(all, lean.addTool, { discard: true });
  })
).pipe(Layer.provide(ToolkitHandlers));

/**
 * What an agent is told when it connects (ADR 0030): the designs lead and the code follows, and
 * how to keep the two linked. An agent in the editor is briefed as well; one outside it reads
 * only this.
 */
export const MCP_INSTRUCTIONS = `ultrapaint keeps this repository's designs: pages, components and the design system, in the
designs directory. The design is what the UI looks like and which states it has; the code is what
it does. The design leads, and the code follows it through the ${TOOLS.handoff} tool:
- Before implementing UI, call ${handoffCall("list")} to see what is ready or changed since it
  was implemented, and "read" with its target for the task, which says what changed.
- Token values live in the design system; the stylesheets follow it. The task names the tokens
  a design uses that the code does not have yet: bring them over with ${TOOLS.handoff} "export" and their
  names ("import" takes the code's value into the design instead, when the user says so).
- After implementing a page or a component, call ${TOOLS.handoff} "mark" with the files that implement it.
- When the code has to do something a design cannot show (a permission, a validation, a call),
  or when you change UI in a way the design does not say, call ${TOOLS.handoff} "note" on the page's node,
  or on a component (target "component:Button", node one of its parts).
- Change a design only through the tools (${TOOLS.apply_operations}, ${TOOLS.write_design_system}), never by
  editing its JSON by hand (a component's file in components/ is written as a file); change token
  values in the design system, not in the stylesheet.`;

export const McpRoute = Layer.mergeAll(Tools, SkillResources).pipe(
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
