import { assert, layer } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";
import { callMcp, initializeLegacy, toolCaller } from "./testing/mcp.ts";

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "the editor's MCP server",
  (it) => {
    it.effect("turns away a caller without a token", () =>
      Effect.gen(function* () {
        const { port } = yield* TestEnv;
        const response = yield* callMcp(port, undefined, {
          method: "tools/list",
        });
        assert.strictEqual(response.status, 403);
      })
    );

    it.effect(
      "speaks 2026-07-28 without a handshake, and the revision Codex asks for without its flag",
      () =>
        Effect.gen(function* () {
          const { client, port } = yield* TestEnv;
          const { token } = yield* client["mcp.connection"]();
          const discovered = yield* callMcp(port, token, {
            method: "server/discover",
          }).pipe(
            Effect.flatMap((response) =>
              Effect.promise(
                () =>
                  response.json() as Promise<{
                    result: { supportedVersions: string[] };
                  }>
              )
            )
          );
          assert.deepStrictEqual(discovered.result.supportedVersions, [
            "2026-07-28",
            "2025-11-25",
            "2025-06-18",
          ]);
          const legacy = yield* initializeLegacy(port, token, "2025-06-18");
          assert.strictEqual(legacy.result.protocolVersion, "2025-06-18");
          // A revision no longer offered is answered with the newest of the older ones.
          const old = yield* initializeLegacy(port, token, "2025-03-26");
          assert.strictEqual(old.result.protocolVersion, "2025-11-25");
        })
    );

    it.effect(
      "turns away a caller without a token however the path is spelled",
      () =>
        Effect.gen(function* () {
          const { client, port } = yield* TestEnv;
          const { token } = yield* client["mcp.connection"]();
          for (const path of ["/MCP", "//mcp", "/%6dcp", "/mcp/", "/Mcp?x=1"]) {
            const refused = yield* callMcp(
              port,
              undefined,
              { method: "tools/list" },
              {},
              path
            );
            assert.strictEqual(refused.status, 403, path);
            // The same spelling with the token reaches the tools: the router does route it.
            const answered = yield* callMcp(
              port,
              token,
              { method: "tools/list" },
              {},
              path
            );
            assert.strictEqual(answered.status, 200, path);
          }
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

    /** A thread of the fake agent, and the token its session was given for the editor. */
    const threadToken = Effect.gen(function* () {
      const { client, settings } = yield* TestEnv;
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
      return {
        threadId: thread.id,
        token: (said ?? "").split("|")[1] ?? "",
      };
    });

    const QUESTIONS = [
      {
        allowOther: true,
        id: "plan",
        options: [
          { id: "free", label: "Free" },
          { id: "pro", label: "Pro" },
        ],
        question: "Which plan?",
      },
    ];
    const FORMS = { elicitation: { form: {} } };

    interface AskResult {
      readonly result: {
        readonly content?: readonly { readonly text: string }[];
        readonly inputRequests?: Record<
          string,
          { method: string; params: Record<string, unknown> }
        >;
        readonly isError?: boolean;
        readonly requestState?: string;
        readonly resultType: string;
      };
    }

    const askUser = (
      port: number,
      token: string,
      capabilities: Record<string, unknown>,
      retry: Record<string, unknown> = {}
    ) =>
      callMcp(
        port,
        token,
        {
          method: "tools/call",
          params: {
            arguments: { questions: QUESTIONS },
            name: "ask_user",
            ...retry,
          },
        },
        capabilities
      ).pipe(
        Effect.flatMap((response) =>
          Effect.promise(() => response.json() as Promise<AskResult>)
        )
      );

    it.effect(
      "asks the user through a client that shows forms, and answers with what they said",
      () =>
        Effect.gen(function* () {
          const { client, port } = yield* TestEnv;
          const { token } = yield* client["mcp.connection"]();
          const first = yield* askUser(port, token, FORMS);
          assert.strictEqual(first.result.resultType, "input_required");
          const request = first.result.inputRequests?.answers;
          assert.strictEqual(request?.method, "elicitation/create");
          assert.deepStrictEqual(
            Object.keys(
              (
                request?.params.requestedSchema as
                  | { properties: object }
                  | undefined
              )?.properties ?? {}
            ),
            ["plan", "plan:other"]
          );
          const second = yield* askUser(port, token, FORMS, {
            inputResponses: {
              answers: { action: "accept", content: { plan: "pro" } },
            },
            requestState: first.result.requestState,
          });
          assert.strictEqual(second.result.resultType, "complete");
          assert.include(
            second.result.content?.[0]?.text ?? "",
            "1. Which plan? — Pro [pro]"
          );
          const declined = yield* askUser(port, token, FORMS, {
            inputResponses: { answers: { action: "decline" } },
            requestState: first.result.requestState,
          });
          assert.include(declined.result.content?.[0]?.text ?? "", "declined");
          // A client that cannot show forms, outside a thread: nowhere to ask.
          const nowhere = yield* askUser(port, token, {});
          assert.isTrue(nowhere.result.isError);
        })
    );

    it.effect(
      "puts the questions in the thread when the agent's client turns the form down unseen",
      () =>
        Effect.gen(function* () {
          const { client, port } = yield* TestEnv;
          const { threadId, token } = yield* threadToken;
          const first = yield* askUser(port, token, FORMS);
          assert.strictEqual(first.result.resultType, "input_required");
          // No card came to the editor, yet the answer is "decline": the client's own doing.
          const fallback = yield* askUser(port, token, FORMS, {
            inputResponses: { answers: { action: "decline" } },
            requestState: first.result.requestState,
          });
          assert.include(
            fallback.result.content?.[0]?.text ?? "",
            "End your turn"
          );
          const items = yield* client["threads.items"]({ threadId });
          const card = items.find((i) => i.kind === "question");
          assert.isTrue(card?.kind === "question" && !card.elicitation);
          // And it does not try the form again for this thread.
          const again = yield* askUser(port, token, FORMS);
          assert.strictEqual(again.result.resultType, "complete");
          assert.include(
            again.result.content?.[0]?.text ?? "",
            "End your turn"
          );
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

        const listed = yield* callMcp(port, token, { method: "tools/list" });
        assert.strictEqual(listed.status, 200);
        const tools = (yield* Effect.promise(() => listed.json())) as {
          result: { tools: { name: string }[] };
        };
        assert.deepStrictEqual(tools.result.tools.map((t) => t.name).sort(), [
          "apply_operations",
          "ask_user",
          "copy_pages",
          "create_canvas",
          "create_page",
          "delete_page",
          "duplicate_page",
          "finish_setup_step",
          "focus",
          "get_component",
          "get_context",
          "get_document_format",
          "get_screenshot",
          "list_comments",
          "list_components",
          "list_figma_imports",
          "list_links",
          "list_pages",
          "list_templates",
          "map_figma_component",
          "map_values",
          "next_batch",
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
          "set_home",
          "set_page_url",
          "write_design_system",
          "write_figma_frame",
        ]);

        const called = yield* callMcp(port, token, {
          method: "tools/call",
          params: { arguments: {}, name: "list_pages" },
        });
        const pages = (yield* Effect.promise(() => called.json())) as {
          result: { structuredContent: { pages: { route: string }[] } };
        };
        assert.deepStrictEqual(
          pages.result.structuredContent.pages.map((p) => p.route),
          ["/home"]
        );

        // A page the agent makes through the editor is named as asked and serves the URL given.
        const created = yield* callMcp(port, token, {
          method: "tools/call",
          params: {
            arguments: { name: "Pricing", route: "/pricing" },
            name: "create_page",
          },
        });
        const page = (yield* Effect.promise(() => created.json())) as {
          result: { structuredContent: { file: string; route: string } };
        };
        assert.strictEqual(page.result.structuredContent.route, "/pricing");
        assert.include(page.result.structuredContent.file, "pricing.page.json");
        // A page without a URL is named by its file, and given one afterwards.
        const sketch = yield* callMcp(port, token, {
          method: "tools/call",
          params: { arguments: { name: "Sketch" }, name: "create_page" },
        });
        const sketched = (yield* Effect.promise(() => sketch.json())) as {
          result: { structuredContent: { file: string; route?: string } };
        };
        assert.isUndefined(sketched.result.structuredContent.route);
        const served = yield* callMcp(port, token, {
          method: "tools/call",
          params: {
            arguments: { route: "sketch.page.json", url: "/sketch" },
            name: "set_page_url",
          },
        });
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
            callMcp(port, token, {
              method: "tools/call",
              params: { arguments: args, name },
            }),
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

          const called = yield* callMcp(port, connection.token, {
            method: "tools/call",
            params: { arguments: {}, name: "list_pages" },
          });
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
          yield* callMcp(port, connection.token, {
            method: "tools/call",
            params: { arguments: { route: "/home" }, name: "focus" },
          });
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
        yield* callMcp(port, token, {
          method: "tools/call",
          params: { arguments: { route: "/home" }, name: "focus" },
        });
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
          const call = toolCaller(port, token ?? "");

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

          // Only the fields that name a node are read as references: a link or a text with a
          // `#` in it is the user's own and is saved as it was given.
          yield* call("apply_operations", {
            ops: [
              {
                id: `/home#${textId}`,
                op: "update",
                set: {
                  link: "https://example.com/docs#intro",
                  text: "/pricing#faq",
                },
              },
            ],
            route: "/home",
          });
          const kept = yield* call("read_page", {
            node: textId,
            route: "/home",
          });
          const node = kept.result.structuredContent.document as {
            link?: string;
            text?: string;
          };
          assert.deepStrictEqual(
            { link: node.link, text: node.text },
            { link: "https://example.com/docs#intro", text: "/pricing#faq" }
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
          const shoot = (args: Record<string, unknown>) =>
            Effect.flatMap(
              callMcp(port, connection.token, {
                method: "tools/call",
                params: { arguments: args, name: "get_screenshot" },
              }),
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
        const call = (name: string, args: Record<string, unknown>) =>
          Effect.flatMap(
            callMcp(port, connection.token, {
              method: "tools/call",
              params: { arguments: args, name },
            }),
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

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "the editor's MCP tools for pages and canvases",
  (it) => {
    /** A caller of the tools on a session opened with the project's token. */
    const session = Effect.gen(function* () {
      const { client, port, settings } = yield* TestEnv;
      yield* client["settings.set"](settings);
      const connection = yield* client["mcp.connection"]();
      return toolCaller(port, connection.token);
    });

    it.effect(
      "starts pages from the templates it lists, and refuses one it does not",
      () =>
        Effect.gen(function* () {
          const call = yield* session;
          const listed = yield* call("list_templates", {});
          assert.deepStrictEqual(
            (listed.result.structuredContent.templates as { id: string }[]).map(
              (t) => t.id
            ),
            ["blank", "centered", "page"]
          );
          const unknown = yield* call("create_page", {
            name: "Fancy",
            template: "fancy",
          });
          assert.isTrue(unknown.result.isError);
          assert.include(
            unknown.result.content[0]?.text ?? "",
            "blank, centered, page"
          );
          const plans = yield* call("create_page", {
            name: "Plans",
            route: "/plans",
            template: "page",
          });
          assert.isNotTrue(plans.result.isError);
          assert.notInclude(
            JSON.stringify(plans.result.structuredContent.document),
            '"link"'
          );
        })
    );

    it.effect(
      "says where a canvas opens, and opens it on a page that serves a URL",
      () =>
        Effect.gen(function* () {
          const call = yield* session;
          const homeNow = Effect.map(
            call("get_context", {}),
            (context) =>
              (
                context.result.structuredContent.canvases as {
                  home: string;
                }[]
              )[0]?.home
          );
          // No page serves `/`: the canvas opens on the first URL one serves.
          assert.strictEqual(yield* homeNow, "/home");
          const set = yield* call("set_home", { route: "/plans" });
          assert.deepStrictEqual(set.result.structuredContent, {
            canvas: "",
            home: "/plans",
          });
          assert.strictEqual(yield* homeNow, "/plans");
          yield* call("create_page", { name: "Sketch" });
          const unserved = yield* call("set_home", {
            route: "sketch.page.json",
          });
          assert.isTrue(unserved.result.isError);
          assert.include(
            unserved.result.content[0]?.text ?? "",
            "set_page_url"
          );
        })
    );

    it.effect("sizes one frame and leaves the others where they are", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const call = yield* session;
        yield* call("set_frame", { preset: "mobile", route: "/home" });
        yield* call("set_frame", { height: 2000, route: "/plans" });
        const { frames } = yield* client["canvas.get"]({ canvas: "" });
        assert.strictEqual(frames["home.page.json"]?.preset, "mobile");
        assert.strictEqual(frames["plans.page.json"]?.height, 2000);
      })
    );

    it.effect("finds the links that lead nowhere", () =>
      Effect.gen(function* () {
        const call = yield* session;
        const linked = (id: string, link: string) => ({
          node: { id, link, role: "paragraph", text: link, type: "text" },
          op: "insert",
          parent: null,
        });
        yield* call("apply_operations", {
          ops: [
            linked("to-plans", "/plans"),
            linked("to-nowhere", "/gone"),
            linked("to-file", "plans.page.json"),
            linked("to-back", "back"),
            linked("to-site", "https://example.com"),
            linked("to-mail", "mailto:someone@example.com"),
          ],
          route: "/home",
        });
        const all = yield* call("list_links", {});
        const links = all.result.structuredContent.links as {
          broken?: string;
          kind: string;
          link: string;
          node: string;
          page: string | null;
          target?: string;
        }[];
        assert.strictEqual(all.result.structuredContent.broken, 1);
        assert.deepStrictEqual(
          links.find((l) => l.node === "to-plans"),
          {
            kind: "url",
            link: "/plans",
            node: "to-plans",
            page: "designs/home.page.json",
            target: "designs/plans.page.json",
          }
        );
        assert.deepStrictEqual(
          links.map((l) => [l.node, l.kind]),
          [
            ["to-plans", "url"],
            ["to-nowhere", "url"],
            ["to-file", "page"],
            ["to-back", "back"],
            ["to-site", "external"],
            ["to-mail", "external"],
          ]
        );
        const broken = yield* call("list_links", { brokenOnly: true });
        assert.deepStrictEqual(
          (broken.result.structuredContent.links as { node: string }[]).map(
            (l) => l.node
          ),
          ["to-nowhere"]
        );
      })
    );

    it.effect(
      "duplicates a page, and deletes one with its variants, the canvas opening elsewhere",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const call = yield* session;
          const copy = yield* call("duplicate_page", { route: "/plans" });
          assert.strictEqual(
            copy.result.structuredContent.file,
            "designs/plans-2.page.json"
          );
          yield* client["pages.createVariant"]({
            id: "plans.page.json",
            variant: "bold",
          });
          const deleted = yield* call("delete_page", { route: "/plans" });
          assert.deepStrictEqual(deleted.result.structuredContent.deleted, [
            "designs/plans.page.json",
            "designs/plans@bold.page.json",
          ]);
          const context = yield* call("get_context", {});
          assert.strictEqual(
            (context.result.structuredContent.canvases as { home: string }[])[0]
              ?.home,
            "/home"
          );
          // The links to it lead nowhere now, and say so.
          const links = yield* call("list_links", { brokenOnly: true });
          // The mail link was never broken: three lead to the deleted page.
          assert.strictEqual(links.result.structuredContent.broken, 3);
        })
    );

    it.effect("makes canvases and copies or moves pages into them", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const call = yield* session;
        const made = yield* call("create_canvas", { name: "Archive" });
        assert.deepStrictEqual(made.result.structuredContent, {
          id: "archive",
          name: "Archive",
        });
        const nowhere = yield* call("copy_pages", {
          canvas: "",
          pages: ["/home"],
        });
        assert.isTrue(nowhere.result.isError);
        const copied = yield* call("copy_pages", {
          canvas: "",
          pages: ["/home"],
          to: "archive",
        });
        assert.deepStrictEqual(copied.result.structuredContent, {
          canvas: "archive",
          pages: [{ file: "designs/archive/home.page.json", route: "/home" }],
        });
        const moved = yield* call("copy_pages", {
          canvas: "",
          move: true,
          newCanvas: "Later",
          pages: ["plans-2.page.json"],
        });
        assert.deepStrictEqual(moved.result.structuredContent, {
          canvas: "later",
          pages: [{ file: "designs/later/plans-2.page.json" }],
        });
        assert.notInclude(
          (yield* client["pages.list"]()).pages.map((p) => p.id),
          "plans-2.page.json"
        );
      })
    );

    it.effect(
      "keeps what an agent reads of the tools under its budget, and says no more than it needs",
      () =>
        Effect.gen(function* () {
          const { client, port } = yield* TestEnv;
          const { token } = yield* client["mcp.connection"]();
          const listed = yield* callMcp(port, token, {
            method: "tools/list",
          }).pipe(
            Effect.flatMap((response) =>
              Effect.promise(
                () =>
                  response.json() as Promise<{
                    result: {
                      tools: {
                        description: string;
                        inputSchema: unknown;
                        name: string;
                      }[];
                    };
                  }>
              )
            )
          );
          // What reaches the model: the name, the description and the input schema. Output
          // schemas stay on the wire (Claude Code and Codex both leave them out). The tools
          // cost about 7,900 tokens before the descriptions were cut down; raise this only
          // for a tool that earns it.
          const visible = listed.result.tools.map((tool) =>
            JSON.stringify({
              description: tool.description,
              inputSchema: tool.inputSchema,
              name: tool.name,
            })
          );
          const total = visible.join("").length;
          assert.isBelow(total, 16_000, `the tools take ${total} characters`);
          // An optional parameter is a plain property, not a union with null, and a number is a
          // number, not also the strings "NaN" and "Infinity".
          for (const tool of listed.result.tools) {
            const schema = tool.inputSchema as {
              properties?: Record<string, unknown>;
              required?: string[];
            };
            for (const [name, property] of Object.entries(
              schema.properties ?? {}
            )) {
              const encoded = JSON.stringify(property);
              if (!schema.required?.includes(name)) {
                assert.notInclude(encoded, '"null"', `${tool.name}.${name}`);
              }
              // Codex fills in a missing `items` as strings: every array says what it holds.
              if ((property as { type?: string }).type === "array") {
                assert.property(property, "items", `${tool.name}.${name}`);
              }
              assert.notInclude(encoded, "Infinity", `${tool.name}.${name}`);
            }
          }
        })
    );

    it.effect(
      "reads one node of a page, and the design system's schema on request",
      () =>
        Effect.gen(function* () {
          const call = yield* session;
          // A page of its own: the tests before this one move pages between canvases.
          yield* call("create_page", {
            canvas: "",
            name: "Parts",
            route: "/parts",
          });
          yield* call("apply_operations", {
            canvas: "",
            ops: [
              {
                node: {
                  children: [
                    {
                      id: "hello",
                      role: "paragraph",
                      text: "Hi",
                      type: "text",
                    },
                  ],
                  id: "box",
                  type: "row",
                },
                op: "insert",
                parent: null,
              },
            ],
            route: "/parts",
          });
          const part = yield* call("read_page", {
            canvas: "",
            node: "/parts#box",
            route: "/parts",
          });
          assert.isFalse(part.result.isError, part.result.content[0]?.text);
          assert.strictEqual(
            (part.result.structuredContent.document as { id: string }).id,
            "box"
          );
          const gone = yield* call("read_page", {
            canvas: "",
            node: "nope",
            route: "/parts",
          });
          assert.isTrue(gone.result.isError);
          assert.include(gone.result.content[0]?.text ?? "", "no node nope");

          const format = yield* call("get_document_format", {
            kind: "design-system",
          });
          const schema = JSON.stringify(format.result.structuredContent.schema);
          assert.include(schema, "typography");
          const context = yield* call("get_context", {});
          assert.include(
            context.result.structuredContent.guide as string,
            "canvases"
          );
        })
    );
  }
);
