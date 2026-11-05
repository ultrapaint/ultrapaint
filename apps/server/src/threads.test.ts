/**
 * Agent threads end to end: the real server over its socket, the fake agent's process
 * (`packages/acp/testing/fake-agent.mjs`) through the SDK, and the sandbox. What a thread does
 * with what its agent sends is `thread-session.test.ts`'s, against an agent played in-process;
 * these keep what only the process, the protocol and the sandbox show.
 */
import { homedir } from "node:os";
import path from "node:path";
import { assert } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Layer } from "effect";
import { runCommand } from "./process.ts";
import { eachTest } from "./testing/each-test.ts";
import { TestEnv, TestServer, waitForThread } from "./testing/harness.ts";
import { kinds, said, turnEnded, turnsEnded } from "./testing/turns.ts";
import { waitFor } from "./testing/wait-for.ts";

/** A thread is there at once; its agent starts with the first prompt. */
const startThreadWith = (agentId: string) =>
  Effect.map(TestEnv, ({ client }) =>
    client["threads.create"]({ agentId })
  ).pipe(
    Effect.flatten,
    Effect.map((thread) => thread.id)
  );

const startThread = startThreadWith("fake");

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

/** A server of the test's own, its fixture opened as saving its settings opens it. */
const Opened = Layer.effectDiscard(
  Effect.flatMap(TestEnv, ({ client, settings }) =>
    client["settings.set"](settings)
  )
).pipe(Layer.provideMerge(TestServer));

eachTest(Opened, {
  realClock:
    "the agent is a real process, its turns heard over the socket, and the sandbox real",
})("agent threads", (it) => {
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

  it.effect(
    "creates a thread without starting an agent, and starts it with the first prompt",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const created = yield* client["threads.create"]({ agentId: "fake" });
        assert.strictEqual(created.status, "idle");
        assert.strictEqual(created.title, "New chat");
        assert.isUndefined(created.sessionId);

        // The prompt is running as soon as it is sent; the agent boots inside the turn.
        yield* prompt(created.id, "reply to this\nand more");
        const sent = yield* waitForThread(created.id, () => true);
        assert.strictEqual(sent.thread?.status, "running");
        assert.deepStrictEqual(kinds(sent.items), ["user"]);

        const { items, thread } = yield* waitForThread(created.id, turnEnded);
        assert.deepStrictEqual(kinds(items), [
          "user",
          "thought",
          "agent",
          "turn_end",
        ]);
        assert.deepStrictEqual(said(items), ["Hello world"]);
        assert.strictEqual(thread?.title, "reply to this");
        assert.isDefined(thread?.sessionId);
        assert.strictEqual(thread?.currentModeId, "ask");
        assert.deepStrictEqual(
          thread?.modes?.map((m) => m.id),
          ["ask", "auto"]
        );
      }),
    30_000
  );

  it.effect(
    "resumes the stored session without replaying it into the transcript",
    () =>
      Effect.gen(function* () {
        const threadId = yield* startThreadWith("fake-load");
        yield* prompt(threadId, "reply");
        const before = yield* waitForThread(threadId, turnEnded);
        yield* prompt(threadId, "exit");
        yield* waitForThread(threadId, (t) => t.status === "error");

        yield* prompt(threadId, "reply");
        const { items, thread } = yield* waitForThread(threadId, turnEnded);
        assert.strictEqual(thread?.sessionId, before.thread?.sessionId);
        assert.notInclude(said(items), "replayed history");
      })
  );

  /** A question card the agent waits on, once it is in the thread. */
  const waitingCard = (threadId: string) =>
    Effect.map(
      waitForThread(threadId, (_, items) =>
        items.some((i) => i.kind === "question")
      ),
      ({ items }) => {
        const card = items.find((i) => i.kind === "question");
        return card?.kind === "question" ? card : undefined;
      }
    );

  it.effect(
    "draws a form the agent waits on as a card, and hands back the answers typed",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const threadId = yield* startThread;
        yield* prompt(threadId, "elicit");
        const card = yield* waitingCard(threadId);
        assert.deepStrictEqual(card?.elicitation, { message: "Pick a plan" });
        assert.deepStrictEqual(card?.questions, [
          {
            id: "plan",
            options: [
              { id: "free", label: "Free" },
              { id: "pro", label: "Pro" },
            ],
            question: "Which plan?",
          },
          {
            id: "seats",
            optional: true,
            options: [],
            question: "How many seats?",
            value: "integer",
          },
        ]);
        // Answered while the agent is still in its turn: it is waiting for exactly this.
        yield* client["threads.answer"]({
          answers: { plan: "pro", seats: "3" },
          itemId: card?.id ?? "",
          threadId,
        });
        const { items } = yield* waitForThread(threadId, turnEnded);
        assert.include(said(items), 'elicit:accept:{"plan":"pro","seats":3}');
        // No prompt of their own: the answers went back through the agent's tool.
        assert.lengthOf(
          items.filter((i) => i.kind === "user"),
          1
        );
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
    "refuses to write in .git for the agent, which the sandbox keeps read-only",
    () =>
      Effect.gen(function* () {
        const { repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const before = yield* fs.readFileString(path.join(repo, ".git/config"));
        const threadId = yield* startThread;
        yield* prompt(threadId, "write .git/config");
        const { items } = yield* waitForThread(threadId, turnEnded);
        assert.include(said(items).join("\n"), ".git/config is git's own");
        assert.strictEqual(
          yield* fs.readFileString(path.join(repo, ".git/config")),
          before
        );
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

  it.effect(
    "gives the agent the task a slash command stands for, and keeps what was typed",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const commands = yield* client["commands.list"]();
        assert.deepStrictEqual(
          commands.map((c) => c.name),
          [
            "setup",
            "init",
            "implement",
            "import-figma",
            "redraw",
            "design-system",
            "sync",
          ]
        );
        const threadId = yield* startThread;
        yield* prompt(threadId, "/init");
        const init = yield* waitForThread(threadId, turnEnded);
        // The fixture configures no components, which the system components make no matter.
        assert.include(
          said(init.items).join("\n"),
          "task:init Import this repository's design system"
        );
        assert.include(
          init.items.flatMap((i) => (i.kind === "user" ? [i.text] : [])),
          "/init"
        );

        // The thread designs and its agent is running: it cannot write the application, and
        // is told to send the user to an implement thread (ADR 0030).
        yield* prompt(threadId, "/implement /home");
        const refused = yield* waitForThread(
          threadId,
          (thread, items) =>
            turnEnded(thread, items) &&
            items.filter((i) => i.kind === "turn_end").length === 2
        );
        assert.include(
          said(refused.items).at(-1) ?? "",
          "task:implement The user ran /implement in a thread that designs"
        );
        assert.isUndefined(refused.thread?.purpose);

        // A thread that starts with /implement implements: its agent may write the repository.
        const implementing = yield* startThread;
        yield* prompt(implementing, "/implement /home");
        const implement = yield* waitForThread(implementing, turnEnded);
        assert.include(
          said(implement.items).at(-1) ?? "",
          "task:implement Implement the page Home of the design (designs/home.page.json)"
        );
        assert.strictEqual(implement.thread?.purpose, "implement");
        // Each command's task, with and without the tools, is tasks.test.ts's.
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
    "tells whoever would stop the server that an agent is at work, and stops it",
    () =>
      Effect.gen(function* () {
        const { client, port } = yield* TestEnv;
        const threadId = yield* startThread;
        yield* prompt(threadId, "wait");
        yield* waitForThread(threadId, (_, transcript) =>
          transcript.some((i) => i.kind === "agent" && i.text === "waiting")
        );
        const health = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${port}/api/health`).then(
            (r) => r.json() as Promise<{ readonly working?: number }>
          )
        );
        assert.isAtLeast(health.working ?? 0, 1);
        // `session/cancel` reaches the agent, which ends its turn as cancelled.
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
    "finishes starting a session and its turn when the request goes away",
    () =>
      Effect.gen(function* () {
        const threadId = yield* startThread;
        yield* prompt(threadId, "exit");
        yield* waitForThread(threadId, (t) => t.status === "error");

        // A page reload interrupts the request while the agent is still booting.
        const request = yield* Effect.forkScoped(prompt(threadId, "reply"));
        // The prompt has reached the server once the thread is out of its error.
        yield* waitForThread(threadId, (t) => t.status !== "error");
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
        yield* prompt(threadId, "reply");
        yield* waitForThread(threadId, turnEnded);
        // Saving settings closes the project scope and every agent with it.
        yield* client["settings.set"](settings);
        yield* waitForThread(threadId, (t) => t.status === "idle");

        yield* prompt(threadId, "reply");
        const { items, thread } = yield* waitForThread(threadId, turnsEnded(2));
        assert.strictEqual(thread?.status, "idle");
        assert.include(said(items), "Hello world");
      })
  );

  it.effect(
    "stops the agent of a thread deleted while the agent starts",
    () =>
      Effect.gen(function* () {
        const { client, home } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        // The server's home is the test's own: no other process names it.
        const marker = `slow-${path.basename(home)}`;
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
        const threadId = yield* startThreadWith("fake-slow");
        yield* prompt(threadId, "reply");
        // The agent is up and still answering `initialize`.
        yield* waitFor(processesMarked(marker), (n) => n > 0);
        yield* client["threads.delete"]({ threadId });
        const left = yield* waitFor(processesMarked(marker), (n) => n === 0, {
          within: "5 seconds",
        });
        assert.strictEqual(left, 0);
      }),
    30_000
  );
});
