/**
 * Spike: a Streamable HTTP MCP server built on Effect's `McpServer`, mounted on an `HttpRouter`
 * the way the real server would mount it. One tool, `get_context`, answers with the repository
 * root and logs every call so the harness can tell the agent reached it.
 *
 * Usage: node --experimental-strip-types spike/mcp-server.ts <port> <root>
 */
import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { HttpRouter } from "effect/unstable/http";

const [portArg, root = process.cwd()] = process.argv.slice(2);
const port = Number(portArg ?? 4799);

const GetContext = Tool.make("get_context", {
  description:
    "Describe the ultrapaint project: repository root and where the designs live.",
  success: Schema.Struct({ designsDir: Schema.String, root: Schema.String }),
});

const Tools = Toolkit.make(GetContext);

const ToolsLive = Tools.toLayer({
  get_context: () =>
    Effect.sync(() => {
      console.log(`[mcp] get_context called at ${new Date().toISOString()}`);
      return { designsDir: "docs/designs", root };
    }),
});

const Mcp = McpServer.toolkit(Tools).pipe(
  Layer.provide(ToolsLive),
  Layer.provide(
    McpServer.layerHttp({
      name: "ultrapaint",
      path: "/mcp",
      protocols: [
        McpProtocol.v2025_11_25,
        McpProtocol.v2025_06_18,
        McpProtocol.v2025_03_26,
      ],
      version: "0.0.0",
    })
  )
);

HttpRouter.serve(Mcp).pipe(
  Layer.provide(
    NodeHttpServer.layer(createServer, { host: "127.0.0.1", port })
  ),
  Layer.tap(() => Effect.log(`mcp listening on http://127.0.0.1:${port}/mcp`)),
  Layer.launch,
  NodeRuntime.runMain
);
