import { assert, describe, it } from "@effect/vitest";
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import type { SshProject } from "./projects.ts";
import {
  type RemoteHooks,
  RemoteProjects,
  reconnectDelay,
} from "./remote-project.ts";
import type { ShellStatus } from "./shell.ts";
import { SshError } from "./ssh.ts";
import { type Connection, RemoteServers } from "./ssh-server.ts";

/**
 * A remote machine in memory: connections that drop when told, a server that keeps running
 * across a drop unless told it died, local ports that can be taken, and what happened, in order.
 */
interface FakeMachine {
  drop?: Deferred.Deferred<string>;
  /** Fails the next connections, one error each. */
  readonly failures: SshError[];
  /** Local ports the live connection forwards. */
  readonly forwarded: Set<number>;
  readonly log: string[];
  nextLocal: number;
  /** The server's run, while it runs there. */
  running: { readonly pid: number; readonly token: string } | null;
  runs: number;
  /** Local ports something else holds. */
  readonly taken: Set<number>;
}

const makeMachine = (): FakeMachine => ({
  failures: [],
  forwarded: new Set(),
  log: [],
  nextLocal: 41_000,
  running: null,
  runs: 0,
  taken: new Set(),
});

const fakeRemoteServers = (machine: FakeMachine) =>
  Layer.succeed(
    RemoteServers,
    RemoteServers.of({
      connect: () =>
        Effect.gen(function* () {
          const failure = machine.failures.shift();
          if (failure) {
            machine.log.push("connect failed");
            return yield* failure;
          }
          const closed = yield* Deferred.make<string>();
          machine.drop = closed;
          machine.log.push("connect");
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              machine.log.push("disconnect");
              machine.forwarded.clear();
            })
          );
          const connection: Connection = {
            closed: Deferred.await(closed),
            forward: (_host, remotePort, preferred) =>
              Effect.sync(() => {
                const fresh = () => {
                  machine.nextLocal += 1;
                  return machine.nextLocal - 1;
                };
                let local = preferred ?? fresh();
                if (machine.taken.has(local) || machine.forwarded.has(local)) {
                  local = fresh();
                }
                machine.forwarded.add(local);
                machine.log.push(`forward ${remotePort}->${local}`);
                return local;
              }),
            session: () => Effect.die("no sessions on the fake"),
            target: { host: "devbox" },
          };
          return connection;
        }),
      start: (connection, _project, preferred) =>
        Effect.gen(function* () {
          const attached = machine.running !== null;
          if (machine.running) {
            machine.log.push(`attach ${machine.running.token}`);
          } else {
            machine.runs += 1;
            machine.running = {
              pid: 100 + machine.runs,
              token: `run-${machine.runs}`,
            };
            machine.log.push(`start ${machine.running.token}`);
            // Its session ends with the scope, and the server with it; over a connection that
            // dropped, the end does not reach it, and it goes on running.
            const dropped = machine.drop;
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                if (dropped && (yield* Deferred.isDone(dropped))) {
                  return;
                }
                machine.log.push(`stop ${machine.running?.token}`);
                machine.running = null;
              })
            );
          }
          const run = machine.running;
          const remotePort = 4700 + machine.runs;
          const local = yield* connection.forward(
            "127.0.0.1",
            remotePort,
            preferred
          );
          return {
            connection,
            ready: {
              ...(attached ? { attached: true } : {}),
              pid: run.pid,
              port: remotePort,
              token: run.token,
              url: `http://127.0.0.1:${remotePort}`,
            },
            stopped: Effect.never,
            url: `http://127.0.0.1:${local}`,
          };
        }),
      stop: (_connection, server) =>
        Effect.sync(() => {
          machine.log.push(`kill ${server.ready.pid}`);
          machine.running = null;
        }),
    })
  );

/** Ends the live connection, as a network that goes does. */
const dropConnection = (machine: FakeMachine, why: string) =>
  machine.drop
    ? Effect.asVoid(Deferred.succeed(machine.drop, why))
    : Effect.die("no connection to drop");

const project: SshProject = {
  host: "devbox",
  id: "p1",
  kind: "ssh",
  name: "shop",
  path: "~/shop",
};

interface Seen {
  readonly moved: string[];
  readonly statuses: (ShellStatus | null)[];
}

const hooksFor = (seen: Seen): RemoteHooks => ({
  moved: (url) => Effect.sync(() => seen.moved.push(url)),
  status: (status) => Effect.sync(() => seen.statuses.push(status)),
});

const withMachine = <A, E>(
  body: (
    machine: FakeMachine,
    seen: Seen
  ) => Effect.Effect<A, E, RemoteProjects | Scope.Scope>
) => {
  const machine = makeMachine();
  return body(machine, { moved: [], statuses: [] }).pipe(
    Effect.provide(
      RemoteProjects.layer.pipe(Layer.provide(fakeRemoteServers(machine)))
    ),
    Effect.scoped
  );
};

/** Lets the forked fibres run up to where they wait. */
const settle = Effect.gen(function* () {
  for (let i = 0; i < 20; i += 1) {
    yield* Effect.yieldNow;
  }
});

const unreachable = new SshError({
  message: "devbox could not be reached",
  retryable: true,
});

describe("reconnectDelay", () => {
  it("doubles from a second up to half a minute, and waits longest for what waiting will not mend", () => {
    assert.deepStrictEqual(
      [1, 2, 3, 4, 5, 6, 7].map((n) =>
        Duration.toSeconds(reconnectDelay(n, true))
      ),
      [1, 2, 4, 8, 16, 30, 30]
    );
    assert.strictEqual(Duration.toSeconds(reconnectDelay(1, false)), 30);
  });
});

describe("RemoteProjects", () => {
  it.effect(
    "reconnects after a drop with a growing wait, on the same port, attached to the server still running, and stops it at the end",
    () =>
      withMachine((machine, seen) =>
        Effect.gen(function* () {
          const projects = yield* RemoteProjects;
          const scope = yield* Scope.make();
          const running = yield* projects
            .start(project, hooksFor(seen))
            .pipe(Scope.provide(scope));
          assert.strictEqual(running.url, "http://127.0.0.1:41000");
          assert.isFalse(running.attached);
          // The network goes; the server there keeps running. Three attempts fail.
          machine.failures.push(unreachable, unreachable, unreachable);
          yield* dropConnection(machine, "connection reset");
          yield* settle;
          assert.deepStrictEqual(seen.statuses.slice(0, 2), [
            { detail: "connection reset", message: "Reconnecting to devbox…" },
            {
              detail: "devbox could not be reached\nTrying again in 1 s.",
              message: "Reconnecting to devbox…",
            },
          ]);
          yield* TestClock.adjust("1 second");
          yield* settle;
          assert.include(seen.statuses.at(-1)?.detail ?? "", "again in 2 s");
          yield* TestClock.adjust("2 seconds");
          yield* settle;
          assert.include(seen.statuses.at(-1)?.detail ?? "", "again in 4 s");
          // Not before its time.
          yield* TestClock.adjust("3 seconds");
          yield* settle;
          assert.strictEqual(
            machine.log.filter((l) => l === "connect failed").length,
            3
          );
          yield* TestClock.adjust("1 second");
          yield* settle;
          assert.isNull(seen.statuses.at(-1));
          // Same server, same port: the editor's socket finds it where it was, no reload.
          assert.deepStrictEqual(seen.moved, []);
          assert.strictEqual(running.url, "http://127.0.0.1:41000");
          assert.deepStrictEqual(machine.log.slice(-2), [
            "attach run-1",
            "forward 4701->41000",
          ]);

          // The app's own server, attached to again: stopped by the app when it closes.
          yield* Scope.close(scope, Exit.void);
          assert.deepStrictEqual(machine.log.slice(-2), [
            "kill 101",
            "disconnect",
          ]);
          assert.isNull(machine.running);
        })
      )
  );

  it.effect(
    "starts the server again when it died, and loads the editor from the new one",
    () =>
      withMachine((machine, seen) =>
        Effect.gen(function* () {
          const projects = yield* RemoteProjects;
          const running = yield* projects.start(project, hooksFor(seen));
          const before = running.token;
          // The machine restarted: the server is gone with the connection.
          machine.running = null;
          yield* dropConnection(machine, "closed");
          yield* settle;
          assert.notStrictEqual(running.token, before);
          assert.deepStrictEqual(seen.moved, ["http://127.0.0.1:41000"]);
          assert.include(machine.log, "start run-2");
        })
      )
  );

  it.effect(
    "loads the editor at another port when its own was taken meanwhile",
    () =>
      withMachine((machine, seen) =>
        Effect.gen(function* () {
          const projects = yield* RemoteProjects;
          const running = yield* projects.start(project, hooksFor(seen));
          assert.strictEqual(running.url, "http://127.0.0.1:41000");
          // Something else takes the port while the connection is down.
          machine.taken.add(41_000);
          yield* dropConnection(machine, "closed");
          yield* settle;
          assert.deepStrictEqual(seen.moved, ["http://127.0.0.1:41001"]);
          assert.strictEqual(running.url, "http://127.0.0.1:41001");
        })
      )
  );

  it.effect(
    "leaves a server it attached to running, and forwards its port alone",
    () =>
      withMachine((machine, seen) =>
        Effect.gen(function* () {
          machine.running = { pid: 7, token: "theirs" };
          const projects = yield* RemoteProjects;
          const scope = yield* Scope.make();
          const running = yield* projects
            .start(project, hooksFor(seen))
            .pipe(Scope.provide(scope));
          assert.isTrue(running.attached);
          yield* Scope.close(scope, Exit.void);
          assert.deepStrictEqual(machine.log, [
            "connect",
            "attach theirs",
            "forward 4700->41000",
            "disconnect",
          ]);
          assert.isNotNull(machine.running);
        })
      )
  );

  it.effect("says why it cannot start, and leaves nothing behind", () =>
    withMachine((machine, seen) =>
      Effect.gen(function* () {
        machine.failures.push(unreachable);
        const projects = yield* RemoteProjects;
        const error = yield* Effect.flip(
          Effect.scoped(projects.start(project, hooksFor(seen)))
        );
        assert.strictEqual(error._tag, "ServerStartError");
        assert.strictEqual(error.message, "devbox could not be reached");
        assert.deepStrictEqual(machine.log, ["connect failed"]);
      })
    )
  );

  it.effect("stops reconnecting when the project closes meanwhile", () =>
    withMachine((machine, seen) =>
      Effect.gen(function* () {
        const projects = yield* RemoteProjects;
        const scope = yield* Scope.make();
        yield* projects
          .start(project, hooksFor(seen))
          .pipe(Scope.provide(scope));
        machine.failures.push(unreachable, unreachable);
        yield* dropConnection(machine, "gone");
        yield* settle;
        const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
        yield* Fiber.join(closing);
        const attempts = machine.log.filter((l) =>
          l.startsWith("connect")
        ).length;
        yield* TestClock.adjust("1 minute");
        yield* settle;
        assert.strictEqual(
          machine.log.filter((l) => l.startsWith("connect")).length,
          attempts
        );
      })
    )
  );
});
