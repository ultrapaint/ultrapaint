import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Ref, Stream } from "effect";
import {
  answerWithoutProject,
  makeLocator,
  makeRouting,
} from "./mcp-command.ts";
import {
  eventMessages,
  FOLDER_ARG,
  linkedProject,
  type McpTarget,
  makeRelay,
  type RelayMessage,
  RelayNoProject,
  RelayUnreachable,
  withFolder,
} from "./mcp-relay.ts";
import { KEPT_TOOLS_FILE } from "./services/mcp/kept-tools.ts";
import { TestEnv, TestServer } from "./testing/harness.ts";
import { waitFor } from "./testing/wait-for.ts";

const STATELESS = "2026-07-28";

const line = (message: Record<string, unknown>) =>
  JSON.stringify({ jsonrpc: "2.0", ...message });

/** A stateless request, as an agent speaking the 2026 revision sends it. */
const stateless = (id: number, method: string, params = {}) =>
  line({
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        "io.modelcontextprotocol/protocolVersion": STATELESS,
      },
    },
  });

/** The relay to the test's server, with what it says to the agent collected. */
const relayTo = (
  locate: (
    again: boolean,
    message: RelayMessage
  ) => Effect.Effect<McpTarget, RelayUnreachable | RelayNoProject>
) =>
  Effect.gen(function* () {
    const said = yield* Ref.make<readonly string[]>([]);
    const relay = yield* makeRelay({
      locate,
      say: (text) => Ref.update(said, (lines) => [...lines, text]),
      withoutProject: (text, why) =>
        Effect.succeed(answerWithoutProject(text, why, undefined)),
    });
    const answers = Effect.map(Ref.get(said), (lines) =>
      lines.map((text) => JSON.parse(text) as Record<string, unknown>)
    );
    return { answers, handle: relay.handle };
  });

/** The test server's MCP, with the project's token the server wrote as it started. */
const theServer = Effect.gen(function* () {
  const { home, port } = yield* TestEnv;
  const fs = yield* FileSystem.FileSystem;
  const token = (yield* fs.readFileString(path.join(home, "mcp-token"))).trim();
  return { token, url: `http://127.0.0.1:${port}/mcp` } satisfies McpTarget;
});

const toolsIn = (answer: Record<string, unknown> | undefined) =>
  (
    (answer?.result as { tools?: { name: string }[] } | undefined)?.tools ?? []
  ).map((tool) => tool.name);

describe("the relay of ultrapaint mcp (ADR 0083)", () => {
  // real clock: the relay over a real socket to a real server.
  it.live(
    "passes a stateless agent's calls to the project's server and its answers back",
    () =>
      Effect.gen(function* () {
        const target = yield* theServer;
        const { answers, handle } = yield* relayTo(() =>
          Effect.succeed(target)
        );
        yield* handle(stateless(1, "tools/list"));
        yield* handle(
          stateless(2, "tools/call", {
            arguments: { [FOLDER_ARG]: "/somewhere" },
            name: "list_pages",
          })
        );
        const [listed, called] = yield* answers;
        assert.include(toolsIn(listed), "create_page");
        // Each tool is given with the folder among its arguments, which the server never sees.
        const { tools } = (listed?.result ?? { tools: [] }) as {
          tools: { inputSchema: { required: string[] } }[];
        };
        for (const tool of tools) {
          assert.include(tool.inputSchema.required, FOLDER_ARG);
        }
        assert.strictEqual(called?.id, 2);
        assert.isUndefined(called?.error);
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    60_000
  );

  // real clock: the relay over a real socket to a real server.
  it.live(
    "keeps an older revision's session from initialize to the calls after it",
    () =>
      Effect.gen(function* () {
        const target = yield* theServer;
        const { answers, handle } = yield* relayTo(() =>
          Effect.succeed(target)
        );
        yield* handle(
          line({
            id: 1,
            method: "initialize",
            params: {
              capabilities: {},
              clientInfo: { name: "test", version: "1" },
              protocolVersion: "2025-06-18",
            },
          })
        );
        yield* handle(line({ method: "notifications/initialized" }));
        yield* handle(line({ id: 2, method: "tools/list" }));
        const [initialized, listed] = yield* answers;
        assert.strictEqual(
          (initialized?.result as { protocolVersion?: string } | undefined)
            ?.protocolVersion,
          "2025-06-18"
        );
        assert.include(toolsIn(listed), "create_page");
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    60_000
  );

  // real clock: the relay over a real socket to a real server.
  it.live(
    "looks for the server again when the address it knew answers no more",
    () =>
      Effect.gen(function* () {
        const target = yield* theServer;
        // A server that has gone: its port, closed by now.
        const gone = yield* Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              const probe = createServer();
              probe.listen(0, "127.0.0.1", () => {
                const address = probe.address();
                const port =
                  address && typeof address === "object" ? address.port : 0;
                probe.close(() => resolve(port));
              });
            })
        );
        const asked = yield* Ref.make<readonly boolean[]>([]);
        const { answers, handle } = yield* relayTo((again) =>
          Effect.as(
            Ref.update(asked, (all) => [...all, again]),
            again ? target : { ...target, url: `http://127.0.0.1:${gone}/mcp` }
          )
        );
        yield* handle(stateless(1, "tools/list"));
        assert.deepStrictEqual(yield* Ref.get(asked), [false, true]);
        assert.include(toolsIn((yield* answers)[0]), "create_page");
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    60_000
  );

  // real clock: a server of the test's own, over a real socket.
  it.live("passes a call on without the folder, which is the relay's", () =>
    Effect.gen(function* () {
      const bodies: string[] = [];
      const port = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<{ close: () => void; port: number }>((resolve) => {
              const server = createHttpServer((request, response) => {
                let body = "";
                request.on("data", (chunk) => {
                  body += chunk;
                });
                request.on("end", () => {
                  bodies.push(body);
                  response.setHeader("content-type", "application/json");
                  response.end(line({ id: 1, result: {} }));
                });
              });
              server.listen(0, "127.0.0.1", () => {
                const address = server.address();
                resolve({
                  close: () => server.close(),
                  port:
                    address && typeof address === "object" ? address.port : 0,
                });
              });
            })
        ),
        (server) => Effect.sync(server.close)
      );
      const { handle } = yield* relayTo(() =>
        Effect.succeed({
          token: "t",
          url: `http://127.0.0.1:${port.port}/mcp`,
        })
      );
      yield* handle(
        stateless(1, "tools/call", {
          arguments: { [FOLDER_ARG]: "/code/acme", page: "/pricing" },
          name: "read_page",
        })
      );
      const sent = JSON.parse(bodies[0] ?? "{}");
      assert.deepStrictEqual(sent.params.arguments, { page: "/pricing" });
      assert.strictEqual(sent.params.name, "read_page");
      assert.strictEqual(sent.jsonrpc, "2.0");
    }).pipe(Effect.scoped)
  );

  it.effect("answers a request with why, when no server can be reached", () =>
    Effect.gen(function* () {
      const { answers, handle } = yield* relayTo(() =>
        Effect.fail(
          new RelayUnreachable({ message: "Ultrapaint isn't running" })
        )
      );
      yield* handle(stateless(7, "tools/list"));
      // A notification has nothing to answer with.
      yield* handle(line({ method: "notifications/initialized" }));
      assert.deepStrictEqual(yield* answers, [
        {
          error: { code: -32_603, message: "Ultrapaint isn't running" },
          id: 7,
          jsonrpc: "2.0",
        },
      ]);
    })
  );
});

describe("an event stream's messages", () => {
  it.effect(
    "are each event's data, its lines joined, the last one kept at the end",
    () =>
      Effect.gen(function* () {
        const messages = yield* eventMessages(
          Stream.make(
            'event: message\ndata: {"id":1}\n\n',
            ': a comment\ndata: {"id":\ndata: 2}\n\n',
            'data: {"id":3}'
          )
        ).pipe(Stream.runCollect);
        assert.deepStrictEqual(messages, [
          '{"id":1}',
          '{"id":\n2}',
          '{"id":3}',
        ]);
      })
  );
});

describe("a call that names its project by a link (ADR 0083)", () => {
  it("is to the project the link's folder is, wherever among its arguments the link is", () => {
    const link =
      "http://127.0.0.1:41234/?project=%2Fhome%2Fu%2Facme&route=/pricing&node=c_1";
    assert.strictEqual(
      linkedProject({
        method: "tools/call",
        params: {
          arguments: { operations: [{ node: link, type: "set" }] },
          name: "apply_operations",
        },
      }),
      "/home/u/acme"
    );
    assert.isUndefined(
      linkedProject({
        method: "tools/call",
        params: { arguments: { page: "/pricing" }, name: "read_page" },
      })
    );
  });

  it.effect("with no project to send it to, is answered here, saying why", () =>
    Effect.gen(function* () {
      const why = "No Ultrapaint project in /somewhere";
      const { answers, handle } = yield* relayTo(() =>
        Effect.fail(new RelayNoProject({ message: why }))
      );
      yield* handle(
        line({
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-11-25" },
        })
      );
      yield* handle(line({ id: 2, method: "tools/call" }));
      const [initialized, called] = yield* answers;
      assert.strictEqual(
        (initialized?.result as { instructions?: string } | undefined)
          ?.instructions,
        why
      );
      assert.deepStrictEqual(called?.error, { code: -32_601, message: why });
    })
  );
});

describe("the folder a tool is called from (ADR 0083)", () => {
  const projects: Record<string, string> = {
    "/code/acme": "/code/acme",
    "/code/acme/web": "/code/acme",
    "/code/shop": "/code/shop",
  };
  const route = () =>
    makeRouting({
      isAbsolute: (folder) => folder.startsWith("/"),
      projectAt: (folder) =>
        Effect.succeed(Option.fromNullishOr(projects[folder])),
      started: "/home/u",
    });
  const call = (args: Record<string, unknown>) => ({
    method: "tools/call",
    params: { arguments: args, name: "read_page" },
  });
  const link =
    "http://127.0.0.1:41234/?project=%2Fcode%2Fshop&route=/pricing&node=c_1";

  it("is given to every tool, once, as one the agent must say", () => {
    const listed = withFolder({
      tools: [
        { inputSchema: { type: "object" }, name: "list_pages" },
        {
          inputSchema: {
            properties: { page: { type: "string" } },
            required: ["page"],
            type: "object",
          },
          name: "read_page",
        },
      ],
    }) as { tools: { inputSchema: { required: string[] } }[] };
    assert.deepStrictEqual(
      listed.tools.map((tool) => tool.inputSchema.required),
      [[FOLDER_ARG], ["page", FOLDER_ARG]]
    );
    assert.deepStrictEqual(withFolder(listed), listed);
  });

  it.effect(
    "says the project, by the configuration found from it upwards",
    () =>
      Effect.gen(function* () {
        const to = route();
        assert.strictEqual(
          yield* to(call({ [FOLDER_ARG]: "/code/acme/web" })),
          "/code/acme"
        );
        assert.strictEqual(
          yield* to(call({ [FOLDER_ARG]: "/code/shop" })),
          "/code/shop"
        );
      })
  );

  it.effect(
    "keeps a link's project for the calls from that folder after it, and not for another folder's",
    () =>
      Effect.gen(function* () {
        const to = route();
        assert.strictEqual(
          yield* to(call({ [FOLDER_ARG]: "/notes", node: link })),
          "/code/shop"
        );
        assert.strictEqual(
          yield* to(call({ [FOLDER_ARG]: "/notes" })),
          "/code/shop"
        );
        assert.strictEqual(
          yield* to(call({ [FOLDER_ARG]: "/code/acme" })),
          "/code/acme"
        );
      })
  );

  it.effect(
    "with none, is the command's own, and a folder without a project, or not absolute, is said why",
    () =>
      Effect.gen(function* () {
        const to = route();
        const failed = (message: Record<string, unknown>) =>
          Effect.map(Effect.flip(to(message)), (error) => error.message);
        assert.include(yield* failed({ method: "tools/list" }), "/home/u");
        assert.include(
          yield* failed(call({ [FOLDER_ARG]: "/notes" })),
          "No Ultrapaint project in /notes"
        );
        assert.include(
          yield* failed(call({ [FOLDER_ARG]: "." })),
          "absolute path"
        );
      })
  );
});

describe("a server as it starts (ADR 0083)", () => {
  // real clock: the list is asked of the real server once it answers.
  it.live(
    "keeps its tools in the user's directory, for a folder with no project",
    () =>
      Effect.gen(function* () {
        const { home } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        // The server lists its tools once it answers, a moment after it started.
        const kept = yield* waitFor(
          fs
            .readFileString(path.join(home, KEPT_TOOLS_FILE))
            .pipe(Effect.orElseSucceed(() => "")),
          (text) => text !== ""
        );
        assert.include(
          (JSON.parse(kept) as { tools: { name: string }[] }).tools.map(
            (tool) => tool.name
          ),
          "create_page"
        );
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    60_000
  );
});

describe("a server the relay starts (ADR 0083)", () => {
  it.effect(
    "writes its log to the project's state, not the relay's stderr, which over SSH is the session's, and a server that does not start is said with its log's end",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const stateDir = path.join(dir, ".ultrapaint");
        // A "server" that says why it cannot start, and ends.
        const locate = yield* makeLocator(
          { dir, stateDir },
          Option.some(
            JSON.stringify(["/bin/sh", "-c", "echo 'port taken' >&2; exit 1"])
          )
        );
        const failed = yield* Effect.flip(locate(false));
        assert.include(failed.message, "did not start");
        assert.include(failed.message, "port taken");
        assert.strictEqual(
          (yield* fs.readFileString(
            path.join(stateDir, "mcp-server.log")
          )).trim(),
          "port taken"
        );
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
  );
});

describe("in a folder with no project", () => {
  const why = "No Ultrapaint project in /somewhere";
  const answered = (request: Record<string, unknown>, tools?: unknown) =>
    JSON.parse(answerWithoutProject(line(request), why, tools) ?? "{}");

  it("connects, says why, and offers the tools a server listed last, so a pasted link can be used", () => {
    const kept = { tools: [{ name: "read_page" }] };
    const initialized = answered(
      {
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      },
      kept
    );
    assert.strictEqual(initialized.result.protocolVersion, "2025-11-25");
    assert.strictEqual(initialized.result.instructions, why);
    assert.deepStrictEqual(initialized.result.capabilities, { tools: {} });
    assert.deepStrictEqual(
      answered({ id: 2, method: "tools/list" }, kept).result,
      withFolder(kept)
    );
  });

  it("offers no tools before any server listed them", () => {
    assert.deepStrictEqual(answered({ id: 2, method: "tools/list" }).result, {
      tools: [],
    });
  });

  it("answers anything else with why, and a notification with nothing", () => {
    assert.strictEqual(
      answered({ id: 3, method: "tools/call" }).error.code,
      -32_601
    );
    assert.isUndefined(
      answerWithoutProject(
        line({ method: "notifications/initialized" }),
        why,
        undefined
      )
    );
  });
});
