import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import {
  Effect,
  Fiber,
  FileSystem,
  type Layer,
  Option,
  type Scope,
  Stream,
} from "effect";
import { McpSchema } from "effect/ai";
import { EventBus } from "./events.ts";
import { OpenProject, ProjectManager } from "./project.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { AskUser } from "./services/mcp/ask-user.ts";
import { EditorTools } from "./services/mcp/route.ts";
import { GetScreenshot } from "./services/mcp/screenshot.ts";
import { PagesService } from "./services/pages.ts";
import { Screenshots } from "./services/screenshots.ts";
import { ThreadSessions } from "./services/threads/thread-session.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { skillFiles } from "./skills/index.ts";
import {
  subscribed,
  TestEnv,
  TestServer,
  waitForThread,
} from "./testing/harness.ts";
import { callMcp, initializeLegacy, toolCaller } from "./testing/mcp.ts";
import {
  callRawTool,
  callTool,
  ProjectFixture,
  ProjectTest,
  type ProjectTestOptions,
} from "./testing/project.ts";

/** A file of the design skill a resource names by its URI. */
const SKILL_URI_RE = /`(skill:\/\/ultrapaint\/[^`]+\.md)`/g;

/**
 * What only the wire does, on a server of its own over a socket (docs/TESTING.md rules 1 and 3):
 * the token gate, the protocol revisions, what `tools/list` carries. The real clock: what is
 * under test is the server's IO, which a test clock does not drive.
 */
const onAServer = <A, E>(
  name: string,
  body: () => Effect.Effect<
    A,
    E,
    Layer.Success<typeof TestServer> | Scope.Scope
  >,
  timeout = 60_000
) =>
  // real clock: the editor's MCP server over a real socket.
  it.live(
    name,
    () => body().pipe(Effect.provide(TestServer), Effect.scoped),
    timeout
  );

/**
 * What a tool does, on a project of the test's own, called in-process as an agent's call reaches
 * its handler (`callTool`, `callRawTool`).
 */
const toolTest =
  (options: ProjectTestOptions = {}) =>
  <A, E>(
    name: string,
    body: () => Effect.Effect<
      A,
      E,
      Layer.Success<ReturnType<typeof ProjectTest>> | Scope.Scope
    >,
    timeout?: number
  ) =>
    it.effect(
      name,
      () => body().pipe(Effect.provide(ProjectTest(options)), Effect.scoped),
      timeout
    );
const inAProject = toolTest();

/** An editor tool, called by an agent outside the editor, or by `thread`'s. */
const tool = <Name extends keyof typeof EditorTools.tools & string>(
  name: Name,
  parameters: Parameters<typeof callTool<typeof EditorTools.tools, Name>>[2],
  thread?: string
) => callTool(EditorTools, name, parameters, thread);

/** Why a tool refused, in the words the agent reads. */
const refusal = <Name extends keyof typeof EditorTools.tools & string>(
  name: Name,
  parameters: Parameters<typeof callTool<typeof EditorTools.tools, Name>>[2]
) => Effect.map(Effect.flip(tool(name, parameters)), (f) => f.message);

/** The text of a tool's answer given by hand. */
const textOf = (answer: McpSchema.CallToolResult | McpSchema.InputRequired) =>
  answer instanceof McpSchema.InputRequired
    ? ""
    : answer.content.map((c) => (c.type === "text" ? c.text : "")).join("");

/** What a fill in a card's body, whose height follows its content, is told as. */
const FILL_IN_CARD =
  /^t_\w+: Fill height takes the room the component leaves, and it leaves none/;

/** A text node an agent inserts at the top of a page. */
const inserted = (node: Record<string, unknown>) => ({
  node,
  op: "insert",
  parent: null,
});

/** The ids of a page's top nodes and their texts, as `read_page` gives them. */
const topTexts = (route: string) =>
  Effect.map(tool("read_page", { route }), ({ document }) =>
    (
      document as { root: { children: { id: string; text?: string }[] } }
    ).root.children.map((c) => [c.id, c.text])
  );

/** A page made through the tools, to work on. */
const pageAt = (name: string, route: string) =>
  tool("create_page", { name, route });

describe("the editor's MCP server, over the wire", () => {
  onAServer("turns away a caller without a token", () =>
    Effect.gen(function* () {
      const { port } = yield* TestEnv;
      const response = yield* callMcp(port, undefined, {
        method: "tools/list",
      });
      assert.strictEqual(response.status, 403);
    })
  );

  onAServer("turns away a token that belongs to no session", () =>
    Effect.gen(function* () {
      const { port } = yield* TestEnv;
      const response = yield* callMcp(port, "mcp_made_up", {
        method: "tools/list",
      });
      assert.strictEqual(response.status, 403);
    })
  );

  onAServer(
    "turns away a caller without a token however the path is spelled",
    () =>
      Effect.gen(function* () {
        const { client, port } = yield* TestEnv;
        const { token } = yield* client["mcp.connection"]();
        for (const spelled of [
          "/MCP",
          "//mcp",
          "/%6dcp",
          "/mcp/",
          "/Mcp?x=1",
        ]) {
          const refused = yield* callMcp(
            port,
            undefined,
            { method: "tools/list" },
            {},
            spelled
          );
          assert.strictEqual(refused.status, 403, spelled);
          // The same spelling with the token reaches the tools: the router does route it.
          const answered = yield* callMcp(
            port,
            token,
            { method: "tools/list" },
            {},
            spelled
          );
          assert.strictEqual(answered.status, 200, spelled);
        }
      })
  );

  onAServer(
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

  onAServer(
    "asks for the user's answers with a form, and takes them on the call that brings them",
    () =>
      Effect.gen(function* () {
        const { client, port } = yield* TestEnv;
        const { token } = yield* client["mcp.connection"]();
        const ask = (retry: Record<string, unknown> = {}) =>
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
            FORMS
          ).pipe(
            Effect.flatMap((response) =>
              Effect.promise(
                () =>
                  response.json() as Promise<{
                    result: {
                      content?: readonly { readonly text: string }[];
                      inputRequests?: Record<string, { method: string }>;
                      requestState?: string;
                      resultType: string;
                    };
                  }>
              )
            )
          );
        const first = yield* ask();
        assert.strictEqual(first.result.resultType, "input_required");
        assert.strictEqual(
          first.result.inputRequests?.answers?.method,
          "elicitation/create"
        );
        const second = yield* ask({
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
      })
  );

  onAServer(
    "answers a thread's agent with the token its session was given, as that thread",
    () =>
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
        const { items } = yield* waitForThread(
          thread.id,
          (_, all) => all.at(-1)?.kind === "turn_end"
        );
        const said = items
          .map((i) => (i.kind === "agent" ? i.text : ""))
          .find((t) => t.startsWith("mcp:"));
        const [url, token = ""] = (said ?? "").slice("mcp:".length).split("|");
        assert.include(url ?? "", `127.0.0.1:${port}/mcp`);
        assert.isTrue(token.startsWith("mcp_"));

        const listed = yield* callMcp(port, token, { method: "tools/list" });
        assert.strictEqual(listed.status, 200);
        const pages = yield* toolCaller(port, token)("list_pages", {});
        assert.deepStrictEqual(
          (pages.result.structuredContent.pages as { route: string }[]).map(
            (p) => p.route
          ),
          ["/home"]
        );
        // The token says which thread calls: the canvas shows that thread's agent at work.
        const focused = yield* subscribed(
          Stream.runHead(client["events.agent.focus"]())
        );
        yield* toolCaller(port, token)("focus", { route: "/home" });
        const event = yield* Fiber.join(focused);
        assert.strictEqual(
          Option.getOrNull(event)?.threadId,
          thread.id,
          "the focus is the thread's"
        );
      }),
    30_000
  );

  onAServer(
    "lets an agent outside the editor in with the project's token",
    () =>
      Effect.gen(function* () {
        const { client, port, settings } = yield* TestEnv;
        yield* client["settings.set"](settings);
        const connection = yield* client["mcp.connection"]();
        assert.isTrue(connection.enabled);
        assert.include(connection.url, `127.0.0.1:${port}/mcp`);
        const pages = yield* toolCaller(port, connection.token)(
          "list_pages",
          {}
        );
        assert.include(
          (pages.result.structuredContent.pages as { route: string }[]).map(
            (p) => p.route
          ),
          "/home"
        );
      })
  );

  onAServer(
    "serves the design skill's files as resources by their paths, worded with their URIs, and a project's own by its name",
    () =>
      Effect.gen(function* () {
        const { client, port, repo, settings } = yield* TestEnv;
        yield* client["settings.set"](settings);
        const { token } = yield* client["mcp.connection"]();
        const fs = yield* FileSystem.FileSystem;
        const json = (body: {
          method: string;
          params?: Record<string, unknown>;
        }) =>
          callMcp(port, token, body).pipe(
            Effect.flatMap((response) =>
              Effect.promise(
                () =>
                  response.json() as Promise<{
                    error?: unknown;
                    result?: {
                      contents?: { text: string; uri: string }[];
                      resources?: { name: string; uri: string }[];
                    };
                  }>
              )
            )
          );
        const listed = yield* json({ method: "resources/list" });
        assert.includeMembers(
          (listed.result?.resources ?? []).map((r) => r.uri),
          Object.keys(skillFiles).map((file) => `skill://ultrapaint/${file}`)
        );
        const read = (uri: string) =>
          Effect.map(
            json({ method: "resources/read", params: { uri } }),
            (answer) => answer.result?.contents?.[0]?.text
          );
        const core = (yield* read("skill://ultrapaint/SKILL.md")) ?? "";
        assert.include(core, "# Ultrapaint");
        // An MCP client may be on another machine: the files it is sent to are resources too.
        assert.notInclude(core, "`references/");
        assert.notInclude(core, ".cache");
        const named = [
          ...new Set([...core.matchAll(SKILL_URI_RE)].map((m) => m[1] ?? "")),
        ];
        assert.isNotEmpty(named);
        for (const uri of named) {
          const text = yield* read(uri);
          assert.isDefined(text, `${uri} is not served`);
          assert.notInclude(text, "`references/", uri);
        }
        assert.strictEqual(yield* read("skill://ultrapaint/ultrapaint"), core);

        yield* fs.makeDirectory(path.join(repo, "designs/skills"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(repo, "designs/skills/voice.md"),
          "# Voice\n\nPlain words.\n"
        );
        assert.include(yield* read("skill://ultrapaint/voice"), "Plain words.");

        // Turned off, the design skill is not read.
        yield* client["settings.set"]({
          ...settings,
          skills: { disabled: ["ultrapaint"] },
        });
        assert.isUndefined(yield* read("skill://ultrapaint/SKILL.md"));
      })
  );

  onAServer(
    "offers the tasks as prompts, their argument completed from the project",
    () =>
      Effect.gen(function* () {
        const { client, port, settings } = yield* TestEnv;
        yield* client["settings.set"](settings);
        const { token } = yield* client["mcp.connection"]();
        const json = (body: {
          method: string;
          params?: Record<string, unknown>;
        }) =>
          callMcp(port, token, body).pipe(
            Effect.flatMap((response) =>
              Effect.promise(
                () =>
                  response.json() as Promise<{
                    result: {
                      completion?: { values: string[] };
                      messages?: { content: { text: string } }[];
                      prompts?: { name: string }[];
                    };
                  }>
              )
            )
          );
        const listed = yield* json({ method: "prompts/list" });
        assert.includeMembers(
          (listed.result.prompts ?? []).map((p) => p.name),
          ["implement", "redraw", "sync"]
        );
        const completed = yield* json({
          method: "completion/complete",
          params: {
            argument: { name: "argument", value: "/h" },
            ref: { name: "implement", type: "ref/prompt" },
          },
        });
        assert.deepStrictEqual(completed.result.completion?.values, ["/home"]);
        const got = yield* json({
          method: "prompts/get",
          params: { arguments: { argument: "/home" }, name: "implement" },
        });
        const text = got.result.messages?.[0]?.content.text ?? "";
        assert.include(text, "Implement the page Home");
        // Worded for an agent with the tools: it marks the design implemented through them.
        assert.include(text, 'handoff with action "mark"');
      })
  );

  onAServer(
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
        // cost about 7,900 tokens before the descriptions were cut down, and 16,000
        // characters before they were cut again with the schemas' defaults (ADR 0043);
        // raise this only for a tool that earns it.
        const visible = listed.result.tools.map((t) =>
          JSON.stringify({
            description: t.description,
            inputSchema: t.inputSchema,
            name: t.name,
          })
        );
        const total = visible.join("").length;
        assert.isBelow(total, 13_600, `the tools take ${total} characters`);
        // An optional parameter is a plain property, not a union with null, and a number is a
        // number, not also the strings "NaN" and "Infinity".
        for (const t of listed.result.tools) {
          const schema = t.inputSchema as {
            properties?: Record<string, unknown>;
            required?: string[];
          };
          for (const [name, property] of Object.entries(
            schema.properties ?? {}
          )) {
            const encoded = JSON.stringify(property);
            if (!schema.required?.includes(name)) {
              assert.notInclude(encoded, '"null"', `${t.name}.${name}`);
            }
            // Codex fills in a missing `items` as strings: every array says what it holds.
            if ((property as { type?: string }).type === "array") {
              assert.property(property, "items", `${t.name}.${name}`);
            }
            assert.notInclude(encoded, "Infinity", `${t.name}.${name}`);
          }
        }
      })
  );

  onAServer(
    "says of each tool whether it reads, changes or takes away, and that it reaches nothing outside",
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
                      annotations?: {
                        destructiveHint?: boolean;
                        idempotentHint?: boolean;
                        openWorldHint?: boolean;
                        readOnlyHint?: boolean;
                      };
                      name: string;
                    }[];
                  };
                }>
            )
          )
        );
        const { tools } = listed.result;
        const named = (
          hint: "destructiveHint" | "idempotentHint" | "readOnlyHint"
        ) =>
          tools
            .filter((t) => t.annotations?.[hint] === true)
            .map((t) => t.name)
            .sort();
        // A client asks before a tool it is told may destroy something, or reach the world.
        assert.deepStrictEqual(
          tools
            .filter((t) => t.annotations?.openWorldHint !== false)
            .map((t) => t.name),
          []
        );
        assert.deepStrictEqual(named("readOnlyHint"), [
          "ask_user",
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
          "read_canvas",
          "read_design_system",
          "read_figma_component",
          "read_figma_frame",
          "read_figma_import",
          "read_page",
          "scan_design_system",
        ]);
        // Taken away or written over: a page and its variants, pages moved out of their canvas,
        // the design system replaced, token values written over on one side, the code rewritten.
        assert.deepStrictEqual(named("destructiveHint"), [
          "copy_pages",
          "delete_page",
          "handoff",
          "next_batch",
          "write_design_system",
        ]);
        // Called again with the same, they change nothing more.
        assert.deepStrictEqual(
          named("idempotentHint").filter(
            (name) => !named("readOnlyHint").includes(name)
          ),
          [
            "map_figma_component",
            "map_values",
            "resolve_comment",
            "save_setup",
            "set_frame",
            "set_home",
            "set_page_url",
            "write_design_system",
          ]
        );
      })
  );
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
/** A client that shows forms. */
const FORMS = { elicitation: { form: {} } };

describe("ask_user", () => {
  const ask = (
    request: Partial<McpSchema.McpRequestContext["Service"]>,
    thread?: string
  ) =>
    callRawTool(
      AskUser,
      { questions: QUESTIONS },
      { request, ...(thread !== undefined && { thread }) }
    );

  inAProject(
    "asks through a client that shows forms, and answers with what the user said",
    () =>
      Effect.gen(function* () {
        const first = yield* ask({ clientCapabilities: FORMS });
        assert.instanceOf(first, McpSchema.InputRequired);
        const form =
          first instanceof McpSchema.InputRequired
            ? first.inputRequests?.answers
            : undefined;
        assert.deepStrictEqual(
          Object.keys(
            (
              form?.params as
                | { requestedSchema: { properties: object } }
                | undefined
            )?.requestedSchema.properties ?? {}
          ),
          ["plan", "plan:other"]
        );
        const requestState =
          first instanceof McpSchema.InputRequired
            ? first.requestState
            : undefined;
        const answered = yield* ask({
          clientCapabilities: FORMS,
          inputResponses: {
            answers: { action: "accept", content: { plan: "pro" } },
          },
          requestState,
        });
        assert.include(textOf(answered), "1. Which plan? — Pro [pro]");
        const declined = yield* ask({
          clientCapabilities: FORMS,
          inputResponses: { answers: { action: "decline" } },
          requestState,
        });
        assert.include(textOf(declined), "declined");
      })
  );

  inAProject("says there is nowhere to ask without a form or a thread", () =>
    Effect.gen(function* () {
      const nowhere = yield* ask({});
      assert.isTrue(
        nowhere instanceof McpSchema.CallToolResult && nowhere.isError === true
      );
    })
  );

  inAProject(
    "puts the questions in the thread when the agent's client turns the form down unseen",
    () =>
      Effect.gen(function* () {
        const { id: threadId } = yield* Effect.flatMap(
          ThreadSessions,
          (sessions) => sessions.create()
        );
        const first = yield* ask({ clientCapabilities: FORMS }, threadId);
        assert.instanceOf(first, McpSchema.InputRequired);
        // No card came to the editor, yet the answer is "decline": the client's own doing.
        const fallback = yield* ask(
          {
            clientCapabilities: FORMS,
            inputResponses: { answers: { action: "decline" } },
            requestState:
              first instanceof McpSchema.InputRequired
                ? first.requestState
                : undefined,
          },
          threadId
        );
        assert.include(textOf(fallback), "End your turn");
        const items = yield* Effect.flatMap(ThreadStore, (store) =>
          store.items(threadId)
        );
        const card = items.find((i) => i.kind === "question");
        assert.isTrue(card?.kind === "question" && !card.elicitation);
        // And it does not try the form again for this thread.
        const again = yield* ask({ clientCapabilities: FORMS }, threadId);
        assert.include(textOf(again), "End your turn");
      })
  );
});

describe("the tools for pages", () => {
  inAProject(
    "makes a page named as asked at the URL given, and one without a URL named by its file",
    () =>
      Effect.gen(function* () {
        const pricing = yield* pageAt("Pricing", "/pricing");
        assert.strictEqual(pricing.route, "/pricing");
        assert.strictEqual(pricing.file, "designs/pricing.page.json");
        const sketch = yield* tool("create_page", { name: "Sketch" });
        assert.isUndefined(sketch.route);
        const served = yield* tool("set_page_url", {
          route: "sketch.page.json",
          url: "/sketch",
        });
        assert.strictEqual(served.route, "/sketch");
        const { pages } = yield* tool("list_pages", {});
        assert.deepStrictEqual(
          pages.map((p) => p.route),
          ["/home", "/pricing", "/sketch"]
        );
      })
  );

  inAProject(
    "starts pages from the templates it lists, and refuses one it does not",
    () =>
      Effect.gen(function* () {
        const { templates } = yield* tool("list_templates", {});
        assert.deepStrictEqual(
          templates.map((t) => t.id),
          ["blank", "centered", "page"]
        );
        assert.include(
          yield* refusal("create_page", { name: "Fancy", template: "fancy" }),
          "blank, centered, page"
        );
        const plans = yield* tool("create_page", {
          name: "Plans",
          route: "/plans",
          template: "page",
        });
        assert.notInclude(JSON.stringify(plans.document), '"link"');
      })
  );

  inAProject(
    "says where a canvas opens, and opens it on a page that serves a URL",
    () =>
      Effect.gen(function* () {
        const homeNow = Effect.map(
          tool("get_context", {}),
          ({ canvases }) => canvases[0]?.home
        );
        // No page serves `/`: the canvas opens on the first URL one serves.
        assert.strictEqual(yield* homeNow, "/home");
        yield* pageAt("Plans", "/plans");
        assert.deepStrictEqual(yield* tool("set_home", { route: "/plans" }), {
          canvas: "",
          home: "/plans",
        });
        assert.strictEqual(yield* homeNow, "/plans");
        yield* tool("create_page", { name: "Sketch" });
        assert.include(
          yield* refusal("set_home", { route: "sketch.page.json" }),
          "set_page_url"
        );
      })
  );

  inAProject("sizes one frame and leaves the others where they are", () =>
    Effect.gen(function* () {
      yield* pageAt("Plans", "/plans");
      assert.deepStrictEqual(
        yield* tool("set_frame", { height: 2400, route: "/home" }),
        { file: "designs/home.page.json", height: 2400, width: 1440 }
      );
      yield* tool("set_frame", { preset: "mobile", route: "/home" });
      yield* tool("set_frame", { height: 2000, route: "/plans" });
      const { frames } = yield* Effect.flatMap(OpenProject, (project) =>
        project.use(Effect.flatMap(PagesService, (p) => p.readCanvas("")))
      );
      assert.strictEqual(frames["home.page.json"]?.preset, "mobile");
      assert.strictEqual(frames["plans.page.json"]?.height, 2000);
      assert.strictEqual(frames["plans.page.json"]?.preset, "custom");
    })
  );

  inAProject(
    "duplicates a page, and deletes one with its variants, its links breaking",
    () =>
      Effect.gen(function* () {
        yield* pageAt("Plans", "/plans");
        yield* tool("apply_operations", {
          ops: [
            inserted({
              id: "to-plans",
              link: "/plans",
              role: "paragraph",
              text: "Plans",
              type: "text",
            }),
          ],
          route: "/home",
        });
        const copy = yield* tool("duplicate_page", { route: "/plans" });
        assert.strictEqual(copy.file, "designs/plans-2.page.json");
        yield* Effect.flatMap(OpenProject, (project) =>
          project.use(
            Effect.flatMap(PagesService, (p) =>
              p.createVariant("plans.page.json", "bold")
            )
          )
        );
        const { deleted } = yield* tool("delete_page", { route: "/plans" });
        assert.deepStrictEqual(deleted, [
          "designs/plans.page.json",
          "designs/plans@bold.page.json",
        ]);
        const links = yield* tool("list_links", { brokenOnly: true });
        assert.deepStrictEqual(
          links.links.map((l) => l.node),
          ["to-plans"]
        );
      })
  );

  inAProject("asks which canvas rather than guess, when a URL is in two", () =>
    Effect.gen(function* () {
      const { id } = yield* tool("create_canvas", { name: "Marketing" });
      yield* tool("create_page", { canvas: id, name: "Home", route: "/home" });
      assert.include(
        yield* refusal("read_page", { route: "/home" }),
        "several canvases"
      );
      assert.include(
        (yield* tool("read_page", { canvas: id, route: "/home" })).file,
        `${id}/`
      );
      // The designs directory's own canvas is `""`, which is a name, not an absent one.
      assert.strictEqual(
        (yield* tool("read_page", { canvas: "", route: "/home" })).file,
        "designs/home.page.json"
      );
      assert.include(
        yield* refusal("create_page", { name: "Nowhere" }),
        "several canvases"
      );
    })
  );
});

describe("the tools for canvases", () => {
  inAProject("finds the links that lead nowhere", () =>
    Effect.gen(function* () {
      yield* pageAt("Plans", "/plans");
      const linked = (id: string, link: string) =>
        inserted({ id, link, role: "paragraph", text: link, type: "text" });
      yield* tool("apply_operations", {
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
      const all = yield* tool("list_links", {});
      assert.strictEqual(all.broken, 1);
      assert.deepStrictEqual(
        all.links.find((l) => l.node === "to-plans"),
        {
          kind: "url",
          link: "/plans",
          node: "to-plans",
          page: "designs/home.page.json",
          target: "designs/plans.page.json",
        }
      );
      assert.deepStrictEqual(
        all.links.map((l) => [l.node, l.kind]),
        [
          ["to-plans", "url"],
          ["to-nowhere", "url"],
          ["to-file", "page"],
          ["to-back", "back"],
          ["to-site", "external"],
          ["to-mail", "external"],
        ]
      );
      const broken = yield* tool("list_links", { brokenOnly: true });
      assert.deepStrictEqual(
        broken.links.map((l) => l.node),
        ["to-nowhere"]
      );
    })
  );

  inAProject("makes canvases and copies or moves pages into them", () =>
    Effect.gen(function* () {
      yield* pageAt("Plans", "/plans");
      assert.deepStrictEqual(
        yield* tool("create_canvas", { name: "Archive" }),
        { id: "archive", name: "Archive" }
      );
      assert.include(
        yield* refusal("copy_pages", { canvas: "", pages: ["/home"] }),
        "say where the pages go"
      );
      assert.deepStrictEqual(
        yield* tool("copy_pages", {
          canvas: "",
          pages: ["/home"],
          to: "archive",
        }),
        {
          canvas: "archive",
          pages: [{ file: "designs/archive/home.page.json", route: "/home" }],
        }
      );
      assert.deepStrictEqual(
        yield* tool("copy_pages", {
          canvas: "",
          move: true,
          newCanvas: "Later",
          pages: ["/plans"],
        }),
        {
          canvas: "later",
          pages: [{ file: "designs/later/plans.page.json", route: "/plans" }],
        }
      );
      const { pages } = yield* tool("list_pages", {});
      assert.notInclude(
        pages.map((p) => p.file),
        "designs/plans.page.json"
      );
    })
  );
});

describe("the tools for documents", () => {
  inAProject(
    "changes a page through the editor's operations, and says what it refuses",
    () =>
      Effect.gen(function* () {
        const { created } = yield* tool("apply_operations", {
          ops: [
            inserted({
              level: 1,
              role: "heading",
              text: "Plans",
              type: "text",
            }),
          ],
          route: "/home",
        });
        const [heading = ""] = created;
        assert.deepStrictEqual((yield* topTexts("/home")).at(-1), [
          heading,
          "Plans",
        ]);
        assert.include(
          yield* refusal("apply_operations", {
            ops: [{ id: "nowhere", op: "remove" }],
            route: "/home",
          }),
          "no node nowhere"
        );
        // A breakpoint's fields go in its `at`; one the design system lacks is refused.
        yield* tool("apply_operations", {
          ops: [{ at: "md", id: heading, op: "update", set: { size: 40 } }],
          route: "/home",
        });
        const part = yield* tool("read_page", {
          node: heading,
          route: "/home",
        });
        assert.deepStrictEqual((part.document as { at?: unknown }).at, {
          md: { size: 40 },
        });
        assert.include(
          yield* refusal("apply_operations", {
            ops: [{ at: "tv", id: heading, op: "update", set: { size: 1 } }],
            route: "/home",
          }),
          "tv is not a breakpoint"
        );
      })
  );

  inAProject(
    "warns of a fill with no room inside a system component, by the slot it fills",
    () =>
      Effect.gen(function* () {
        // A card's body is a column whose height follows its content (ADR 0042).
        const { warnings } = yield* tool("apply_operations", {
          ops: [
            inserted({
              children: [
                {
                  height: "fill",
                  role: "paragraph",
                  text: "Body",
                  type: "text",
                },
              ],
              component: "Card",
              from: "@ultrapaint/system",
              type: "instance",
            }),
          ],
          route: "/home",
        });
        assert.lengthOf(warnings ?? [], 1);
        assert.match(warnings?.[0] ?? "", FILL_IN_CARD);
      })
  );

  inAProject(
    "shows the nodes a thread is about to change and has changed, named by reference",
    () =>
      Effect.gen(function* () {
        const events = yield* EventBus;
        const { created } = yield* tool("apply_operations", {
          ops: [inserted({ role: "paragraph", text: "Hi", type: "text" })],
          route: "/home",
        });
        const [textId = ""] = created;
        // Started at once, each fiber has subscribed by the time the fork returns.
        const focused = yield* Effect.forkScoped(
          Stream.runHead(events.subscribe("agent.focus")),
          { startImmediately: true }
        );
        const edited = yield* Effect.forkScoped(
          Stream.runHead(events.subscribe("agent.edited")),
          { startImmediately: true }
        );
        yield* tool(
          "focus",
          { action: "rewording", nodes: [textId], route: "/home" },
          "t-1"
        );
        // The user pasted a reference: it stands for the page and for the node.
        yield* tool(
          "apply_operations",
          {
            ops: [
              { id: `/home#${textId}`, op: "update", set: { text: "Hello" } },
            ],
            route: `/home#${textId}`,
          },
          "t-1"
        );
        const focus = Option.getOrNull(yield* Fiber.join(focused));
        assert.deepStrictEqual(
          { action: focus?.action, nodeIds: focus?.nodeIds },
          { action: "rewording", nodeIds: [textId] }
        );
        const change = Option.getOrNull(yield* Fiber.join(edited));
        assert.deepStrictEqual(
          { nodeIds: change?.nodeIds, threadId: change?.threadId },
          { nodeIds: [textId], threadId: "t-1" }
        );
        assert.include(
          JSON.stringify(
            yield* tool("read_page", { route: `/home#${textId}` })
          ),
          "Hello"
        );
      })
  );

  inAProject(
    "reads only the fields that name a node as references, and keeps a link or a text with a #",
    () =>
      Effect.gen(function* () {
        const { created } = yield* tool("apply_operations", {
          ops: [inserted({ role: "paragraph", text: "Hi", type: "text" })],
          route: "/home",
        });
        const [textId = ""] = created;
        yield* tool("apply_operations", {
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
        const { document } = yield* tool("read_page", {
          node: textId,
          route: "/home",
        });
        const node = document as { link?: string; text?: string };
        assert.deepStrictEqual(
          { link: node.link, text: node.text },
          { link: "https://example.com/docs#intro", text: "/pricing#faq" }
        );
      })
  );

  inAProject("does not show an agent outside the editor on the canvas", () =>
    Effect.gen(function* () {
      const events = yield* EventBus;
      const focused = yield* Effect.forkScoped(
        Stream.runHead(events.subscribe("agent.focus")),
        { startImmediately: true }
      );
      yield* tool("focus", { route: "/home" });
      yield* tool("focus", { route: "/home" }, "t-1");
      // The first event is the thread's: the call from outside published none.
      assert.strictEqual(
        Option.getOrNull(yield* Fiber.join(focused))?.threadId,
        "t-1"
      );
    })
  );

  inAProject(
    "reads one node of a page, an outline, and the design system's schema on request",
    () =>
      Effect.gen(function* () {
        yield* pageAt("Parts", "/parts");
        yield* tool("apply_operations", {
          ops: [
            inserted({
              children: [
                { id: "hello", role: "paragraph", text: "Hi", type: "text" },
              ],
              id: "box",
              type: "row",
            }),
          ],
          route: "/parts",
        });
        const part = yield* tool("read_page", {
          node: "/parts#box",
          route: "/parts",
        });
        assert.strictEqual((part.document as { id: string }).id, "box");
        // An outline first: the row at the last level shown counts its children.
        const outline = yield* tool("read_page", { depth: 1, route: "/parts" });
        assert.deepInclude(
          (outline.document as { root: { children: object[] } }).root.children,
          { childCount: 1, id: "box", type: "row" }
        );
        assert.include(
          yield* refusal("read_page", { node: "nope", route: "/parts" }),
          "no node nope"
        );
        const { components } = yield* tool("list_components", {
          match: "dialog",
        });
        assert.deepStrictEqual(components, [
          "Dialog — size: md|sm|lg; props: title, description, open; slots: trigger, dialog-header, dialog-content*, dialog-footer",
        ]);
        const format = yield* tool("get_document_format", {
          kind: "design-system",
        });
        assert.include(JSON.stringify(format.schema), "typography");
      })
  );
});

describe("a big page, read as a task gives it", () => {
  inAProject(
    "reads a page too big to give whole as its outline, and a part of it whole",
    () =>
      Effect.gen(function* () {
        const deep = (id: string, child: Record<string, unknown>) => ({
          children: [child],
          id,
          type: "group",
        });
        yield* tool("apply_operations", {
          ops: [
            inserted(
              deep(
                "a",
                deep("b", {
                  children: ["one", "two", "three"].map((id) => ({
                    id,
                    role: "paragraph",
                    text: "word ".repeat(3000),
                    type: "text",
                  })),
                  id: "c",
                  type: "group",
                })
              )
            ),
          ],
          route: "/home",
        });
        const whole = yield* tool("read_page", { route: "/home" });
        assert.include(whole.outline ?? "", "read a part with node");
        assert.notInclude(JSON.stringify(whole.document), "word word");
        assert.include(JSON.stringify(whole.document), '"childCount":3');
        const part = yield* tool("read_page", { route: "/home#two" });
        assert.isUndefined(part.outline);
        assert.include(JSON.stringify(part.document), "word word");
      })
  );
});

describe("where a tool works, named by a node reference (ADR 0018)", () => {
  inAProject("reads only the node a reference names", () =>
    Effect.gen(function* () {
      const { document } = yield* tool("read_page", { route: "/home#heading" });
      assert.strictEqual((document as { id: string }).id, "heading");
    })
  );

  inAProject("reads the node a link copied from the editor names", () =>
    Effect.gen(function* () {
      const { document } = yield* tool("read_page", {
        route: "http://localhost:4643/?route=/home&node=heading",
      });
      assert.strictEqual((document as { id: string }).id, "heading");
    })
  );

  inAProject(
    "works on a variant's page named by the editor's link or by its file, the URL alone still naming the base page",
    () =>
      Effect.gen(function* () {
        yield* Effect.flatMap(OpenProject, (project) =>
          project.use(
            Effect.flatMap(PagesService, (p) =>
              p.createVariant("home.page.json", "bold")
            )
          )
        );
        yield* tool("apply_operations", {
          ops: [{ id: "heading", op: "update", set: { text: "Bold" } }],
          route: "http://localhost:4643/?route=/home&variant=bold&node=heading",
        });
        const textAt = (route: string) =>
          Effect.map(
            tool("read_page", { route }),
            ({ document }) => (document as { text: string }).text
          );
        assert.strictEqual(
          yield* textAt("home@bold.page.json#heading"),
          "Bold"
        );
        assert.notStrictEqual(yield* textAt("/home#heading"), "Bold");
      })
  );

  inAProject("shows the nodes a reference names, in focus", () =>
    Effect.gen(function* () {
      const events = yield* EventBus;
      const both = yield* Effect.forkScoped(
        Stream.runCollect(events.subscribe("agent.focus").pipe(Stream.take(2))),
        { startImmediately: true }
      );
      yield* tool("focus", { nodes: ["/home#heading"], route: "/home" }, "t-1");
      yield* tool("focus", { route: "/home#heading" }, "t-1");
      assert.deepStrictEqual(
        (yield* Fiber.join(both)).map((event) => event.nodeIds),
        [["heading"], ["heading"]]
      );
    })
  );

  inAProject(
    "reads and changes a node beside the pages named by its reference",
    () =>
      Effect.gen(function* () {
        yield* tool("apply_operations", {
          loose: true,
          ops: [
            inserted({
              id: "note",
              role: "paragraph",
              text: "Hi",
              type: "text",
            }),
          ],
        });
        yield* tool("apply_operations", {
          ops: [{ id: "note", op: "update", set: { text: "Hello" } }],
          route: "canvas#note",
        });
        const { document } = yield* tool("read_page", { route: "canvas#note" });
        assert.deepStrictEqual(
          {
            id: (document as { id: string }).id,
            text: (document as { text: string }).text,
          },
          { id: "note", text: "Hello" }
        );
      })
  );
});

describe("the tools for the design system", () => {
  inAProject(
    "validates the design system before it saves it, DESIGN.md at the root",
    () =>
      Effect.gen(function* () {
        assert.isNotEmpty(
          yield* refusal("write_design_system", {
            designSystem: { version: 1 },
          })
        );
        yield* tool("write_design_system", {
          designMd:
            "## Overview\n\nAcme. Use the primary colour for one action per screen.\n",
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
        });
        const system = yield* Effect.flatMap(OpenProject, (project) =>
          project.use(Effect.flatMap(DesignSystemService, (d) => d.get))
        );
        assert.strictEqual(
          system.designSystem?.colors[0]?.tokens[0]?.name,
          "color-primary"
        );
        assert.include(system.document?.text ?? "", "one action per screen");
        // At the root, its front matter filled in from the design system.
        assert.strictEqual(system.document?.path, "DESIGN.md");
        assert.include(system.document?.text ?? "", "colors:\n  primary:");
      })
  );
});

describe("get_screenshot", () => {
  const shoot = (
    parameters: Parameters<typeof callRawTool<typeof GetScreenshot>>[1]
  ) => callRawTool(GetScreenshot, parameters);

  inAProject("says at once that no editor is open to draw it", () =>
    Effect.gen(function* () {
      const alone = yield* shoot({ route: "/home" });
      assert.include(textOf(alone), "no editor is open");
      assert.include(
        textOf(yield* shoot({ node: "nowhere", route: "/home" })),
        "no node nowhere"
      );
    })
  );

  inAProject(
    "asks the open editor for a picture, and hands it on as an image",
    () =>
      Effect.gen(function* () {
        const screenshots = yield* Screenshots;
        // This test is the editor: it takes the request and draws a (very small) picture.
        const png =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        const requested = yield* Effect.forkScoped(
          screenshots.requests.pipe(
            Stream.tap((asked) =>
              screenshots.deliver({
                dataUrl: `data:image/png;base64,${png}`,
                requestId: asked.requestId,
              })
            ),
            Stream.runHead
          ),
          { startImmediately: true }
        );
        // The editor counts as open once it listens.
        yield* Stream.runHead(
          screenshots.editors.pipe(Stream.filter((n) => n > 0))
        );
        const shot = yield* shoot({ route: "/home", width: 390 });
        assert.isTrue(
          shot instanceof McpSchema.CallToolResult && shot.isError === false
        );
        const [image] =
          shot instanceof McpSchema.CallToolResult ? shot.content : [];
        assert.deepStrictEqual(
          image?.type === "image" && {
            data: Buffer.from(image.data).toString("base64"),
            mimeType: image.mimeType,
          },
          { data: png, mimeType: "image/png" }
        );
        const request = Option.getOrNull(yield* Fiber.join(requested));
        assert.deepStrictEqual(
          {
            mode: request?.mode,
            root: request?.root.type,
            width: request?.width,
          },
          { mode: "page", root: "page", width: 390 }
        );
      })
  );
});

describe("get_context", () => {
  inAProject("answers what the project is, as data", () =>
    Effect.gen(function* () {
      const { repo } = yield* ProjectFixture;
      const context = yield* tool("get_context", {});
      assert.strictEqual(context.root, repo);
      assert.deepStrictEqual(
        context.canvases.map((c) => c.id),
        [""]
      );
    })
  );
});

describe("a tool's failure, in the tools' words", () => {
  inAProject("sends an agent with a stale hash back to read the page", () =>
    Effect.gen(function* () {
      const said = yield* refusal("apply_operations", {
        expectedHash: "an old one",
        ops: [{ id: "heading", op: "update", set: { text: "Hi" } }],
        route: "/home",
      });
      assert.include(said, "read_page again");
      assert.notInclude(said, "reloading");
    })
  );

  inAProject("says what to do when no project is open", () =>
    Effect.gen(function* () {
      yield* Effect.flatMap(ProjectManager, (project) => project.close);
      const said = yield* refusal("list_pages", {});
      assert.notInclude(said, "no target repository configured");
      assert.include(said, "no project is open in the editor");
    })
  );
});
