import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { AgentConfig } from "@ultrapaint/contracts/threads";
import { Deferred, type Duration, Effect, Fiber, type Scope } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import {
  type AcpHandlers,
  type SessionNotification,
  spawnAcpAgent,
} from "./acp-agent.ts";
import { AcpHostError, ResourceNotFound } from "./errors.ts";
import { makeTerminalManager } from "./terminal-manager.ts";

const fakeAgent = path.resolve(
  import.meta.dirname,
  "../testing/fake-agent.mjs"
);

const config = (env: Record<string, string> = {}): AgentConfig => ({
  args: [fakeAgent],
  builtIn: false,
  command: process.execPath,
  env,
  id: "fake",
  name: "Fake",
});

const refuse = () =>
  Effect.fail(new AcpHostError({ message: "not used in this test" }));

const handlers = (overrides: Partial<AcpHandlers> = {}): AcpHandlers => ({
  onElicitation: () => Effect.succeed({ action: "decline" }),
  onPermission: () => Effect.succeed({ outcome: { outcome: "cancelled" } }),
  onStderr: () => Effect.void,
  onUpdate: () => Effect.void,
  readTextFile: refuse,
  terminal: {
    create: refuse,
    kill: () => Effect.void,
    output: refuse,
    release: () => Effect.void,
    waitForExit: refuse,
  },
  writeTextFile: refuse,
  ...overrides,
});

const textOf = (n: SessionNotification) =>
  "content" in n.update && n.update.content && "text" in n.update.content
    ? String(n.update.content.text)
    : n.update.sessionUpdate;

/**
 * Spawns the fake agent and collects every update it sends; `waiting` completes once it says it
 * waits. `handlingTakes` makes handling each update take that long.
 */
const open = Effect.fnUntraced(function* (
  overrides: Partial<AcpHandlers> = {},
  env: Record<string, string> = {},
  handlingTakes: Duration.Input = 0
) {
  const seen: string[] = [];
  const waiting = yield* Deferred.make<void>();
  const agent = yield* spawnAcpAgent(config(env), {
    clientVersion: "test",
    cwd: process.cwd(),
    env: {},
    handlers: handlers({
      onUpdate: (n) =>
        Effect.andThen(
          // real clock: a consumer slower than the agent's real process.
          Effect.sleep(handlingTakes),
          Effect.suspend(() => {
            seen.push(textOf(n));
            return textOf(n) === "waiting"
              ? Effect.asVoid(Deferred.succeed(waiting, undefined))
              : Effect.void;
          })
        ),
      ...overrides,
    }),
  });
  yield* agent.initialize;
  return { agent, seen, waiting };
});

/** A test with a real process: the fake agent, spawned as the server spawns it. */
const agentTest = <A, E>(
  name: string,
  body: () => Effect.Effect<
    A,
    E,
    Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
  >
) =>
  // real clock: the fake agent is a real process.
  it.live(name, () =>
    Effect.provide(Effect.scoped(body()), NodeServices.layer)
  );

describe("AcpAgent", () => {
  agentTest("delivers every update before the prompt is reported as done", () =>
    Effect.gen(function* () {
      const { agent, seen } = yield* open();
      const { sessionId } = yield* agent.newSession(process.cwd());
      const response = yield* agent.prompt(sessionId, [
        { text: "reply please", type: "text" },
      ]);
      assert.strictEqual(response.stopReason, "end_turn");
      assert.deepStrictEqual(seen, ["Thinking.", "Hello ", "world"]);
    })
  );

  agentTest("waits for a consumer that is slower than the agent", () =>
    Effect.gen(function* () {
      // Persisting the transcript makes the real consumer lag behind the agent: the real clock
      // is the behaviour, an agent that has answered while its updates are still handled.
      const { agent, seen } = yield* open({}, {}, "40 millis");
      const { sessionId } = yield* agent.newSession(process.cwd());
      yield* agent.prompt(sessionId, [{ text: "reply", type: "text" }]);
      assert.deepStrictEqual(seen, ["Thinking.", "Hello ", "world"]);
    })
  );

  agentTest("routes a permission request to the handler and back", () =>
    Effect.gen(function* () {
      const { agent, seen } = yield* open({
        onPermission: (request) =>
          Effect.succeed({
            outcome: {
              optionId: request.options[0]?.optionId ?? "",
              outcome: "selected",
            },
          }),
      });
      const { sessionId } = yield* agent.newSession(process.cwd());
      yield* agent.prompt(sessionId, [{ text: "permission", type: "text" }]);
      assert.deepStrictEqual(seen, ["permission:allow"]);
    })
  );

  agentTest(
    "reopens a session by loading it, its replay kept from the host",
    () =>
      Effect.gen(function* () {
        const { agent, seen } = yield* open({}, { FAKE_AGENT_LOAD: "1" });
        const { sessionId } = yield* agent.newSession(process.cwd());
        assert.deepStrictEqual(
          yield* agent.reopen(sessionId, process.cwd()),
          {}
        );
        yield* agent.prompt(sessionId, [{ text: "how", type: "text" }]);
        assert.deepStrictEqual(seen, ["how:loaded"]);
      })
  );

  agentTest("reopens a session by resuming it where the agent can", () =>
    Effect.gen(function* () {
      const { agent, seen } = yield* open(
        {},
        { FAKE_AGENT_LOAD: "1", FAKE_AGENT_RESUME: "1" }
      );
      const { sessionId } = yield* agent.newSession(process.cwd());
      yield* agent.reopen(sessionId, process.cwd());
      yield* agent.prompt(sessionId, [{ text: "how", type: "text" }]);
      assert.deepStrictEqual(seen, ["how:resumed"]);
    })
  );

  agentTest("cannot reopen a session where the agent keeps none", () =>
    Effect.gen(function* () {
      const { agent } = yield* open();
      const { sessionId } = yield* agent.newSession(process.cwd());
      assert.isNull(yield* agent.reopen(sessionId, process.cwd()));
    })
  );

  agentTest(
    "tells the agent a file it asked for is not there as resource not found",
    () =>
      Effect.gen(function* () {
        const { agent, seen } = yield* open({
          readTextFile: (request) =>
            Effect.fail(
              new ResourceNotFound({
                message: `${request.path} is not there`,
                path: request.path,
              })
            ),
        });
        const { sessionId } = yield* agent.newSession(process.cwd());
        yield* agent.prompt(sessionId, [
          { text: "read gone.txt", type: "text" },
        ]);
        assert.deepStrictEqual(seen, ["read:-32002"]);
      })
  );

  agentTest("tells the agent why the host could not do what it asked", () =>
    Effect.gen(function* () {
      const { agent, seen } = yield* open({
        readTextFile: (request) =>
          Effect.fail(
            new AcpHostError({
              message: `${request.path} is outside the designs directory`,
            })
          ),
      });
      const { sessionId } = yield* agent.newSession(process.cwd());
      yield* agent.prompt(sessionId, [{ text: "read gone.txt", type: "text" }]);
      assert.deepStrictEqual(seen, [
        `read:-32603 Internal error: ${process.cwd()}/gone.txt is outside the designs directory`,
      ]);
    })
  );

  agentTest("surfaces the agent's own explanation of a failed prompt", () =>
    Effect.gen(function* () {
      const { agent } = yield* open();
      const { sessionId } = yield* agent.newSession(process.cwd());
      const error = yield* Effect.flip(
        agent.prompt(sessionId, [{ text: "fail", type: "text" }])
      );
      assert.strictEqual(error._tag, "AcpRequestError");
      assert.strictEqual(error.message, "usage limit reached");
    })
  );

  agentTest("fails the call in flight when the process exits", () =>
    Effect.gen(function* () {
      const { agent } = yield* open();
      const { sessionId } = yield* agent.newSession(process.cwd());
      const error = yield* Effect.flip(
        agent.prompt(sessionId, [{ text: "exit", type: "text" }])
      );
      assert.strictEqual(error._tag, "AcpProcessExited");
      assert.strictEqual((yield* agent.exited).code, 7);
    })
  );

  agentTest("ends a waiting turn with session/cancel", () =>
    Effect.gen(function* () {
      const { agent, waiting } = yield* open();
      const { sessionId } = yield* agent.newSession(process.cwd());
      const turn = yield* Effect.forkScoped(
        agent.prompt(sessionId, [{ text: "wait", type: "text" }])
      );
      yield* Deferred.await(waiting);
      yield* agent.cancel(sessionId);
      assert.strictEqual((yield* Fiber.join(turn)).stopReason, "cancelled");
    })
  );

  agentTest("reports a command that does not exist as a spawn error", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        spawnAcpAgent(
          { ...config(), command: "/nonexistent/agent-binary" },
          {
            clientVersion: "test",
            cwd: process.cwd(),
            env: {},
            handlers: handlers(),
          }
        )
      );
      assert.strictEqual(error._tag, "AcpSpawnError");
    })
  );

  agentTest("kills the agent when its scope closes", () =>
    Effect.gen(function* () {
      const exited = yield* Effect.scoped(
        Effect.map(open(), ({ agent }) => agent.exited)
      );
      const { signal } = yield* exited;
      assert.strictEqual(signal, "SIGTERM");
    })
  );
});

describe("TerminalManager", () => {
  // real clock: a real command in a real terminal.
  it.live("runs a command, keeps its output and reports the exit", () =>
    Effect.gen(function* () {
      const terminals = yield* makeTerminalManager({ env: {} });
      const id = yield* terminals.create({
        args: ["-c", "echo out; echo err 1>&2; exit 3"],
        command: "/bin/sh",
        cwd: process.cwd(),
        env: {},
      });
      const exit = yield* terminals.waitForExit(id);
      const output = yield* terminals.output(id);
      assert.strictEqual(exit.exitCode, 3);
      assert.include(output.output, "out");
      assert.include(output.output, "err");
      assert.deepStrictEqual(output.exitStatus, exit);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  // real clock: a real command in a real terminal.
  it.live("keeps only the newest bytes past the limit", () =>
    Effect.gen(function* () {
      const terminals = yield* makeTerminalManager({ env: {} });
      const id = yield* terminals.create({
        args: ["-c", "printf 0123456789"],
        command: "/bin/sh",
        cwd: process.cwd(),
        env: {},
        outputByteLimit: 4,
      });
      yield* terminals.waitForExit(id);
      const output = yield* terminals.output(id);
      assert.strictEqual(output.output, "6789");
      assert.isTrue(output.truncated);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  // real clock: a real command in a real terminal.
  it.live("forgets a released terminal and kills what was still running", () =>
    Effect.gen(function* () {
      const terminals = yield* makeTerminalManager({ env: {} });
      const id = yield* terminals.create({
        args: ["30"],
        command: "sleep",
        cwd: process.cwd(),
        env: {},
      });
      yield* terminals.release(id);
      const error = yield* Effect.flip(terminals.output(id));
      assert.strictEqual(error._tag, "TerminalError");
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
