import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Connection,
  type ConnectionState,
  RequestError,
} from "@ultrapaint/client-runtime/connection";
import type { Settings } from "@ultrapaint/contracts/settings";
import type { ThreadStreamItem } from "@ultrapaint/contracts/threads";
import { Context, Effect, Exit, FileSystem, Layer, Path, Scope } from "effect";
import { ServerConfig } from "./config.ts";
import { ListenPort } from "./listen-port.ts";
import { ServerLive } from "./server.ts";
import { makeRepository } from "./testing/harness.ts";
import { waitFor } from "./testing/wait-for.ts";

/**
 * Starts the server on `port` (0: one the system gives it) and returns the scope that stops it,
 * and the port it listens on.
 */
const startServer = (home: string, port: number) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const services = yield* Layer.buildWithScope(
      Layer.merge(
        ServerLive.pipe(
          Layer.provide(
            ServerConfig.layerTest({
              briefing: true,
              cwd: home,
              machine: { home, path: process.env.PATH ?? "" },
              mcp: true,
              port,
              storage: { home, mode: "managed" },
              userDir: home,
            })
          )
        ),
        // The server's own: a layer is built once for the whole of a build.
        ListenPort.layer
      ),
      scope
    );
    const listening = yield* Context.get(services, ListenPort).get;
    return { port: listening, scope };
  });

/** Until `condition` holds of the client's state, which it changes on its own. */
const until = (condition: () => boolean) =>
  waitFor(Effect.sync(condition), Boolean);

const open = (port: number) => {
  const states: ConnectionState[] = [];
  const connection = new Connection({
    onState: (state) => states.push(state),
    url: `ws://127.0.0.1:${port}/ws`,
  });
  return { connection, states };
};

describe("Connection", () => {
  // real clock: the editor's client over a real socket to a real server.
  it.live(
    "requests, typed failures and events through the editor's client",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        const repo = yield* makeRepository;
        const { port, scope: server } = yield* startServer(home, 0);
        yield* Effect.addFinalizer(() => Scope.close(server, Exit.void));
        const { connection, states } = open(port);
        yield* Effect.addFinalizer(() => Effect.sync(() => connection.close()));
        yield* until(() => connection.state === "open");
        assert.deepStrictEqual(states, ["connecting", "open"]);

        const before = yield* Effect.promise(() =>
          connection.request("project.info", undefined)
        );
        assert.isFalse(before.configured);

        // A wire error keeps the lower-case code the editor has always seen.
        const failure = yield* Effect.promise(() =>
          connection.request("pages.list", undefined).catch((e: unknown) => e)
        );
        assert.instanceOf(failure, RequestError);
        assert.strictEqual((failure as RequestError).code, "not_configured");

        const projects: boolean[] = [];
        connection.on("project", (info) => projects.push(info.configured));
        const settings: Settings = {
          designsDir: "designs",
          hostCss: [],
          libraryDirs: [],
          repoPath: repo,
        };
        const validation = yield* Effect.promise(() =>
          connection.request("settings.set", settings)
        );
        assert.isTrue(validation.ok);
        yield* until(() => projects.includes(true));
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  // real clock: the client's reconnecting, against a real server that stops and starts again.
  it.live(
    "fails fast while disconnected and comes back when the server does",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        const { port, scope: first } = yield* startServer(home, 0);
        const { connection, states } = open(port);
        yield* Effect.addFinalizer(() => Effect.sync(() => connection.close()));
        yield* until(() => connection.state === "open");

        yield* Scope.close(first, Exit.void);
        yield* until(() => connection.state !== "open");
        const offline = yield* Effect.promise(() =>
          connection.request("project.info", undefined).catch((e: unknown) => e)
        );
        assert.instanceOf(offline, RequestError);
        assert.strictEqual((offline as RequestError).message, "not connected");

        const logs: string[] = [];
        connection.on("log", (line) => logs.push(line.text));
        // Again on its port, which the client comes back to.
        const { scope: second } = yield* startServer(home, port);
        yield* Effect.addFinalizer(() => Scope.close(second, Exit.void));
        yield* until(() => connection.state === "open");
        assert.isAbove(states.filter((s) => s === "open").length, 1);

        // Requests go through on the new session.
        const info = yield* Effect.promise(() =>
          connection.request("project.info", undefined)
        );
        assert.isFalse(info.configured);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  // real clock: a thread followed across a server that stops and starts again (ADR 0130).
  it.live(
    "follows a thread again from a snapshot once the server is back, its numbers another run's",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const repo = yield* makeRepository;
        yield* fs.makeDirectory(path.join(home, "agents"));
        // Never run: the thread is only created.
        yield* fs.writeFileString(
          path.join(home, "agents", "scripted.json"),
          JSON.stringify({
            args: [],
            command: "scripted",
            id: "scripted",
            name: "Scripted",
          })
        );
        const { port, scope: first } = yield* startServer(home, 0);
        // Closed here too, should the test fail before it stops it itself.
        yield* Effect.addFinalizer(() => Scope.close(first, Exit.void));
        const { connection } = open(port);
        yield* Effect.addFinalizer(() => Effect.sync(() => connection.close()));
        yield* until(() => connection.state === "open");
        yield* Effect.promise(() =>
          connection.request("settings.set", {
            designsDir: "designs",
            hostCss: [],
            libraryDirs: [],
            repoPath: repo,
          })
        );
        const created = yield* Effect.promise(() =>
          connection.request("threads.create", { agentId: "scripted" })
        );
        const told: ThreadStreamItem[] = [];
        let applied: number | undefined;
        let run: string | undefined;
        connection.follow(
          "threads.follow",
          () =>
            applied === undefined || run === undefined
              ? { threadId: created.id }
              : { afterSequence: applied, run, threadId: created.id },
          {
            onError: (error) => assert.fail(error.message),
            onItem: (item) => {
              told.push(item);
              applied = item.sequence;
              if (item.kind !== "event") {
                ({ run } = item);
              }
            },
          }
        );
        yield* until(() => told.some((t) => t.kind === "synchronized"));
        assert.deepStrictEqual(
          told.map((t) => t.kind),
          ["snapshot", "synchronized"]
        );

        yield* Scope.close(first, Exit.void);
        yield* until(() => connection.state !== "open");
        const before = applied;
        told.length = 0;
        const { scope: second } = yield* startServer(home, port);
        yield* Effect.addFinalizer(() => Scope.close(second, Exit.void));
        yield* until(() => told.some((t) => t.kind === "synchronized"));
        // Another run of the server's, which may have lost changes whose numbers it gives
        // again: a snapshot, though the numbers line up.
        assert.deepStrictEqual(
          told.map((t) => `${t.kind}@${t.sequence}`),
          [`snapshot@${before}`, `synchronized@${before}`]
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );
});
