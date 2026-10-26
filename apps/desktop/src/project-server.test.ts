import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer, Schedule, Scope } from "effect";
import { ProjectServer, serverEnv } from "./project-server.ts";

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
        ULTRAPAINT_CONFIG: "/elsewhere/ultrapaint.config.json",
        ULTRAPAINT_HOME: "/elsewhere",
        HOME: "/home/me",
        NOTHING: undefined,
        PATH: "/usr/bin",
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
        assert.deepStrictEqual(running, {
          token: "fake-token",
          url: "http://127.0.0.1:4999",
        });
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
        yield* Scope.close(scope, Exit.void);
        yield* Effect.sync(() => alive(started.pid)).pipe(
          Effect.repeat({
            schedule: Schedule.spaced("50 millis"),
            until: (live) => !live,
          }),
          Effect.timeout("5 seconds")
        );
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
