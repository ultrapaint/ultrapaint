import { createRequire } from "node:module";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import {
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  type PlatformError,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { liveRun, RUN_FILE_NAME, readRunFile } from "./run-file.ts";
import { makeTestServer, TestEnv, TestServer } from "./testing/harness.ts";

const TOKEN_RE = /^[0-9a-f]{32}$/;

/** No process has this id: it is above every system's highest. */
const NO_SUCH_PID = 99_999_999;

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "the run file",
  (test) => {
    test.effect("says where the server is, and which run it is", () =>
      Effect.gen(function* () {
        const { home, port } = yield* TestEnv;
        const run = yield* readRunFile(home);
        assert.isTrue(Option.isSome(run));
        const value = Option.getOrThrow(run);
        assert.deepStrictEqual(value, {
          pid: process.pid,
          port,
          token: "test",
          url: `http://127.0.0.1:${port}`,
        });
        const health = yield* Effect.promise(() =>
          fetch(`${value.url}/api/health`).then(
            (r) =>
              r.json() as Promise<{
                readonly token?: string;
                readonly working?: number;
              }>
          )
        );
        assert.strictEqual(health.token, "test");
        // No agent is at work: the server can be stopped without cutting one off.
        assert.strictEqual(health.working, 0);
        // The server it names answers as that run: a second start attaches to it.
        assert.deepStrictEqual(yield* liveRun(home), run);
      })
    );

    test.effect(
      "is stale when its process is gone, or another server has its port",
      () =>
        Effect.gen(function* () {
          const { port } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const dir = yield* fs.makeTempDirectoryScoped();
          const write = (pid: number, token: string) =>
            fs.writeFileString(
              path.join(dir, RUN_FILE_NAME),
              JSON.stringify({
                pid,
                port,
                token,
                url: `http://127.0.0.1:${port}`,
              })
            );
          assert.isTrue(Option.isNone(yield* liveRun(dir)));
          yield* write(NO_SUCH_PID, "test");
          assert.isTrue(Option.isNone(yield* liveRun(dir)));
          yield* write(process.pid, "another run");
          assert.isTrue(Option.isNone(yield* liveRun(dir)));
          yield* fs.writeFileString(
            path.join(dir, RUN_FILE_NAME),
            "{ not json"
          );
          assert.isTrue(Option.isNone(yield* liveRun(dir)));
        })
    );
  }
);

layer(
  makeTestServer(({ home }) => Effect.succeed({ home, mode: "managed" })),
  { excludeTestServices: true, timeout: "60 seconds" }
)("a server started on port 0", (test) => {
  test.effect(
    "binds it itself and names the port it got, to agents as well",
    () =>
      Effect.gen(function* () {
        const { client, home, port } = yield* TestEnv;
        assert.isAbove(port, 0);
        const run = Option.getOrThrow(yield* readRunFile(home));
        assert.strictEqual(run.port, port);
        const connection = yield* client["mcp.connection"](undefined);
        assert.strictEqual(new URL(connection.url).port, String(port));
      })
  );
});

describe("the run file of a server that stops", () => {
  it.effect("goes with it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      const server = makeTestServer(() =>
        Effect.succeed({ home, mode: "managed" })
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(server);
          assert.isTrue(yield* fs.exists(path.join(home, RUN_FILE_NAME)));
        })
      );
      assert.isFalse(yield* fs.exists(path.join(home, RUN_FILE_NAME)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "stays when another process wrote it since, with the same token: a restart's",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        const file = path.join(home, RUN_FILE_NAME);
        const server = makeTestServer(() =>
          Effect.succeed({ home, mode: "managed" })
        );
        const restarted = JSON.stringify({
          pid: NO_SUCH_PID,
          port: 1,
          token: "test",
          url: "http://127.0.0.1:1",
        });
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Layer.build(server);
            yield* fs.writeFileString(file, restarted);
          })
        );
        assert.strictEqual(yield* fs.readFileString(file), restarted);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

const tsx = createRequire(
  path.resolve(import.meta.dirname, "../package.json")
).resolve("tsx/cli");

/** `bin.ts` as the desktop app or a command over SSH starts it, on a free port. */
const startServer = (
  home: string,
  options: {
    readonly flags?: readonly string[];
    readonly stdin?: Stream.Stream<Uint8Array>;
  } = {}
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* spawner.spawn(
      ChildProcess.make(
        process.execPath,
        [
          tsx,
          "--tsconfig",
          path.resolve(import.meta.dirname, "../tsconfig.json"),
          path.resolve(import.meta.dirname, "bin.ts"),
          "--home",
          home,
          "--port",
          "0",
          "--ready-json",
          "--no-discovery",
          "--no-mcp",
          ...(options.flags ?? []),
        ],
        {
          cwd: home,
          forceKillAfter: "2 seconds",
          stdin: options.stdin ? { stream: options.stdin } : "ignore",
        }
      )
    );
  });

const lines = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>
) => stream.pipe(Stream.decodeText(), Stream.splitLines);

describe("--ready-json", () => {
  it.effect(
    "prints one line of JSON once listening, and a second start prints the first's",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const first = yield* startServer(home);
        const line = yield* lines(first.stdout).pipe(
          Stream.runHead,
          Effect.timeout("40 seconds")
        );
        assert.isTrue(Option.isSome(line));
        const ready = JSON.parse(Option.getOrThrow(line));
        assert.deepStrictEqual(Object.keys(ready).sort(), [
          "pid",
          "port",
          "token",
          "url",
        ]);
        // The server's own process: under tsx, a child of the one started here.
        assert.isTrue(Number.isInteger(ready.pid));
        assert.strictEqual(ready.url, `http://127.0.0.1:${ready.port}`);
        assert.match(ready.token, TOKEN_RE);
        const health = yield* Effect.promise(() =>
          fetch(`${ready.url}/api/health`).then(
            (r) => r.json() as Promise<{ readonly token?: string }>
          )
        );
        assert.strictEqual(health.token, ready.token);

        // The same project again: no second server, the first one's line, and done.
        const second = yield* startServer(home);
        const [said, code] = yield* Effect.all(
          [Stream.runCollect(lines(second.stdout)), second.exitCode],
          { concurrency: "unbounded" }
        ).pipe(Effect.timeout("40 seconds"));
        assert.strictEqual(Number(code), 0);
        assert.deepStrictEqual(
          [...said].map((l) => JSON.parse(l)),
          [{ ...ready, attached: true }]
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    90_000
  );
});

describe("--editor-port and --token", () => {
  it.effect(
    "name where the editor is and which run it is, in the ready line and the run file",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const server = yield* startServer(home, {
          flags: ["--editor-port", "4999", "--token", "the-session"],
        });
        const line = yield* lines(server.stdout).pipe(
          Stream.runHead,
          Effect.timeout("40 seconds")
        );
        const ready = JSON.parse(Option.getOrThrow(line));
        assert.strictEqual(ready.port, 4999);
        assert.strictEqual(ready.url, "http://127.0.0.1:4999");
        assert.strictEqual(ready.token, "the-session");
        assert.deepStrictEqual(
          Option.getOrThrow(yield* readRunFile(home)),
          ready
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    90_000
  );
});

describe("--stop-with-stdin", () => {
  it.effect(
    "stops the server once whatever started it closes its stdin",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const close = yield* Deferred.make<void>();
        const server = yield* startServer(home, {
          flags: ["--stop-with-stdin"],
          stdin: Stream.fromEffect(Deferred.await(close)).pipe(
            Stream.flatMap(() => Stream.empty)
          ),
        });
        const line = yield* lines(server.stdout).pipe(
          Stream.runHead,
          Effect.timeout("40 seconds")
        );
        assert.isTrue(Option.isSome(line));
        assert.isTrue(yield* fs.exists(path.join(home, RUN_FILE_NAME)));
        yield* Deferred.succeed(close, undefined);
        const code = yield* server.exitCode.pipe(Effect.timeout("20 seconds"));
        assert.strictEqual(Number(code), 0);
        // It stopped as it does on a signal: its run file went with it.
        assert.isFalse(yield* fs.exists(path.join(home, RUN_FILE_NAME)));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    90_000
  );
});
