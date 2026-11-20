import { createServer } from "node:http";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer, Option, Scope } from "effect";
import { APP_ORIGIN } from "./app-editor.ts";
import {
  agentsOf,
  ProjectServer,
  serverEnv,
  serverVersion,
} from "./project-server.ts";

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
            userDirIn: path.join(dir, "sync"),
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
        // The person's folder is where the app keeps it (ADR 0091).
        // The app's own editor may use it (ADR 0100).
        const origin = started.args.indexOf("--allowed-origin");
        assert.strictEqual(started.args[origin + 1], APP_ORIGIN);
        const at = started.args.indexOf("--user-dir");
        assert.strictEqual(started.args[at + 1], path.join(dir, "sync"));
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
          userDirIn: dir,
        });
        // It answers once all it wrote was read: a pipe left unread would hold it, or end it.
        assert.strictEqual(Option.getOrThrow(yield* running.agents).working, 1);
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
            userDirIn: dir,
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

describe("agentsOf", () => {
  it.effect(
    "reads how many agents are at work and how many wait on the person, from the run it was told of only",
    () =>
      Effect.gen(function* () {
        const server = createServer((_request, response) => {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              failed: 1,
              ok: true,
              token: "run-1",
              version: "1.2.3",
              waiting: 1,
              working: 2,
            })
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
        assert.deepStrictEqual(
          yield* agentsOf(url, "run-1"),
          Option.some({ failed: 1, waiting: 1, working: 2 })
        );
        // Another server on the port is not the one the app started.
        assert.isTrue(Option.isNone(yield* agentsOf(url, "run-2")));
        // Nothing answers: nothing to cut off.
        assert.isTrue(
          Option.isNone(yield* agentsOf("http://127.0.0.1:9", "run-1"))
        );
        // And the version it runs, which decides the editor it is shown in (ADR 0100).
        assert.strictEqual(yield* serverVersion(url), "1.2.3");
        assert.isUndefined(yield* serverVersion("http://127.0.0.1:9"));
      }).pipe(Effect.scoped)
  );
});
