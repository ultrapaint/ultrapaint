import { assert, layer } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { MCP_TOKEN_HEADER } from "./services/mcp/route.ts";
import { TestEnv, TestServer } from "./testing/harness.ts";

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
          "create_page",
          "focus",
          "get_component",
          "get_context",
          "list_comments",
          "list_components",
          "list_pages",
          "read_page",
          "rename_page",
          "reply_to_comment",
          "resolve_comment",
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

        // A page the agent makes through the editor lands where the route says.
        const created = yield* callMcp(
          port,
          token,
          {
            method: "tools/call",
            params: {
              arguments: { route: "/pricing" },
              name: "create_page",
            },
          },
          sessionId
        );
        const page = (yield* Effect.promise(() => created.json())) as {
          result: { structuredContent: { file: string; route: string } };
        };
        assert.strictEqual(page.result.structuredContent.route, "/pricing");
        assert.include(page.result.structuredContent.file, "pricing.tsx");
        const listedAgain = yield* client["pages.list"]();
        assert.include(
          listedAgain.pages.map((p) => p.route),
          "/pricing"
        );
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

    // Last: the space it adds would change what the tests above list.
    it.effect(
      "asks which space rather than guess, when a route is in two",
      () =>
        Effect.gen(function* () {
          const { client, port, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const space = yield* client["spaces.create"]({ name: "Marketing" });
          yield* client["pages.create"]({ route: "/home", space: space.id });
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
            "several spaces"
          );
          assert.include(
            yield* call("read_page", { route: "/home", space: space.id }),
            `${space.id}/`
          );
          // The designs directory's own space is `""`, which is a name, not an absent one.
          assert.notInclude(
            yield* call("read_page", { route: "/home", space: "" }),
            "several spaces"
          );
          assert.include(
            yield* call("create_page", { route: "/nowhere" }),
            "several spaces"
          );
        })
    );
  }
);
