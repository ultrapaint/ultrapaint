import { createServer } from "node:http";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer, Scope } from "effect";
import { agentsWorking, ProjectServer, serverEnv } from "./project-server.ts";

const fake = path.resolve(import.meta.dirname, "../testing/fake-server.mjs");

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const withFake = ProjectServer.layer({
  args: [fake],
  command: process.execPath,
  webDist: "/app/web",
}).pipe(Layer.provideMerge(NodeServices.layer));

describe("serverEnv", () => {
  it("keeps the app's environment but what would choose the server's storage, and runs Electron as Node", () => {
    const env = serverEnv(
      {
        HOME: "/home/me",
        NOTHING: undefined,
        PATH: "/usr/bin",
        ULTRAPAINT_CONFIG: "/elsewhere/ultrapaint.config.json",
        ULTRAPAINT_HOME: "/elsewhere",
      },
      { PATH: "/home/me/.fnm/bin:/usr/bin" }
    );
    assert.deepStrictEqual(env, {
      ELECTRON_RUN_AS_NODE: "1",
      HOME: "/home/me",
      PATH: "/home/me/.fnm/bin:/usr/bin",
    });
  });
});

describe("ProjectServer", () => {
  it.effect(
    "starts the server in the project's folder, reads where it is, and stops it with the scope",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const record = path.join(dir, "record.json");
        const servers = yield* ProjectServer;
        const scope = yield* Scope.make();
        const running = yield* servers
          .start({
            cwd: dir,
            env: { FAKE_SERVER: "ready", FAKE_SERVER_RECORD: record },
            sessionDir: path.join(dir, "session"),
          })
          .pipe(Scope.provide(scope));
        assert.isFalse(running.attached);
        assert.strictEqual(running.token, "fake-token");
        assert.strictEqual(running.url, "http://127.0.0.1:4999");
        const started = JSON.parse(yield* fs.readFileString(record));
        assert.strictEqual(started.cwd, dir);
        assert.strictEqual(started.env.ELECTRON_RUN_AS_NODE, "1");
        assert.includeMembers(started.args, [
          "--port",
          "0",
          "--ready-json",
          "--stop-with-stdin",
          "/app/web",
          path.join(dir, "session"),
        ]);
        assert.isTrue(alive(started.pid));
        // Closing the scope waits for the process to exit.
        yield* Scope.close(scope, Exit.void);
        assert.isFalse(alive(started.pid));
      }).pipe(Effect.scoped, Effect.provide(withFake))
  );

  it.effect(
    "goes on reading what the server writes on stdout after its ready line",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const servers = yield* ProjectServer;
        const running = yield* servers.start({
          cwd: dir,
          env: { FAKE_SERVER: "chatty" },
          sessionDir: dir,
        });
        // It answers once all it wrote was read: a pipe left unread would hold it, or end it.
        assert.strictEqual(yield* running.working, 1);
      }).pipe(Effect.scoped, Effect.provide(withFake))
  );

  it.effect(
    "says why a server that exits without a ready line did not start",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const servers = yield* ProjectServer;
        const error = yield* Effect.flip(
          servers.start({
            cwd: dir,
            env: { FAKE_SERVER: "silent" },
            sessionDir: dir,
          })
        );
        assert.strictEqual(error._tag, "ServerStartError");
        assert.include(
          error.message,
          "something the server could not get past"
        );
      }).pipe(Effect.scoped, Effect.provide(withFake))
  );
});

describe("agentsWorking", () => {
  it.effect(
    "reads how many agents are at work, from the run it was told of only",
    () =>
      Effect.gen(function* () {
        const server = createServer((_request, response) => {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({ ok: true, token: "run-1", working: 2 })
          );
        });
        const port = yield* Effect.callback<number>((resume) => {
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            resume(
              Effect.succeed(
                typeof address === "object" && address ? address.port : 0
              )
            );
          });
        });
        yield* Effect.addFinalizer(() =>
          Effect.callback<void>((resume) => {
            server.close(() => resume(Effect.void));
          })
        );
        const url = `http://127.0.0.1:${port}`;
        assert.strictEqual(yield* agentsWorking(url, "run-1"), 2);
        // Another server on the port is not the one the app started.
        assert.strictEqual(yield* agentsWorking(url, "run-2"), 0);
        // Nothing answers: nothing to cut off.
        assert.strictEqual(
          yield* agentsWorking("http://127.0.0.1:9", "run-1"),
          0
        );
      }).pipe(Effect.scoped)
  );
});
