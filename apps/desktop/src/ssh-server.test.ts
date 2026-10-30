import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer, Schedule, Scope } from "effect";
import { LoginShell } from "./login-shell.ts";
import type { SshProject } from "./projects.ts";
import { RemoteProjects } from "./remote-project.ts";
import { RemoteServers } from "./ssh-server.ts";
import { SSHD, startSshd } from "./testing-sshd.ts";

const fakeRemote = path.resolve(
  import.meta.dirname,
  "../testing/fake-remote-server.mjs"
);

const LOOPBACK_URL_RE = /^http:\/\/127\.0\.0\.1:\d+$/;

/** The fake as the project's command, with this Node: nothing depends on the login shell's. */
const COMMAND = `${process.execPath} ${fakeRemote}`;

const project = (fields: Partial<SshProject>): SshProject => ({
  command: COMMAND,
  host: "test",
  id: "p1",
  kind: "ssh",
  name: "remote",
  path: "/nowhere",
  ...fields,
});

/** A throwaway sshd, and the service pointed at it; skipped where there is no sshd. */
const withSshd = <A, E>(
  body: (dirs: {
    readonly root: string;
    readonly sessions: string;
  }) => Effect.Effect<
    A,
    E,
    RemoteServers | RemoteProjects | FileSystem.FileSystem
  >
) =>
  Effect.gen(function* () {
    const sshd = yield* startSshd;
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const sessions = path.join(root, "sessions");
    return yield* body({ root, sessions }).pipe(
      Effect.provide(
        RemoteProjects.layer.pipe(
          Layer.provideMerge(
            RemoteServers.layer({
              configFile: sshd.configFile,
              sessionsDir: sessions,
              ssh: "ssh",
            })
          ),
          Layer.provide(LoginShell.layerTest({ PATH: process.env.PATH ?? "" }))
        )
      )
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const health = (url: string) =>
  Effect.promise(() =>
    fetch(`${url}/api/health`).then(
      (response) => response.json() as Promise<{ token: string }>
    )
  );

const eventually = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    // real clock: a real sshd and the server it starts, asked again until they answer.
    Effect.retry(Schedule.spaced("100 millis")),
    Effect.timeout("10 seconds")
  );

describe.skipIf(SSHD === undefined)(
  "RemoteServers, over a throwaway sshd",
  () => {
    // real clock: a real sshd, a real ssh and the server's process over it.
    it.live(
      "starts the server in the folder, forwards its port, attaches to it, and stops it with the scope",
      () =>
        withSshd(({ root, sessions }) =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            // A folder whose name needs quoting, twice over.
            const folder = path.join(root, `it's a "project" $HOME`);
            yield* fs.makeDirectory(folder);
            const remote = yield* RemoteServers;
            const scope = yield* Scope.make();
            const connection = yield* remote
              .connect(project({ path: folder }))
              .pipe(Scope.provide(scope));
            const server = yield* remote
              .start(connection, project({ path: folder }))
              .pipe(Scope.provide(scope));
            assert.isUndefined(server.ready.attached);
            assert.match(server.url, LOOPBACK_URL_RE);
            assert.notStrictEqual(
              new URL(server.url).port,
              String(server.ready.port)
            );
            assert.strictEqual(
              (yield* health(server.url)).token,
              server.ready.token
            );
            const record = JSON.parse(
              yield* fs.readFileString(path.join(sessions, "p1", "record.json"))
            );
            assert.strictEqual(record.cwd, folder);
            assert.deepStrictEqual(record.env, []);
            assert.includeMembers(record.args, [
              "--host",
              "127.0.0.1",
              "--port",
              "0",
              "--ready-json",
              "--stop-with-stdin",
            ]);

            // A second start finds it running, and attaches.
            const again = yield* remote
              .start(connection, project({ path: folder }))
              .pipe(Scope.provide(scope));
            assert.isTrue(again.ready.attached);
            assert.strictEqual(again.ready.token, server.ready.token);

            yield* Scope.close(scope, Exit.void);
            const events = path.join(sessions, "p1", "events");
            assert.strictEqual(
              yield* eventually(fs.readFileString(events)),
              `stopped ${server.ready.pid}\n`
            );
          })
        ),
      30_000
    );

    // real clock: a real sshd and a real ssh, which time out on their own.
    it.live(
      "says the folder is missing, the command is not installed, the host is unreachable",
      () =>
        withSshd(({ root }) =>
          Effect.gen(function* () {
            const remote = yield* RemoteServers;
            const missing = yield* Effect.flip(
              Effect.scoped(
                Effect.flatMap(remote.connect(project({})), (connection) =>
                  remote.start(connection, project({ path: "/no/such/folder" }))
                )
              )
            );
            assert.strictEqual(
              missing.message,
              "There is no folder /no/such/folder on test"
            );
            const notInstalled = yield* Effect.flip(
              Effect.scoped(
                Effect.flatMap(remote.connect(project({})), (connection) =>
                  remote.start(
                    connection,
                    project({ command: "ultrapaint-not-here", path: root })
                  )
                )
              )
            );
            assert.include(
              notInstalled.message,
              "ultrapaint-not-here is not installed on test"
            );
            assert.isFalse(notInstalled.retryable);
            const unreachable = yield* Effect.flip(
              Effect.scoped(remote.connect(project({ host: "unreachable" })))
            );
            assert.include(
              unreachable.message,
              "unreachable could not be reached"
            );
            assert.isTrue(unreachable.retryable);
          })
        ),
      30_000
    );
  }
);
