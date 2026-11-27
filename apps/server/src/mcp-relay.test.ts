import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Option,
  Ref,
  Stream,
} from "effect";
import {
  answerInitialize,
  answerWithoutProject,
  makeLocator,
  makeRouting,
} from "./mcp-command.ts";
import {
  eventMessages,
  FOLDER_ARG,
  type KeptTools,
  linkedProject,
  type McpTarget,
  makeRelay,
  type RelayMessage,
  RelayNoProject,
  RelayUnreachable,
  type Way,
  withFolder,
} from "./mcp-relay.ts";
import { KEPT_TOOLS_FILE } from "./services/mcp/kept-tools.ts";
import { MCP_INSTRUCTIONS } from "./services/mcp/route.ts";
import { REAL_CLOCK_TIMEOUT_MS } from "./testing/each-test.ts";
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

/**
 * The relay to the test's server, by a way to it (a whole one, or `reach` with no server running
 * until it is reached), or to no project at all, by `locate`, with what it says to the agent
 * collected.
 */
const relayTo = (
  to: Way | Way["reach"],
  options: {
    /** The tools a server listed last, kept. */
    readonly kept?: KeptTools;
    readonly locate?: (
      message: RelayMessage
    ) => Effect.Effect<Way, RelayNoProject>;
  } = {}
) =>
  Effect.gen(function* () {
    const way: Way =
      typeof to === "function"
        ? { reach: to, running: Effect.succeedNone }
        : to;
    const said = yield* Ref.make<readonly string[]>([]);
    const listed = yield* Ref.make<readonly KeptTools[]>([]);
    const firstListed = yield* Deferred.make<KeptTools>();
    const changed = yield* Deferred.make<void>();
    const relay = yield* makeRelay({
      answerInitialize: (text) =>
        Effect.succeed(answerInitialize(text, options.kept?.instructions)),
      keptTools: Effect.succeed(options.kept),
      locate: options.locate ?? (() => Effect.succeed(way)),
      say: (text) =>
        Effect.gen(function* () {
          yield* Ref.update(said, (lines) => [...lines, text]);
          if (text.includes('"notifications/tools/list_changed"')) {
            yield* Deferred.succeed(changed, undefined);
          }
        }),
      toolsListed: (kept) =>
        Effect.gen(function* () {
          yield* Ref.update(listed, (all) => [...all, kept]);
          yield* Deferred.succeed(firstListed, kept);
        }),
      withoutProject: (text, why) =>
        Effect.succeed(answerWithoutProject(text, why, options.kept)),
    });
    const answers = Effect.map(Ref.get(said), (lines) =>
      lines.map((text) => JSON.parse(text) as Record<string, unknown>)
    );
    return {
      answers,
      handle: relay.handle,
      /** Once the relay has told the agent the tools changed. */
      listChanged: Deferred.await(changed),
      listed: Ref.get(listed),
      /** Once the relay has kept a server's list: the first it kept. */
      listedOnce: Deferred.await(firstListed),
    };
  });

/** The test server's MCP, with the project's token the server wrote as it started. */
const theServer = Effect.gen(function* () {
  const { home, port } = yield* TestEnv;
  const fs = yield* FileSystem.FileSystem;
  const token = (yield* fs.readFileString(path.join(home, "mcp-token"))).trim();
  return { token, url: `http://127.0.0.1:${port}/mcp` } satisfies McpTarget;
});

/** A way to a server the test never lets the relay reach. */
const neverReached: Way["reach"] = () => Effect.never;

/** An older revision's `initialize`, as Claude Code and Codex send it. */
const initialize = (protocolVersion = "2025-06-18") =>
  line({
    id: 1,
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
      protocolVersion,
    },
  });

/** What the server answers to a message posted straight to it, outside any session. */
const askServer = (target: McpTarget, body: string) =>
  Effect.promise(() =>
    fetch(target.url, {
      body,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "x-ultrapaint-token": target.token,
      },
      method: "POST",
    }).then((response) => response.json() as Promise<unknown>)
  );

/**
 * A server of the test's own, over a real socket: it answers every request with an empty result,
 * and keeps each message it was sent; one that drops notifications hangs up on each.
 */
const fakeServerWith = (options: { readonly dropNotifications?: boolean }) =>
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
                const { id } = JSON.parse(body) as { id?: unknown };
                if (id === undefined && options.dropNotifications) {
                  request.socket.destroy();
                  return;
                }
                if (id === undefined) {
                  response.statusCode = 202;
                  response.end();
                  return;
                }
                response.setHeader("content-type", "application/json");
                response.end(line({ id, result: {} }));
              });
            });
            server.listen(0, "127.0.0.1", () => {
              const address = server.address();
              resolve({
                close: () => server.close(),
                port: address && typeof address === "object" ? address.port : 0,
              });
            });
          })
      ),
      (server) => Effect.sync(server.close)
    );
    return {
      /** Where it listens, as a server's ready line says it. */
      origin: `http://127.0.0.1:${port.port}`,
      /** What it was sent, each message parsed. */
      sent: () =>
        bodies.map(
          (body) => JSON.parse(body) as { method?: string; params?: unknown }
        ),
      target: {
        token: "t",
        url: `http://127.0.0.1:${port.port}/mcp`,
      } satisfies McpTarget,
    };
  });
const fakeServer = fakeServerWith({});

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
      const server = yield* fakeServer;
      const { handle } = yield* relayTo(() => Effect.succeed(server.target));
      yield* handle(
        stateless(1, "tools/call", {
          arguments: { [FOLDER_ARG]: "/code/acme", page: "/pricing" },
          name: "read_page",
        })
      );
      const [sent] = server.sent() as {
        jsonrpc?: string;
        params: { arguments: unknown; name: string };
      }[];
      assert.deepStrictEqual(sent?.params.arguments, { page: "/pricing" });
      assert.strictEqual(sent?.params.name, "read_page");
      assert.strictEqual(sent?.jsonrpc, "2.0");
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
      yield* handle(
        line({ method: "notifications/cancelled", params: { requestId: 7 } })
      );
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

describe("before the project's server has started (ADR 0164)", () => {
  /** A way to the server that is still starting until the test says it answers, or why not. */
  const stillStarting = Effect.gen(function* () {
    const started = yield* Deferred.make<McpTarget, RelayUnreachable>();
    return { reach: () => Deferred.await(started), started };
  });
  const call = line({
    id: 2,
    method: "tools/call",
    params: { arguments: { [FOLDER_ARG]: "/somewhere" }, name: "list_pages" },
  });

  // real clock: the answer is compared with the real server's, over a real socket.
  it.live(
    "answers initialize at once, as the project's server does",
    () =>
      Effect.gen(function* () {
        const target = yield* theServer;
        const { reach } = yield* stillStarting;
        for (const revision of ["2025-06-18", "2025-11-25", "2024-11-05"]) {
          const { answers, handle } = yield* relayTo(reach);
          yield* handle(initialize(revision));
          assert.deepStrictEqual(
            (yield* answers)[0],
            yield* askServer(target, initialize(revision))
          );
        }
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    REAL_CLOCK_TIMEOUT_MS
  );

  it("says the instructions a server left beside its tools", () => {
    const answered = JSON.parse(answerInitialize(initialize(), "kept words"));
    assert.strictEqual(answered.result.instructions, "kept words");
    assert.strictEqual(
      JSON.parse(answerInitialize(initialize(), undefined)).result.instructions,
      MCP_INSTRUCTIONS
    );
  });

  // real clock: a server of the test's own, over a real socket.
  it.live(
    "has the first call wait for the server, which is told initialize before it",
    () =>
      Effect.gen(function* () {
        const server = yield* fakeServer;
        const { reach, started } = yield* stillStarting;
        const { answers, handle } = yield* relayTo(reach);
        yield* handle(initialize());
        yield* handle(line({ method: "notifications/initialized" }));
        const calling = yield* Effect.forkChild(handle(call));
        yield* Deferred.succeed(started, server.target);
        yield* Fiber.join(calling);
        const [initialized, called] = yield* answers;
        assert.isDefined(initialized?.result);
        assert.deepStrictEqual(called, { id: 2, jsonrpc: "2.0", result: {} });
        assert.deepStrictEqual(
          server.sent().map((message) => message.method),
          ["initialize", "notifications/initialized", "tools/call"]
        );
      }).pipe(Effect.scoped)
  );

  // real clock: the relay over a real socket to a real server.
  it.live(
    "offers the tools a server listed last, and says when the server's own differ",
    () =>
      Effect.gen(function* () {
        const target = yield* theServer;
        const { reach, started } = yield* stillStarting;
        const kept = {
          tools: [{ inputSchema: { type: "object" }, name: "old_tool" }],
        };
        const {
          answers,
          handle,
          listChanged,
          listed: keptAfter,
        } = yield* relayTo(reach, { kept });
        yield* handle(initialize());
        yield* handle(line({ id: 2, method: "tools/list" }));
        const [, listed] = yield* answers;
        assert.deepStrictEqual(listed?.result, withFolder(kept));
        yield* Deferred.succeed(started, target);
        yield* listChanged;
        yield* handle(line({ id: 3, method: "tools/list" }));
        assert.include(toolsIn((yield* answers).at(-1)), "create_page");
        // The server's list is kept with what that server said at initialize.
        const [keptNow] = yield* keptAfter;
        assert.strictEqual(keptNow?.instructions, MCP_INSTRUCTIONS);
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    REAL_CLOCK_TIMEOUT_MS
  );

  // real clock: the relay over a real socket to a real server.
  it.live(
    "says nothing changed when the server lists the tools that were kept",
    () =>
      Effect.gen(function* () {
        const target = yield* theServer;
        const { reach, started } = yield* stillStarting;
        const { home } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        // The server keeps its own list as it starts: the one the relay is about to be given.
        const kept = JSON.parse(
          yield* waitFor(
            fs
              .readFileString(path.join(home, KEPT_TOOLS_FILE))
              .pipe(Effect.orElseSucceed(() => "")),
            (text) => text !== ""
          )
        ) as KeptTools;
        const { answers, handle, listedOnce } = yield* relayTo(reach, {
          kept,
        });
        yield* handle(initialize());
        yield* handle(line({ id: 2, method: "tools/list" }));
        yield* Deferred.succeed(started, target);
        yield* listedOnce;
        // A call to the server after it, which the notification would have come before.
        yield* handle(line({ id: 3, method: "tools/list" }));
        assert.notInclude(
          (yield* answers).map((message) => message.method),
          "notifications/tools/list_changed"
        );
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    REAL_CLOCK_TIMEOUT_MS
  );

  // real clock: the relay over a real socket to a real server.
  it.live(
    "with no tools kept, has tools/list wait for the server",
    () =>
      Effect.gen(function* () {
        const target = yield* theServer;
        const { reach, started } = yield* stillStarting;
        const { answers, handle } = yield* relayTo(reach);
        yield* handle(initialize());
        const listing = yield* Effect.forkChild(
          handle(line({ id: 2, method: "tools/list" }))
        );
        yield* Deferred.succeed(started, target);
        yield* Fiber.join(listing);
        assert.include(toolsIn((yield* answers)[1]), "create_page");
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    REAL_CLOCK_TIMEOUT_MS
  );
});

describe("a project whose server already runs (ADR 0164)", () => {
  // real clock: a server of the test's own, over a real socket.
  it.live(
    "has it answer initialize, and the calls after it go in that session",
    () =>
      Effect.gen(function* () {
        const server = yield* fakeServer;
        const { answers, handle } = yield* relayTo({
          reach: () => Effect.succeed(server.target),
          running: Effect.succeedSome(server.target),
        });
        yield* handle(initialize());
        yield* handle(line({ method: "notifications/initialized" }));
        yield* handle(
          line({
            id: 2,
            method: "tools/call",
            params: { arguments: {}, name: "list_pages" },
          })
        );
        // The server's own answer, not the relay's.
        assert.deepStrictEqual((yield* answers)[0], {
          id: 1,
          jsonrpc: "2.0",
          result: {},
        });
        assert.deepStrictEqual(
          server.sent().map((message) => message.method),
          ["initialize", "notifications/initialized", "tools/call"]
        );
      }).pipe(Effect.scoped),
    REAL_CLOCK_TIMEOUT_MS
  );

  // real clock: a server of the test's own, over a real socket.
  it.live(
    "gives its answer alone when it is lost before it hears the agent is ready",
    () =>
      Effect.gen(function* () {
        const server = yield* fakeServerWith({ dropNotifications: true });
        const reached = yield* Ref.make(0);
        const { answers, handle } = yield* relayTo({
          reach: () =>
            Effect.as(
              Ref.update(reached, (n) => n + 1),
              server.target
            ),
          running: Effect.succeedSome(server.target),
        });
        yield* handle(initialize());
        assert.deepStrictEqual(yield* answers, [
          { id: 1, jsonrpc: "2.0", result: {} },
        ]);
        // Nothing was started for it: the next call finds the server again.
        assert.strictEqual(yield* Ref.get(reached), 0);
      }).pipe(Effect.scoped),
    REAL_CLOCK_TIMEOUT_MS
  );

  // real clock: a server of the test's own, over a real socket.
  it.live(
    "answers initialize itself when the one running answers no more",
    () =>
      Effect.gen(function* () {
        const server = yield* fakeServer;
        const { answers, handle } = yield* relayTo({
          reach: () => Effect.succeed(server.target),
          // A run file still naming a server that has gone: nothing listens on port 9.
          running: Effect.succeedSome({
            token: "t",
            url: "http://127.0.0.1:9/mcp",
          }),
        });
        yield* handle(initialize());
        const [initialized] = yield* answers;
        assert.strictEqual(
          (initialized?.result as { instructions?: string } | undefined)
            ?.instructions,
          MCP_INSTRUCTIONS
        );
      }).pipe(Effect.scoped),
    REAL_CLOCK_TIMEOUT_MS
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
      const { answers, handle } = yield* relayTo(neverReached, {
        locate: () => Effect.fail(new RelayNoProject({ message: why })),
      });
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
        const file = JSON.parse(kept) as {
          instructions?: string;
          tools: { name: string }[];
        };
        assert.include(
          file.tools.map((tool) => tool.name),
          "create_page"
        );
        // What it says at initialize, which the command says before a server has started.
        assert.strictEqual(file.instructions, MCP_INSTRUCTIONS);
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    60_000
  );
});

describe("a server the relay starts (ADR 0083)", () => {
  /** A project whose server, when started, counts its start and runs `then`. */
  const projectStarting = (then: (dir: string) => string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const stateDir = path.join(dir, ".ultrapaint");
      yield* fs.makeDirectory(stateDir, { recursive: true });
      yield* fs.writeFileString(path.join(stateDir, "mcp-token"), "t");
      const counted = path.join(dir, "starts");
      const locate = yield* makeLocator(
        { dir, stateDir },
        Option.some(
          JSON.stringify(["/bin/sh", "-c", `echo >> ${counted}; ${then(dir)}`])
        )
      );
      const starts = Effect.map(
        fs.readFileString(counted).pipe(Effect.orElseSucceed(() => "")),
        (text) => text.split("\n").length - 1
      );
      return { locate, starts };
    });
  const callOf = (id: number) =>
    line({
      id,
      method: "tools/call",
      params: { arguments: { [FOLDER_ARG]: "/code/acme" }, name: "list_pages" },
    });

  // real clock: a server of the test's own, over a real socket, started as a child process.
  it.live(
    "is started once, on initialize, and every call after it reaches that one",
    () =>
      Effect.gen(function* () {
        const server = yield* fakeServer;
        // It says where it listens, and stays a moment, as a server does until its stdin closes.
        const { locate, starts } = yield* projectStarting(
          () => `echo '{"url":"${server.origin}"}'; sleep 5`
        );
        const { answers, handle } = yield* relayTo(locate);
        yield* handle(initialize());
        yield* handle(callOf(2));
        yield* handle(callOf(3));
        assert.deepStrictEqual(
          (yield* answers).slice(1).map((answer) => answer.result),
          [{}, {}]
        );
        assert.strictEqual(yield* starts, 1);
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
    REAL_CLOCK_TIMEOUT_MS
  );

  it.effect(
    "that does not start is said on the first call with its log's end, and started anew by the next",
    () =>
      Effect.gen(function* () {
        const { locate, starts } = yield* projectStarting(
          () => "echo 'port taken' >&2; exit 1"
        );
        const { answers, handle } = yield* relayTo(locate);
        yield* handle(initialize());
        yield* handle(callOf(2));
        const [initialized, called] = yield* answers;
        assert.isDefined(initialized?.result);
        assert.include(
          (called?.error as { message: string } | undefined)?.message,
          "port taken"
        );
        // The start begun at initialize is the one the first call was told of.
        assert.strictEqual(yield* starts, 1);
        yield* handle(callOf(3));
        assert.strictEqual(yield* starts, 2);
      }).pipe(Effect.provide(NodeServices.layer)),
    REAL_CLOCK_TIMEOUT_MS
  );

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
        // None runs for it, and asking which one runs starts none.
        assert.isTrue(Option.isNone(yield* locate.running));
        const failed = yield* Effect.flip(locate.reach(false));
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

describe("the server a project's calls reach (ADR 0083)", () => {
  // real clock: the run file's server is asked over a real socket whether it is this run's.
  it.live(
    "is the one running for it, an editor's, and none is started beside it",
    () =>
      Effect.gen(function* () {
        const { home } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const started = path.join(dir, "started");
        const locate = yield* makeLocator(
          { dir, stateDir: home },
          Option.some(JSON.stringify(["/bin/sh", "-c", `touch ${started}`]))
        );
        const server = yield* theServer;
        assert.deepStrictEqual(yield* locate.running, Option.some(server));
        assert.deepStrictEqual(yield* locate.reach(false), server);
        assert.isFalse(yield* fs.exists(started));
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    REAL_CLOCK_TIMEOUT_MS
  );
});

describe("in a folder with no project", () => {
  const why = "No Ultrapaint project in /somewhere";
  const answered = (request: Record<string, unknown>, tools?: KeptTools) =>
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
