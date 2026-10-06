import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, FileSystem } from "effect";
import { runCommand } from "./process.ts";
import { TestEnv, TestServer } from "./testing/harness.ts";

/** Polls the thread until `done` holds. Agent turns report through the transcript. */
const waitForThread = (
  threadId: string,
  done: (thread: Thread, items: readonly ThreadItem[]) => boolean
) =>
  Effect.gen(function* () {
    const { client } = yield* TestEnv;
    const read = Effect.gen(function* () {
      const thread = (yield* client["threads.list"]()).find(
        (t) => t.id === threadId
      );
      const items = yield* client["threads.items"]({ threadId });
      return { items, thread };
    });
    return yield* read.pipe(
      Effect.tap(() => Effect.sleep("25 millis")),
      Effect.repeat({
        until: ({ items, thread }) => !!thread && done(thread, items),
      }),
      Effect.timeout("20 seconds")
    );
  });

const turnsEnded =
  (n: number) => (thread: Thread, items: readonly ThreadItem[]) =>
    thread.status === "idle" &&
    items.at(-1)?.kind === "turn_end" &&
    items.filter((i) => i.kind === "turn_end").length === n;

const startThread = (agentId = "fake") =>
  Effect.flatMap(TestEnv, ({ client }) =>
    Effect.map(client["threads.create"]({ agentId }), (t) => t.id)
  );

const prompt = (threadId: string, text: string) =>
  Effect.flatMap(TestEnv, ({ client }) =>
    client["threads.prompt"]({ attachments: [], text, threadId })
  );

/** How many processes run with `marker` among their arguments. */
const processesMarked = (marker: string) =>
  Effect.map(
    runCommand("ps", ["-eo", "args"], { cwd: "/" }),
    ({ stdout }) => stdout.split("\n").filter((l) => l.includes(marker)).length
  );

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "a thread's lifecycle",
  (it) => {
    it.effect(
      "leaves an ended turn alone when it is cancelled, and takes the next prompt",
      () =>
        Effect.gen(function* () {
          const { client, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const threadId = yield* startThread();
          yield* prompt(threadId, "reply");
          yield* waitForThread(threadId, turnsEnded(1));

          yield* client["threads.cancel"]({ threadId });
          const after = (yield* client["threads.list"]()).find(
            (t) => t.id === threadId
          );
          assert.strictEqual(after?.status, "idle");

          // Sent, not queued behind a turn that is not there.
          yield* prompt(threadId, "reply");
          const { thread } = yield* waitForThread(threadId, turnsEnded(2));
          assert.deepStrictEqual(thread?.queued ?? [], []);
        }),
      30_000
    );

    it.effect(
      "answers a pending permission request with cancelled when the turn is stopped",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const threadId = yield* startThread();
          yield* prompt(threadId, "permission");
          yield* waitForThread(threadId, (_, transcript) =>
            transcript.some((i) => i.kind === "permission")
          );
          yield* client["threads.cancel"]({ threadId });
          const { items } = yield* waitForThread(threadId, turnsEnded(1));
          const request = items.find((i) => i.kind === "permission");
          assert.strictEqual(
            request?.kind === "permission" && request.decision,
            "cancelled"
          );
          assert.include(
            items.map((i) => (i.kind === "agent" ? i.text : "")),
            "permission:cancelled"
          );
        }),
      30_000
    );

    it.effect(
      "stops the agent of a thread deleted while the agent starts",
      () =>
        Effect.gen(function* () {
          const { client, home, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* client["settings.set"](settings);
          const marker = `slow-${Date.now()}`;
          const fakeAgent = path.resolve(
            import.meta.dirname,
            "../../../packages/acp/testing/fake-agent.mjs"
          );
          yield* fs.writeFileString(
            path.join(home, "agents", "fake-slow.json"),
            JSON.stringify({
              args: [fakeAgent, "--slow-start", marker],
              command: process.execPath,
              id: "fake-slow",
              name: "Slow",
              stateDirs: [path.resolve(import.meta.dirname, "../../..")],
            })
          );
          const threadId = yield* startThread("fake-slow");
          yield* prompt(threadId, "reply");
          // The agent is up and still answering `initialize`.
          yield* processesMarked(marker).pipe(
            Effect.tap(() => Effect.sleep("50 millis")),
            Effect.repeat({ until: (n) => n > 0 }),
            Effect.timeout("10 seconds")
          );
          yield* client["threads.delete"]({ threadId });
          const left = yield* processesMarked(marker).pipe(
            Effect.tap(() => Effect.sleep("50 millis")),
            Effect.repeat({ until: (n) => n === 0 }),
            Effect.timeout("5 seconds")
          );
          assert.strictEqual(left, 0);
          yield* fs.remove(path.join(home, "agents", "fake-slow.json"));
        }),
      30_000
    );

    it.effect(
      "fails a turn that breaks on the way to the agent, and takes prompts again",
      () =>
        Effect.gen(function* () {
          const { home } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const checkpoints = path.join(home, "checkpoints");
          const threadId = yield* startThread();
          // The checkpoint taken before the turn cannot be written: an I/O error, a defect.
          yield* fs.remove(checkpoints, { recursive: true });
          yield* fs.writeFileString(checkpoints, "not a directory");
          yield* prompt(threadId, "reply");
          const broken = yield* waitForThread(
            threadId,
            (t) => t.status !== "running"
          );
          assert.strictEqual(broken.thread?.status, "error");
          const last = broken.items.at(-1);
          assert.isTrue(
            last?.kind === "status" && last.text.startsWith("Turn failed:")
          );

          yield* fs.remove(checkpoints);
          yield* fs.makeDirectory(checkpoints);
          yield* prompt(threadId, "reply");
          yield* waitForThread(threadId, turnsEnded(1));
        }),
      30_000
    );
  }
);
