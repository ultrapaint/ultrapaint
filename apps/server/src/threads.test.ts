import { homedir } from "node:os";
import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, Fiber, FileSystem } from "effect";
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

/** The turn is over once its end is in the transcript and the thread is idle again. */
const turnEnded = (thread: Thread, items: readonly ThreadItem[]) =>
  items.at(-1)?.kind === "turn_end" && thread.status === "idle";

const kinds = (items: readonly ThreadItem[]) => items.map((i) => i.kind);

const startThreadWith = (agentId: string) =>
  Effect.gen(function* () {
    const { client } = yield* TestEnv;
    const thread = yield* client["threads.create"]({ agentId });
    yield* waitForThread(
      thread.id,
      (t) => t.status === "idle" && !!t.sessionId
    );
    return thread.id;
  });

const startThread = startThreadWith("fake");

const prompt = (threadId: string, text: string) =>
  Effect.flatMap(TestEnv, ({ client }) =>
    client["threads.prompt"]({ attachments: [], text, threadId })
  );

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "agent threads",
  (it) => {
    it.effect("lists the built-in agents and the ones configured on disk", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const agents = yield* client["agents.list"]();
        assert.deepStrictEqual(
          agents.map((a) => [a.id, a.builtIn]),
          [
            ["claude-code", true],
            ["codex", true],
            ["fake-auth", false],
            ["fake-load", false],
            ["fake", false],
          ]
        );
      })
    );

    it.effect("cannot start a session before a repository is configured", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const thread = yield* client["threads.create"]({ agentId: "fake" });
        const { thread: failed } = yield* waitForThread(
          thread.id,
          (t) => t.status === "error"
        );
        assert.include(failed?.error ?? "", "no target repository");
        yield* client["threads.delete"]({ threadId: thread.id });
      })
    );

    it.effect("starts a session and advertises its modes", () =>
      Effect.gen(function* () {
        const { client, settings } = yield* TestEnv;
        yield* client["settings.set"](settings);
        const threadId = yield* startThread;
        const { thread } = yield* waitForThread(threadId, () => true);
        assert.strictEqual(thread?.title, "Fake thread");
        assert.strictEqual(thread?.currentModeId, "ask");
        assert.deepStrictEqual(
          thread?.modes?.map((m) => m.id),
          ["ask", "auto"]
        );
      })
    );

    it.effect("authenticates and retries when the agent asks for it", () =>
      Effect.gen(function* () {
        const threadId = yield* startThreadWith("fake-auth");
        const { thread } = yield* waitForThread(threadId, () => true);
        assert.isUndefined(thread?.error);
      })
    );

    it.effect(
      "resumes the stored session without replaying it into the transcript",
      () =>
        Effect.gen(function* () {
          const threadId = yield* startThreadWith("fake-load");
          const before = yield* waitForThread(threadId, () => true);
          yield* prompt(threadId, "exit");
          yield* waitForThread(threadId, (t) => t.status === "error");

          yield* prompt(threadId, "reply");
          const { items, thread } = yield* waitForThread(threadId, turnEnded);
          assert.strictEqual(thread?.sessionId, before.thread?.sessionId);
          assert.notInclude(
            items.map((i) => (i.kind === "agent" ? i.text : "")),
            "replayed history"
          );
        })
    );

    it.effect(
      "streams a reply into one thought and one message, in order",
      () =>
        Effect.gen(function* () {
          const threadId = yield* startThread;
          yield* prompt(threadId, "reply please");
          const { items, thread } = yield* waitForThread(threadId, turnEnded);
          assert.deepStrictEqual(kinds(items), [
            "user",
            "thought",
            "agent",
            "turn_end",
          ]);
          const agent = items.find((i) => i.kind === "agent");
          assert.strictEqual(
            agent?.kind === "agent" && agent.text,
            "Hello world"
          );
          assert.strictEqual(thread?.status, "idle");
        })
    );

    it.effect("tracks a tool call from pending to completed", () =>
      Effect.gen(function* () {
        const threadId = yield* startThread;
        yield* prompt(threadId, "tool");
        const { items } = yield* waitForThread(threadId, turnEnded);
        const tool = items.find((i) => i.kind === "tool");
        assert.deepStrictEqual(
          tool?.kind === "tool" && {
            content: tool.content,
            locations: tool.locations,
            status: tool.status,
            title: tool.title,
          },
          {
            content: [{ text: "file body", type: "text" }],
            locations: [{ path: "designs/home.tsx" }],
            status: "completed",
            title: "Read home",
          }
        );
      })
    );

    it.effect("asks the editor for permission and remembers the answer", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const threadId = yield* startThread;
        yield* prompt(threadId, "permission");
        const asked = yield* waitForThread(threadId, (_, items) =>
          items.some((i) => i.kind === "permission")
        );
        const request = asked.items.find((i) => i.kind === "permission");
        assert.strictEqual(
          request?.kind === "permission" && request.decision,
          null
        );
        yield* client["threads.permission"]({
          optionId: "allow",
          remember: true,
          requestId: request?.id ?? "",
          threadId,
        });
        const first = yield* waitForThread(threadId, turnEnded);
        const answered = first.items.find((i) => i.kind === "permission");
        assert.strictEqual(
          answered?.kind === "permission" && answered.decision,
          "allow"
        );
        assert.include(
          first.items.map((i) => (i.kind === "agent" ? i.text : "")),
          "permission:allow"
        );

        // Same kind of tool again: answered from memory, no second request.
        yield* prompt(threadId, "permission again");
        const second = yield* waitForThread(
          threadId,
          (_, items) => items.filter((i) => i.kind === "turn_end").length === 2
        );
        assert.lengthOf(
          second.items.filter((i) => i.kind === "permission"),
          1
        );
      })
    );

    it.effect(
      "refuses to answer a permission request that is not pending",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const threadId = yield* startThread;
          const error = yield* Effect.flip(
            client["threads.permission"]({
              optionId: "allow",
              remember: false,
              requestId: "perm_missing",
              threadId,
            })
          );
          assert.strictEqual(error._tag, "NotFound");
        })
    );

    it.effect(
      "lets the agent write inside the repository and attributes the file",
      () =>
        Effect.gen(function* () {
          const { repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const threadId = yield* startThread;
          yield* prompt(threadId, "write");
          const { items } = yield* waitForThread(threadId, turnEnded);
          const end = items.at(-1);
          assert.deepStrictEqual(end?.kind === "turn_end" && end.changedFiles, [
            "designs/agent.tsx",
          ]);
          const written = yield* fs.readFileString(
            path.join(repo, "designs/agent.tsx")
          );
          assert.include(written, "export default function Agent");
        })
    );

    it.effect(
      "keeps a terminal it runs for the agent inside the repository",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const threadId = yield* startThread;
          // The home directory is what the sandbox is there to protect. The temporary
          // directories are writable on purpose, so an escape there would prove nothing.
          const outside = path.join(homedir(), ".ultrapaint-test-escape.txt");
          yield* prompt(threadId, `escape ${outside}`);
          const { items, thread } = yield* waitForThread(threadId, turnEnded);
          const escaped = yield* fs.exists(outside);
          yield* Effect.ignore(fs.remove(outside));
          // Without a sandbox on this platform the command runs; the thread says as much.
          if (thread?.sandboxed !== true) {
            return;
          }
          assert.isFalse(escaped);
          assert.include(
            items.map((i) => (i.kind === "agent" ? i.text : "")).join(" "),
            "escape:"
          );
        })
    );

    it.effect("tells the agent about the project, once per session", () =>
      Effect.gen(function* () {
        const threadId = yield* startThread;
        yield* prompt(threadId, "blocks");
        const first = yield* waitForThread(threadId, turnEnded);
        assert.include(
          first.items.map((i) => (i.kind === "agent" ? i.text : "")),
          "blocks:1"
        );
        // The second prompt of the same session carries no briefing: the agent has it.
        yield* prompt(threadId, "blocks");
        const second = yield* waitForThread(
          threadId,
          (thread, items) =>
            turnEnded(thread, items) &&
            items.filter((i) => i.kind === "turn_end").length === 2
        );
        assert.include(
          second.items.map((i) => (i.kind === "agent" ? i.text : "")),
          "blocks:0"
        );
      })
    );

    it.effect(
      "does not brief a resumed session again, since it has the briefing back",
      () =>
        Effect.gen(function* () {
          const threadId = yield* startThreadWith("fake-load");
          yield* waitForThread(threadId, () => true);
          yield* prompt(threadId, "blocks");
          const first = yield* waitForThread(threadId, turnEnded);
          assert.include(
            first.items.map((i) => (i.kind === "agent" ? i.text : "")),
            "blocks:1"
          );
          // The agent goes away; the next prompt loads the stored session.
          yield* prompt(threadId, "exit");
          yield* waitForThread(threadId, (t) => t.status === "error");
          yield* prompt(threadId, "blocks");
          const answers = (items: readonly ThreadItem[]) =>
            items.flatMap((i) =>
              i.kind === "agent" && i.text.startsWith("blocks:") ? [i.text] : []
            );
          const resumed = yield* waitForThread(
            threadId,
            (thread, items) =>
              turnEnded(thread, items) && answers(items).length === 2
          );
          assert.deepStrictEqual(answers(resumed.items), [
            "blocks:1",
            "blocks:0",
          ]);
        })
    );

    it.effect("runs a terminal command for the agent", () =>
      Effect.gen(function* () {
        const threadId = yield* startThread;
        yield* prompt(threadId, "terminal");
        const { items } = yield* waitForThread(threadId, turnEnded);
        assert.include(
          items.map((i) => (i.kind === "agent" ? i.text : "")),
          "terminal:hi"
        );
      })
    );

    it.effect("shows the agent's own explanation when a turn fails", () =>
      Effect.gen(function* () {
        const threadId = yield* startThread;
        yield* prompt(threadId, "fail");
        const { items, thread } = yield* waitForThread(
          threadId,
          (t) => t.status === "error"
        );
        assert.strictEqual(thread?.error, "usage limit reached");
        const last = items.at(-1);
        assert.strictEqual(
          last?.kind === "status" && last.text,
          "Turn failed: usage limit reached"
        );
      })
    );

    it.effect(
      "marks the thread failed when the agent dies, and recovers on the next prompt",
      () =>
        Effect.gen(function* () {
          const threadId = yield* startThread;
          yield* prompt(threadId, "exit");
          const dead = yield* waitForThread(
            threadId,
            (t) => t.status === "error"
          );
          assert.include(dead.thread?.error ?? "", "agent exited");

          yield* prompt(threadId, "reply after restart");
          const { thread } = yield* waitForThread(threadId, turnEnded);
          assert.strictEqual(thread?.status, "idle");
        })
    );

    it.effect(
      "refuses a second prompt while a turn is running, then cancels it",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const threadId = yield* startThread;
          yield* prompt(threadId, "wait");
          yield* waitForThread(threadId, (_, transcript) =>
            transcript.some((i) => i.kind === "agent" && i.text === "waiting")
          );
          const busy = yield* Effect.flip(prompt(threadId, "reply"));
          assert.strictEqual(busy._tag, "Conflict");

          yield* client["threads.cancel"]({ threadId });
          const { items } = yield* waitForThread(threadId, turnEnded);
          const end = items.at(-1);
          assert.strictEqual(
            end?.kind === "turn_end" && end.stopReason,
            "cancelled"
          );
        })
    );

    it.effect(
      "checkpoints the designs before a turn and can revert to it",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const written = path.join(repo, "designs/agent.tsx");
          const checkpoints = yield* client["checkpoints.list"]();
          const beforeWrite = checkpoints.find(
            (c) => c.label === "Before: write"
          );
          assert.isDefined(beforeWrite);
          assert.notInclude(beforeWrite?.files ?? [], "designs/agent.tsx");

          const diff = yield* client["checkpoints.diff"]({
            id: beforeWrite?.id ?? "",
          });
          assert.deepStrictEqual(
            diff.map((d) => d.path),
            ["designs/agent.tsx"]
          );
          assert.include(diff[0]?.diff ?? "", "+export default function Agent");

          yield* client["checkpoints.revert"]({ id: beforeWrite?.id ?? "" });
          assert.isFalse(yield* fs.exists(written));
        })
    );

    it.effect(
      "finishes starting a session and its turn when the request goes away",
      () =>
        Effect.gen(function* () {
          const threadId = yield* startThread;
          yield* prompt(threadId, "exit");
          yield* waitForThread(threadId, (t) => t.status === "error");

          // A page reload interrupts the request while the agent is still booting.
          const request = yield* Effect.forkScoped(prompt(threadId, "reply"));
          yield* Effect.sleep("30 millis");
          yield* Fiber.interrupt(request);

          const { thread } = yield* waitForThread(threadId, turnEnded);
          assert.strictEqual(thread?.status, "idle");
        })
    );

    it.effect(
      "restarts the session of a thread after the project was reopened",
      () =>
        Effect.gen(function* () {
          const { client, settings } = yield* TestEnv;
          const threadId = yield* startThread;
          // Saving settings closes the project scope and every agent with it.
          yield* client["settings.set"](settings);
          yield* waitForThread(threadId, (t) => t.status === "idle");

          yield* prompt(threadId, "reply");
          const { items, thread } = yield* waitForThread(threadId, turnEnded);
          assert.strictEqual(thread?.status, "idle");
          assert.include(
            items.map((i) => (i.kind === "agent" ? i.text : "")),
            "Hello world"
          );
        })
    );

    it.effect("stops the agent when its thread is deleted", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const threadId = yield* startThread;
        yield* prompt(threadId, "wait");
        yield* waitForThread(threadId, (t) => t.status === "running");
        yield* client["threads.delete"]({ threadId });
        const remaining = yield* client["threads.list"]();
        assert.notInclude(
          remaining.map((t) => t.id),
          threadId
        );
      })
    );
  }
);
