import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  Connection,
  type ConnectionState,
  RequestError,
} from "@ultrapaint/client-runtime/connection";
import type { Settings } from "@ultrapaint/contracts/settings";
import { Context, Effect, Exit, FileSystem, Layer, Scope } from "effect";
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

        const health = yield* Effect.promise(() =>
          connection.request("health", undefined)
        );
        assert.deepStrictEqual(health, { ok: true, version: "test" });

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
          connection.request("health", undefined).catch((e: unknown) => e)
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

        // Subscriptions made while offline are live on the new session.
        yield* Effect.promise(() =>
          connection.request("settings.validate", {
            designsDir: "designs",
            hostCss: [],
            libraryDirs: [],
            repoPath: "/nonexistent",
          })
        );
        const health = yield* Effect.promise(() =>
          connection.request("health", undefined)
        );
        assert.isTrue(health.ok);
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );
});
