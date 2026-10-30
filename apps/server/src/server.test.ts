import { request } from "node:http";
import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import {
  type DocumentChange,
  type DocumentState,
  isWholeDocument,
} from "@ultrapaint/contracts/document";
import { withChangedNodes } from "@ultrapaint/design-document/patch";
import { childrenOf } from "@ultrapaint/design-document/tree";
import {
  Effect,
  Fiber,
  FileSystem,
  type Layer,
  type Scope,
  Stream,
} from "effect";
import {
  anotherClient,
  nextEvent,
  TestEnv,
  TestServer,
} from "./testing/harness.ts";
import { toolCaller } from "./testing/mcp.ts";

/**
 * A test of what only the wire does, on a server of its own over a socket. The real clock: what
 * is under test is the server's IO, which a test clock does not drive.
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
  it.live(
    name,
    () => body().pipe(Effect.provide(TestServer), Effect.scoped),
    timeout
  );

/** The fixture opened, as saving its settings opens it. */
const opened = Effect.flatMap(TestEnv, ({ client, settings }) =>
  Effect.asVoid(client["settings.set"](settings))
);

const SHA_RE = /^[0-9a-f]{40}$/;
const HOME = "home.page.json";
/** What a WebSocket handshake sends; a 101 is the socket accepted. */
const UPGRADE = {
  Connection: "Upgrade",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version": "13",
  Upgrade: "websocket",
};

/** The status a raw request to the server is answered with, its headers exactly as given. */
const statusOf = (
  port: number,
  target: string,
  headers: Record<string, string>,
  method = "GET"
) =>
  Effect.callback<number>((resume) => {
    // A fresh connection each time: the server closes one it refused an upgrade on.
    const req = request({
      agent: false,
      headers,
      host: "127.0.0.1",
      method,
      path: target,
      port,
    });
    req.on("response", (res) => {
      res.resume();
      resume(Effect.succeed(res.statusCode ?? 0));
    });
    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      resume(Effect.succeed(101));
    });
    req.on("error", () => resume(Effect.succeed(-1)));
    req.end();
  });

describe("server over WebSocket RPC", () => {
  onAServer("answers before any repository is configured", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      assert.isUndefined((yield* client["project.info"]()).settings);
      assert.isFalse((yield* client["project.info"]()).configured);
    })
  );

  onAServer("fails project requests with a typed NotConfigured", () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      const error = yield* Effect.flip(client["pages.list"]());
      assert.strictEqual(error._tag, "NotConfigured");
    })
  );

  onAServer("rejects a payload that does not match the schema", () =>
    Effect.gen(function* () {
      const { client, settings } = yield* TestEnv;
      const exit = yield* Effect.exit(
        client["settings.set"]({ ...settings, codeTokens: "neon" as "auto" })
      );
      assert.strictEqual(exit._tag, "Failure");
    })
  );

  onAServer("reports what is wrong with settings instead of saving them", () =>
    Effect.gen(function* () {
      const { client, settings } = yield* TestEnv;
      const validation = yield* client["settings.set"]({
        ...settings,
        designsDir: "missing",
      });
      assert.isFalse(validation.ok);
      assert.include(validation.problems.join("\n"), "missing");
      assert.isUndefined((yield* client["project.info"]()).settings);
    })
  );

  onAServer("opens the project when valid settings are saved", () =>
    Effect.gen(function* () {
      const { client, repo, settings } = yield* TestEnv;
      const validation = yield* client["settings.set"](settings);
      assert.deepStrictEqual(validation.problems, []);
      assert.strictEqual(validation.branch, "main");
      const info = yield* client["project.info"]();
      assert.isTrue(info.configured);
      assert.strictEqual(info.repoPath, repo);
      assert.strictEqual(info.branch, "main");
    })
  );

  onAServer(
    "keeps the project open when the settings it runs with are set again",
    () =>
      Effect.gen(function* () {
        const { client, settings } = yield* TestEnv;
        yield* client["settings.set"](settings);
        yield* client["documents.apply"]({
          edits: [
            {
              doc: HOME,
              ops: [{ id: "heading", op: "update", set: { name: "Title" } }],
            },
          ],
          label: "Name the title",
        });
        yield* client["settings.set"](settings);
        // Reopening would have started a new undo history.
        assert.strictEqual(
          (yield* client["edit.state"]()).undoLabel,
          "Name the title"
        );
        yield* client["edit.undo"]();
      })
  );

  onAServer(
    "pushes the document when a page is written outside the editor, ids filled in",
    () =>
      Effect.gen(function* () {
        yield* opened;
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const file = path.join(repo, "designs/log-in.page.json");
        // What an agent might write: a node without an id.
        const written = {
          root: {
            children: [{ role: "paragraph", text: "By hand", type: "text" }],
            id: "root",
            type: "page",
          },
          version: 1,
        };
        const { event } = yield* nextEvent(
          client["events.document"]().pipe(
            Stream.filter((e) => e.doc === "log-in.page.json")
          ),
          fs.writeFileString(file, JSON.stringify(written))
        );
        assert.strictEqual(
          event._tag === "Some" ? event.value.doc : "",
          "log-in.page.json"
        );
        // The new node, in the whole page or among the nodes that changed.
        const told = event._tag === "Some" ? event.value : undefined;
        let nodes: readonly {
          readonly id?: unknown;
          readonly text?: unknown;
        }[] = [];
        if (told && isWholeDocument(told)) {
          nodes = told.root ? childrenOf(told.root) : [];
        } else if (told) {
          nodes = told.nodes.map((n) => n.node);
        }
        const node = nodes.find((n) => n.text === "By hand");
        assert.isString(node?.id);
        // The id is written back, so the file says what the editor calls the node.
        const saved = JSON.parse(yield* fs.readFileString(file));
        assert.strictEqual(saved.root.children[0].id, node?.id);
      })
  );

  onAServer(
    "tells every editor what an edit changed, which each puts into its copy, an undo too",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* opened;
          const { client } = yield* TestEnv;
          const other = yield* anotherClient;
          // The editors were told of Home once: what changes next is said as its nodes.
          yield* client["documents.apply"]({
            edits: [
              {
                doc: HOME,
                ops: [{ id: "heading", op: "update", set: { text: "One" } }],
              },
            ],
          });
          const before = yield* other["documents.get"]({ doc: HOME });
          const copyOf = (
            copy: DocumentState,
            next: DocumentChange | undefined
          ): DocumentState | null => {
            if (!next || isWholeDocument(next)) {
              return next ?? null;
            }
            assert.strictEqual(next.from, copy.hash);
            const root =
              copy.root && withChangedNodes(copy.root, next.rootId, next.nodes);
            return { doc: next.doc, hash: next.hash, root };
          };
          const heard = yield* Effect.forkScoped(
            other["events.document"]().pipe(
              Stream.filter((e) => e.doc === HOME),
              Stream.take(2),
              Stream.runCollect,
              Effect.timeout("20 seconds")
            ),
            { startImmediately: true }
          );
          // Answered once the subscription before it is the server's.
          yield* other["project.info"]();
          const applied = yield* client["documents.apply"]({
            edits: [
              {
                doc: HOME,
                ops: [
                  {
                    id: "heading",
                    op: "update",
                    set: { text: "Two editors" },
                  },
                ],
              },
            ],
          });
          const edited = yield* client["documents.get"]({ doc: HOME });
          const [change] = applied.changes;
          // The editor that asked is answered with the one node that changed.
          assert.isFalse(change === undefined || isWholeDocument(change));
          assert.deepStrictEqual(
            change && !isWholeDocument(change)
              ? change.nodes.map((n) => n.node.id)
              : [],
            ["heading"]
          );
          assert.deepStrictEqual(copyOf(before, change), edited);
          yield* client["edit.undo"]();
          const [told, undone] = Array.from(yield* Fiber.join(heard));
          // The other editor hears the edit and its undo, each over its copy.
          const afterEdit = copyOf(before, told);
          assert.deepStrictEqual(afterEdit, edited);
          assert.deepStrictEqual(
            afterEdit && copyOf(afterEdit, undone),
            yield* client["documents.get"]({ doc: HOME })
          );
          assert.strictEqual(undone?.hash, before.hash);
        })
      ),
    30_000
  );

  onAServer(
    "fails one request on an unexpected error and keeps the event streams",
    () =>
      Effect.gen(function* () {
        yield* opened;
        const { client } = yield* TestEnv;
        const after = "after-defect.page.json";
        // The news of the page made after the defect: the watcher may tell of the directory
        // made and taken away first.
        const { event, result } = yield* nextEvent(
          client["events.pages"]().pipe(
            Stream.filter((e) => e.pages.some((p) => p.id === after))
          ),
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const { repo } = yield* TestEnv;
            // Reading a directory is an I/O error no wire error describes: a defect.
            yield* fs.makeDirectory(path.join(repo, "designs/dir.page.json"));
            const broken = yield* Effect.exit(
              client["documents.get"]({ doc: "dir.page.json" })
            );
            yield* fs.remove(path.join(repo, "designs/dir.page.json"), {
              recursive: true,
            });
            yield* client["pages.create"]({
              canvas: "",
              name: "After defect",
            });
            return broken;
          })
        );
        assert.strictEqual(result._tag, "Failure");
        assert.strictEqual(event._tag, "Some");
        assert.isTrue((yield* client["project.info"]()).configured);
      })
  );

  onAServer("turns away a browser page from another origin", () =>
    Effect.gen(function* () {
      const { port } = yield* TestEnv;
      const status = yield* statusOf(port, "/ws", {
        ...UPGRADE,
        Origin: "https://evil.example",
      });
      assert.strictEqual(status, 403);
    })
  );

  onAServer(
    "turns away a page that made its own name point here, on every route",
    () =>
      Effect.gen(function* () {
        const { port } = yield* TestEnv;
        // DNS rebinding: the page's origin and the Host it sends agree, and both are its own.
        const rebound = {
          Host: `attacker.com:${port}`,
          Origin: `http://attacker.com:${port}`,
        };
        assert.strictEqual(
          yield* statusOf(port, "/ws", { ...UPGRADE, ...rebound }),
          403
        );
        assert.strictEqual(yield* statusOf(port, "/api/health", rebound), 403);
        assert.strictEqual(yield* statusOf(port, "/mcp", rebound, "POST"), 403);
        assert.strictEqual(
          yield* statusOf(port, "/api/health", { Host: "attacker.com" }),
          403
        );
      })
  );

  onAServer("answers loopback names, with or without an origin", () =>
    Effect.gen(function* () {
      const { port } = yield* TestEnv;
      for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
        assert.strictEqual(
          yield* statusOf(port, "/api/health", { Host: `${host}:${port}` }),
          200
        );
        assert.strictEqual(
          yield* statusOf(port, "/ws", {
            ...UPGRADE,
            Host: `${host}:${port}`,
          }),
          101
        );
        assert.strictEqual(
          yield* statusOf(port, "/ws", {
            ...UPGRADE,
            Host: `${host}:${port}`,
            Origin: `http://${host}:${port}`,
          }),
          101
        );
      }
    })
  );
});

/** A comment pinned on a page of a canvas, as the editor leaves one. */
const commentOn = (canvas: string, page: string, text: string) => ({
  canvas,
  element: null,
  nodeId: null,
  page,
  text,
  x: 10,
  y: 10,
});

/**
 * A request as it arrives over the socket, its payload not checked by the client's schema first:
 * what a page that is not the editor could send. Answers with the exit's tag.
 */
const rawCall = (port: number, tag: string, payload: unknown) =>
  Effect.callback<string>((resume) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.onopen = () =>
      socket.send(
        JSON.stringify({ _tag: "Request", headers: [], id: "1", payload, tag })
      );
    socket.onmessage = (message) => {
      const decoded = JSON.parse(String(message.data)) as {
        readonly _tag: string;
        readonly exit?: { readonly _tag: string };
      };
      if (decoded._tag === "Exit") {
        socket.close();
        resume(Effect.succeed(decoded.exit?._tag ?? ""));
      }
    };
    socket.onerror = () => resume(Effect.succeed("error"));
  });

describe("ids that would name a path somewhere else", () => {
  onAServer("will not delete the settings as a thread", () =>
    Effect.gen(function* () {
      yield* opened;
      const { home, port } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      const settingsFile = path.join(home, "settings.json");
      assert.isTrue(yield* fs.exists(settingsFile));
      assert.strictEqual(
        yield* rawCall(port, "threads.delete", { threadId: "../settings" }),
        "Failure"
      );
      assert.isTrue(yield* fs.exists(settingsFile));
    })
  );

  onAServer("reads no canvas, comments or import outside their place", () =>
    Effect.gen(function* () {
      yield* opened;
      const { home, port } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      for (const [tag, payload] of [
        ["canvas.get", { canvas: "../.." }],
        ["comments.list", { canvas: "../.." }],
        ["documents.list", { canvas: "/etc" }],
        ["canvas.set", { canvas: "..", frames: {} }],
        ["comments.create", { ...commentOn("../x", HOME, "Out") }],
      ] as const) {
        assert.strictEqual(yield* rawCall(port, tag, payload), "Failure", tag);
      }
      assert.isTrue(yield* fs.exists(path.join(home, "threads")));
    })
  );

  onAServer("makes no canvas for a page, a frame or a comment", () =>
    Effect.gen(function* () {
      yield* opened;
      const { client, repo } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      const created = yield* Effect.flip(
        client["pages.create"]({ canvas: "nowhere", name: "Lost" })
      );
      assert.strictEqual(created._tag, "NotFound");
      const framed = yield* Effect.flip(
        client["canvas.set"]({ canvas: "nowhere", frames: {} })
      );
      assert.strictEqual(framed._tag, "NotFound");
      const commented = yield* Effect.flip(
        client["comments.create"](commentOn("nowhere", HOME, "Lost"))
      );
      assert.strictEqual(commented._tag, "NotFound");
      assert.isFalse(yield* fs.exists(path.join(repo, "designs/nowhere")));
      assert.deepStrictEqual(
        (yield* client["pages.list"]()).canvases.map((c) => c.id),
        [""]
      );
    })
  );

  onAServer("tells an agent there is no Figma import by that name", () =>
    Effect.gen(function* () {
      yield* opened;
      const { client, port } = yield* TestEnv;
      const { token } = yield* client["mcp.connection"]();
      const call = toolCaller(port, token);
      const read = yield* call("read_figma_import", { import: "../.." });
      assert.isTrue(read.result.isError);
      assert.include(read.result.content[0]?.text ?? "", "no Figma import");
    })
  );
});

describe("writing to git", () => {
  onAServer("commits design files once writing to git is on", () =>
    Effect.gen(function* () {
      const { client, repo, settings } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      assert.isTrue(
        (yield* client["settings.set"]({ ...settings, git: "on" })).ok
      );
      yield* fs.writeFileString(
        path.join(repo, "designs/notes.page.json"),
        '{ "version": 1 }\n'
      );
      const changed = (yield* client["git.status"]()).files.map((f) => f.path);
      assert.include(changed, "designs/notes.page.json");
      const { event, result } = yield* nextEvent(
        client["events.git"](),
        client["git.commit"]({ message: "designs", paths: changed })
      );
      assert.match(result.sha, SHA_RE);
      assert.deepStrictEqual(
        event._tag === "Some" ? event.value.files : null,
        []
      );
    })
  );

  onAServer("commits the files it is given, not what a pattern matches", () =>
    Effect.gen(function* () {
      const { client, repo, settings } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      yield* client["settings.set"]({ ...settings, git: "on" });
      yield* fs.writeFileString(path.join(repo, "notes.txt"), "mine\n");
      for (const spec of [":/", "*", "*.txt"]) {
        const error = yield* Effect.flip(
          client["git.commit"]({ message: "everything", paths: [spec] })
        );
        assert.strictEqual(error._tag, "CommandFailed", spec);
      }
      const status = yield* client["git.status"]();
      assert.include(
        status.files.map((f) => f.path),
        "notes.txt"
      );
      yield* fs.remove(path.join(repo, "notes.txt"));
    })
  );
});
