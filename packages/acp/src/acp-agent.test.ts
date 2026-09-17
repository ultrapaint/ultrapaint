import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { AgentConfig } from "@ultrapaint/contracts/threads";
import { type Duration, Effect, Fiber } from "effect";
import {
  type AcpHandlers,
  type SessionNotification,
  spawnAcpAgent,
} from "./acp-agent.ts";
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

const refuse = () => Effect.fail({ message: "not used in this test" });

const handlers = (overrides: Partial<AcpHandlers> = {}): AcpHandlers => ({
  onPermission: () => Effect.succeed({ outcome: { outcome: "cancelled" } }),
  onStderr: () => Effect.void,
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

/** Spawns the fake agent, opens a session and collects every update it sends. */
const open = Effect.fnUntraced(function* (
  overrides: Partial<AcpHandlers> = {},
  env: Record<string, string> = {},
  handlingTakes: Duration.Input = 0
) {
  const agent = yield* spawnAcpAgent(config(env), {
    cwd: process.cwd(),
    handlers: handlers(overrides),
  });
  const seen: string[] = [];
  yield* Effect.forkScoped(
    agent.consumeUpdates((n) =>
      Effect.andThen(
        Effect.sleep(handlingTakes),
        Effect.sync(() => seen.push(textOf(n)))
      )
    )
  );
  yield* agent.initialize;
  return { agent, seen };
});

describe("AcpAgent", () => {
  it.live("delivers every update before the prompt is reported as done", () =>
    Effect.gen(function* () {
      const { agent, seen } = yield* open();
      const { sessionId } = yield* agent.newSession(process.cwd());
      const response = yield* agent.prompt(sessionId, [
        { text: "reply please", type: "text" },
      ]);
      yield* agent.drained;
      assert.strictEqual(response.stopReason, "end_turn");
      assert.deepStrictEqual(seen, ["Thinking.", "Hello ", "world"]);
    })
  );

  it.live("waits for a consumer that is slower than the agent", () =>
    Effect.gen(function* () {
      // Persisting the transcript makes the real consumer lag behind the agent.
      const { agent, seen } = yield* open({}, {}, "40 millis");
      const { sessionId } = yield* agent.newSession(process.cwd());
      yield* agent.prompt(sessionId, [{ text: "reply", type: "text" }]);
      yield* agent.drained;
      assert.deepStrictEqual(seen, ["Thinking.", "Hello ", "world"]);
    })
  );

  it.live("routes a permission request to the handler and back", () =>
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
      yield* agent.drained;
      assert.deepStrictEqual(seen, ["permission:allow"]);
    })
  );

  it.live("surfaces the agent's own explanation of a failed prompt", () =>
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

  it.live("fails the call in flight when the process exits", () =>
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

  it.live("ends a waiting turn with session/cancel", () =>
    Effect.gen(function* () {
      const { agent, seen } = yield* open();
      const { sessionId } = yield* agent.newSession(process.cwd());
      const turn = yield* Effect.forkScoped(
        agent.prompt(sessionId, [{ text: "wait", type: "text" }])
      );
      yield* Effect.repeat(Effect.sleep("10 millis"), {
        until: () => seen.includes("waiting"),
      });
      yield* agent.cancel(sessionId);
      assert.strictEqual((yield* Fiber.join(turn)).stopReason, "cancelled");
    })
  );

  it.live("reports a command that does not exist as a spawn error", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        spawnAcpAgent(
          { ...config(), command: "/nonexistent/agent-binary" },
          { cwd: process.cwd(), handlers: handlers() }
        )
      );
      assert.strictEqual(error._tag, "AcpSpawnError");
    })
  );

  it.live("kills the agent when its scope closes", () =>
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
  it.live("runs a command, keeps its output and reports the exit", () =>
    Effect.gen(function* () {
      const terminals = yield* makeTerminalManager;
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

  it.live("keeps only the newest bytes past the limit", () =>
    Effect.gen(function* () {
      const terminals = yield* makeTerminalManager;
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

  it.live("forgets a released terminal and kills what was still running", () =>
    Effect.gen(function* () {
      const terminals = yield* makeTerminalManager;
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
