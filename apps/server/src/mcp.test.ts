import { assert, layer } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { MCP_TOKEN_HEADER } from "./services/mcp/route.ts";
import { TestEnv, TestServer } from "./testing/harness.ts";
import { toolCaller } from "./testing/mcp.ts";

const PROTOCOL = "2025-06-18";
const JSON_RPC = { "content-type": "application/json" };
const ACCEPT = { accept: "application/json, text/event-stream" };

/** One JSON-RPC call against the editor's MCP endpoint, as an agent would make it. */
const callMcp = (
  port: number,
  token: string | undefined,
  body: Record<string, unknown>,
  sessionId?: string
) =>
  Effect.promise(() =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", ...body }),
      headers: {
        ...JSON_RPC,
        ...ACCEPT,
        ...(token ? { [MCP_TOKEN_HEADER]: token } : {}),
        ...(sessionId
          ? { "mcp-protocol-version": PROTOCOL, "mcp-session-id": sessionId }
          : {}),
      },
      method: "POST",
    })
  );

/** Initializes a session and returns its id, so tools can be called on it. */
const openMcp = (port: number, token: string) =>
  Effect.gen(function* () {
    const response = yield* callMcp(port, token, {
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
        protocolVersion: PROTOCOL,
      },
    });
    const sessionId = response.headers.get("mcp-session-id") ?? undefined;
    yield* callMcp(
      port,
      token,
      { method: "notifications/initialized" },
      sessionId
    );
    return sessionId;
  });

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "the editor's MCP server",
  (it) => {
    it.effect("turns away a caller without a token", () =>
      Effect.gen(function* () {
        const { port } = yield* TestEnv;
        const response = yield* callMcp(port, undefined, {
          method: "initialize",
          params: {
            capabilities: {},
            clientInfo: { name: "test", version: "1" },
            protocolVersion: PROTOCOL,
          },
        });
        assert.strictEqual(response.status, 403);
      })
    );

    it.effect("turns away a token that belongs to no session", () =>
      Effect.gen(function* () {
        const { port } = yield* TestEnv;
        const response = yield* callMcp(port, "mcp_made_up", {
          method: "tools/list",
        });
        assert.strictEqual(response.status, 403);
      })
    );

    it.effect("answers an agent's session token with the project's pages", () =>
      Effect.gen(function* () {
        const { client, port, settings } = yield* TestEnv;
        yield* client["settings.set"](settings);
        const thread = yield* client["threads.create"]({ agentId: "fake" });
        // The agent reports the MCP server it was handed, token and all.
        yield* client["threads.prompt"]({
          attachments: [],
          text: "mcp",
          threadId: thread.id,
        });
        const items = yield* client["threads.items"]({
          threadId: thread.id,
        }).pipe(
          Effect.tap(() => Effect.sleep("25 millis")),
          Effect.repeat({
            until: (all) => all.at(-1)?.kind === "turn_end",
          }),
          Effect.timeout("20 seconds")
        );
        const said = items
          .map((i) => (i.kind === "agent" ? i.text : ""))
          .find((t) => t.startsWith("mcp:"));
        const [url, token] = (said ?? "").slice("mcp:".length).split("|");
        assert.include(url ?? "", `127.0.0.1:${port}/mcp`);
        assert.isTrue((token ?? "").startsWith("mcp_"));
        const sessionId = yield* openMcp(port, token ?? "");

        const listed = yield* callMcp(
          port,
          token,
          { method: "tools/list" },
          sessionId
        );
        assert.strictEqual(listed.status, 200);
        const tools = (yield* Effect.promise(() => listed.json())) as {
          result: { tools: { name: string }[] };
        };
        assert.deepStrictEqual(tools.result.tools.map((t) => t.name).sort(), [
          "apply_operations",
          "ask_user",
          "create_page",
          "focus",
          "get_component",
          "get_context",
          "get_document_format",
          "get_screenshot",
          "list_comments",
          "list_components",
          "list_figma_imports",
          "list_pages",
          "map_figma_component",
          "read_canvas",
          "read_design_system",
          "read_figma_component",
          "read_figma_frame",
          "read_figma_import",
          "read_page",
          "rename_page",
          "reply_to_comment",
          "resolve_comment",
          "scan_design_system",
          "set_frame",
          "set_page_url",
          "write_design_system",
          "write_figma_frame",
        ]);

        const called = yield* callMcp(
          port,
          token,
          {
            method: "tools/call",
            params: { arguments: {}, name: "list_pages" },
          },
          sessionId
        );
        const pages = (yield* Effect.promise(() => called.json())) as {
          result: { structuredContent: { pages: { route: string }[] } };
        };
        assert.deepStrictEqual(
          pages.result.structuredContent.pages.map((p) => p.route),
          ["/home"]
        );

        // A page the agent makes through the editor is named as asked and serves the URL given.
        const created = yield* callMcp(
          port,
          token,
          {
            method: "tools/call",
            params: {
              arguments: { name: "Pricing", route: "/pricing" },
              name: "create_page",
            },
          },
          sessionId
        );
        const page = (yield* Effect.promise(() => created.json())) as {
          result: { structuredContent: { file: string; route: string } };
        };
        assert.strictEqual(page.result.structuredContent.route, "/pricing");
        assert.include(page.result.structuredContent.file, "pricing.page.json");
        // A page without a URL is named by its file, and given one afterwards.
        const sketch = yield* callMcp(
          port,
          token,
          {
            method: "tools/call",
            params: { arguments: { name: "Sketch" }, name: "create_page" },
          },
          sessionId
        );
        const sketched = (yield* Effect.promise(() => sketch.json())) as {
          result: { structuredContent: { file: string; route?: string } };
        };
        assert.isUndefined(sketched.result.structuredContent.route);
        const served = yield* callMcp(
          port,
          token,
          {
            method: "tools/call",
            params: {
              arguments: { route: "sketch.page.json", url: "/sketch" },
              name: "set_page_url",
            },
          },
          sessionId
        );
        const servedAt = (yield* Effect.promise(() => served.json())) as {
          result: { structuredContent: { route?: string } };
        };
        assert.strictEqual(servedAt.result.structuredContent.route, "/sketch");
        const listedAgain = yield* client["pages.list"]();
        assert.include(
          listedAgain.pages.map((p) => p.route),
          "/pricing"
        );

        const tool = (name: string, args: Record<string, unknown>) =>
          Effect.flatMap(
            callMcp(
              port,
              token,
              { method: "tools/call", params: { arguments: args, name } },
              sessionId
            ),
            (response) =>
              Effect.promise(
                () =>
                  response.json() as Promise<{
                    result: {
                      isError?: boolean;
                      content: { text: string }[];
                      structuredContent: Record<string, unknown>;
                    };
                  }>
              )
          );

        // The agent changes the page through the same operations the editor uses.
        const applied = yield* tool("apply_operations", {
          ops: [
            {
              node: { level: 1, role: "heading", text: "Plans", type: "text" },
              op: "insert",
              parent: null,
            },
          ],
          route: "/pricing",
        });
        assert.isNotTrue(applied.result.isError);
        const [heading] = applied.result.structuredContent.created as string[];
        const read = yield* tool("read_page", { route: "/pricing" });
        const document = read.result.structuredContent.document as {
          root: { children: { id: string; text: string }[] };
        };
        assert.deepStrictEqual(
          document.root.children.map((c) => [c.id, c.text]),
          [[heading, "Plans"]]
        );
        const wrong = yield* tool("apply_operations", {
          ops: [{ id: "nowhere", op: "remove" }],
          route: "/pricing",
        });
        assert.isTrue(wrong.result.isError);
        assert.include(wrong.result.content[0]?.text ?? "", "no node nowhere");

        // The design system is validated before it is saved.
        const invalid = yield* tool("write_design_system", {
          designSystem: { version: 1 },
        });
        assert.isTrue(invalid.result.isError);
        const saved = yield* tool("write_design_system", {
          designSystem: {
            colors: [
              {
                name: "Semantic",
                tokens: [{ name: "color-primary", value: "#000" }],
              },
            ],
            radius: [],
            shadows: [],
            spacing: { base: "0.25rem" },
            typography: { fonts: [], sizes: [], styles: [], weights: [] },
            version: 1,
          },
          notes: "# Acme\nUse the primary colour for one action per screen.",
        });
        assert.isNotTrue(saved.result.isError);
        const system = yield* client["designSystem.get"]();
        assert.strictEqual(
          system.designSystem?.colors[0]?.tokens[0]?.name,
          "color-primary"
        );
        assert.include(system.notes ?? "", "one action per screen");
      })
    );

    it.effect(
      "lets an agent outside the editor in with the project's token",
      () =>
        Effect.gen(function* () {
          const { client, port, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const connection = yield* client["mcp.connection"]();
          assert.isTrue(connection.enabled);
          assert.include(connection.url, `127.0.0.1:${port}/mcp`);

          const sessionId = yield* openMcp(port, connection.token);
          const called = yield* callMcp(
            port,
            connection.token,
            {
              method: "tools/call",
              params: { arguments: {}, name: "list_pages" },
            },
            sessionId
          );
          const pages = (yield* Effect.promise(() => called.json())) as {
            result: { structuredContent: { pages: { route: string }[] } };
          };
          assert.include(
            pages.result.structuredContent.pages.map((p) => p.route),
            "/home"
          );

          // It belongs to no thread, so nothing on the canvas is attributed to it.
          const focused = yield* Effect.forkScoped(
            Stream.runHead(client["events.agent.focus"]())
          );
          yield* Effect.sleep("150 millis");
          yield* callMcp(
            port,
            connection.token,
            {
              method: "tools/call",
              params: { arguments: { route: "/home" }, name: "focus" },
            },
            sessionId
          );
          const event = yield* Effect.timeoutOption(
            Fiber.join(focused),
            "500 millis"
          );
          assert.isTrue(event._tag === "None");
        })
    );

    it.effect("says which thread is working on what, when it focuses", () =>
      Effect.gen(function* () {
        const { client, port, settings } = yield* TestEnv;
        yield* client["settings.set"](settings);
        const thread = yield* client["threads.create"]({ agentId: "fake" });
        const focused = yield* Effect.forkScoped(
          Stream.runHead(client["events.agent.focus"]())
        );
        // The subscription has to reach the server before the agent focuses.
        yield* Effect.sleep("150 millis");
        yield* client["threads.prompt"]({
          attachments: [],
          text: "mcp",
          threadId: thread.id,
        });
        const items = yield* client["threads.items"]({
          threadId: thread.id,
        }).pipe(
          Effect.tap(() => Effect.sleep("25 millis")),
          Effect.repeat({ until: (all) => all.at(-1)?.kind === "turn_end" }),
          Effect.timeout("20 seconds")
        );
        const said = items
          .map((i) => (i.kind === "agent" ? i.text : ""))
          .find((t) => t.startsWith("mcp:"));
        const [, token] = (said ?? "").slice("mcp:".length).split("|");
        const sessionId = yield* openMcp(port, token ?? "");
        yield* callMcp(
          port,
          token,
          {
            method: "tools/call",
            params: { arguments: { route: "/home" }, name: "focus" },
          },
          sessionId
        );
        const event = yield* Fiber.join(focused);
        const home = (yield* client["pages.list"]()).pages.find(
          (p) => p.route === "/home"
        );
        assert.deepStrictEqual(event._tag === "Some" ? event.value : null, {
          pageId: home?.id ?? "",
          route: "/home",
          threadId: thread.id,
        });
      })
    );

    it.effect(
      "shows the nodes a thread is about to change and has changed, named by reference",
      () =>
        Effect.gen(function* () {
          const { client, port, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const thread = yield* client["threads.create"]({ agentId: "fake" });
          yield* client["threads.prompt"]({
            attachments: [],
            text: "mcp",
            threadId: thread.id,
          });
          const items = yield* client["threads.items"]({
            threadId: thread.id,
          }).pipe(
            Effect.tap(() => Effect.sleep("25 millis")),
            Effect.repeat({ until: (all) => all.at(-1)?.kind === "turn_end" }),
            Effect.timeout("20 seconds")
          );
          const said = items
            .map((i) => (i.kind === "agent" ? i.text : ""))
            .find((t) => t.startsWith("mcp:"));
          const [, token] = (said ?? "").slice("mcp:".length).split("|");
          const sessionId = yield* openMcp(port, token ?? "");
          const call = toolCaller(port, token ?? "", sessionId);

          const inserted = yield* call("apply_operations", {
            ops: [
              {
                node: { role: "paragraph", text: "Hi", type: "text" },
                op: "insert",
                parent: null,
              },
            ],
            route: "/home",
          });
          const [textId = ""] = inserted.result.structuredContent
            .created as string[];

          const focused = yield* Effect.forkScoped(
            Stream.runHead(client["events.agent.focus"]())
          );
          const edited = yield* Effect.forkScoped(
            Stream.runHead(client["events.agent.edited"]())
          );
          yield* Effect.sleep("150 millis");
          yield* call("focus", {
            action: "rewording",
            nodes: [textId],
            route: "/home",
          });
          // The user pasted a reference: it stands for the page and for the node.
          yield* call("apply_operations", {
            ops: [
              { id: `/home#${textId}`, op: "update", set: { text: "Hello" } },
            ],
            route: `/home#${textId}`,
          });
          const focus = yield* Fiber.join(focused);
          assert.deepStrictEqual(
            focus._tag === "Some"
              ? { action: focus.value.action, nodeIds: focus.value.nodeIds }
              : null,
            { action: "rewording", nodeIds: [textId] }
          );
          const change = yield* Fiber.join(edited);
          assert.deepStrictEqual(
            change._tag === "Some"
              ? {
                  nodeIds: change.value.nodeIds,
                  threadId: change.value.threadId,
                }
              : null,
            { nodeIds: [textId], threadId: thread.id }
          );
          const page = yield* call("read_page", { route: `/home#${textId}` });
          assert.include(
            JSON.stringify(page.result.structuredContent),
            "Hello"
          );

          // A frame is sized as the agent asks, a preset or pixels.
          const framed = yield* call("set_frame", {
            height: 2400,
            route: "/home",
          });
          assert.deepStrictEqual(framed.result.structuredContent, {
            file: "designs/home.page.json",
            height: 2400,
            width: 1440,
          });
          const layout = yield* client["canvas.get"]({ canvas: "" });
          assert.strictEqual(
            Object.values(layout.frames).find((f) => f.height === 2400)?.preset,
            "custom"
          );
        })
    );

    it.effect(
      "asks the open editor for a picture, and hands it on as an image",
      () =>
        Effect.gen(function* () {
          const { client, port, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const connection = yield* client["mcp.connection"]();
          const sessionId = yield* openMcp(port, connection.token);
          const shoot = (args: Record<string, unknown>) =>
            Effect.flatMap(
              callMcp(
                port,
                connection.token,
                {
                  method: "tools/call",
                  params: { arguments: args, name: "get_screenshot" },
                },
                sessionId
              ),
              (response) =>
                Effect.promise(
                  () =>
                    response.json() as Promise<{
                      result: {
                        isError?: boolean;
                        content: {
                          data?: string;
                          mimeType?: string;
                          text?: string;
                          type: string;
                        }[];
                      };
                    }>
                )
            );

          // No editor open: nothing can draw it, and the agent is told so at once.
          const alone = yield* shoot({ route: "/home" });
          assert.isTrue(alone.result.isError);
          assert.include(
            alone.result.content[0]?.text ?? "",
            "no editor is open"
          );

          const missingNode = yield* shoot({ node: "nowhere", route: "/home" });
          assert.include(
            missingNode.result.content[0]?.text ?? "",
            "no node nowhere"
          );

          // This test is the editor: it takes the request and draws a (very small) picture.
          const png =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
          const requested = yield* Effect.forkScoped(
            client["events.screenshot"]().pipe(
              Stream.tap((asked) =>
                client["screenshots.deliver"]({
                  dataUrl: `data:image/png;base64,${png}`,
                  requestId: asked.requestId,
                })
              ),
              Stream.runHead
            )
          );
          yield* Effect.sleep("150 millis");
          const shot = yield* shoot({ route: "/home", width: 390 });
          assert.isNotTrue(shot.result.isError);
          const [image] = shot.result.content;
          assert.strictEqual(image?.type, "image");
          assert.strictEqual(image?.mimeType, "image/png");
          assert.strictEqual(image?.data, png);
          const request = yield* Fiber.join(requested);
          assert.isTrue(request._tag === "Some");
          if (request._tag === "Some") {
            assert.strictEqual(request.value.mode, "page");
            assert.strictEqual(request.value.width, 390);
            assert.strictEqual(request.value.root.type, "page");
          }
        })
    );

    // Last: the canvas it adds would change what the tests above list.
    it.effect("asks which canvas rather than guess, when a URL is in two", () =>
      Effect.gen(function* () {
        const { client, port, settings } = yield* TestEnv;
        yield* client["settings.set"](settings);
        const canvas = yield* client["canvases.create"]({
          name: "Marketing",
        });
        yield* client["pages.create"]({
          canvas: canvas.id,
          name: "Home",
          route: "/home",
        });
        const connection = yield* client["mcp.connection"]();
        const sessionId = yield* openMcp(port, connection.token);
        const call = (name: string, args: Record<string, unknown>) =>
          Effect.flatMap(
            callMcp(
              port,
              connection.token,
              { method: "tools/call", params: { arguments: args, name } },
              sessionId
            ),
            (response) => Effect.promise(() => response.text())
          );

        assert.include(
          yield* call("read_page", { route: "/home" }),
          "several canvases"
        );
        assert.include(
          yield* call("read_page", { canvas: canvas.id, route: "/home" }),
          `${canvas.id}/`
        );
        // The designs directory's own canvas is `""`, which is a name, not an absent one.
        assert.notInclude(
          yield* call("read_page", { canvas: "", route: "/home" }),
          "several canvases"
        );
        assert.include(
          yield* call("create_page", { name: "Nowhere" }),
          "several canvases"
        );
      })
    );
  }
);
