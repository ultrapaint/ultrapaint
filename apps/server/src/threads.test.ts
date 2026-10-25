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

const turnsEnded =
  (n: number) => (thread: Thread, items: readonly ThreadItem[]) =>
    turnEnded(thread, items) &&
    items.filter((i) => i.kind === "turn_end").length === n;

const said = (items: readonly ThreadItem[]) =>
  items.flatMap((i) => (i.kind === "agent" ? [i.text] : []));

const kinds = (items: readonly ThreadItem[]) => items.map((i) => i.kind);

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

    it.effect("cannot prompt before a repository is configured", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const thread = yield* client["threads.create"]({ agentId: "fake" });
        assert.strictEqual(thread.status, "idle");
        const error = yield* Effect.flip(prompt(thread.id, "reply"));
        assert.strictEqual(error._tag, "NotConfigured");
        assert.lengthOf(
          yield* client["threads.items"]({ threadId: thread.id }),
          0
        );
        yield* client["threads.delete"]({ threadId: thread.id });
      })
    );

    it.effect(
      "creates a thread without starting an agent, and starts it with the first prompt",
      () =>
        Effect.gen(function* () {
          const { client, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const created = yield* client["threads.create"]({ agentId: "fake" });
          assert.strictEqual(created.status, "idle");
          assert.strictEqual(created.title, "New chat");
          assert.isUndefined(created.sessionId);

          // The prompt is running as soon as it is sent; the agent boots inside the turn.
          yield* prompt(created.id, "reply to this\nand more");
          const sent = yield* waitForThread(created.id, () => true);
          assert.strictEqual(sent.thread?.status, "running");
          assert.deepStrictEqual(kinds(sent.items), ["user"]);

          const { thread } = yield* waitForThread(created.id, turnEnded);
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

    it.effect("authenticates and retries when the agent asks for it", () =>
      Effect.gen(function* () {
        const threadId = yield* startThreadWith("fake-auth");
        yield* prompt(threadId, "reply");
        const { thread } = yield* waitForThread(threadId, turnEnded);
        assert.isUndefined(thread?.error);
      })
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

    it.effect("cancels a turn whose agent is still starting", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const threadId = yield* startThread;
        yield* prompt(threadId, "reply");
        yield* client["threads.cancel"]({ threadId });
        const { items } = yield* waitForThread(threadId, turnEnded);
        const end = items.at(-1);
        assert.strictEqual(
          end?.kind === "turn_end" && end.stopReason,
          "cancelled"
        );
        assert.notInclude(said(items), "Hello world");
      })
    );

    it.effect(
      "switches the agent of a thread and tells the next one what was said",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const threadId = yield* startThread;
          yield* prompt(threadId, "reply");
          yield* waitForThread(threadId, turnEnded);

          yield* client["threads.setAgent"]({ agentId: "fake-load", threadId });
          const switched = yield* waitForThread(
            threadId,
            (t, transcript) =>
              t.agentId === "fake-load" && transcript.at(-1)?.kind === "status"
          );
          assert.isUndefined(switched.thread?.sessionId);

          // A change of mind before the next prompt leaves one note, naming the last choice.
          yield* client["threads.setAgent"]({ agentId: "fake", threadId });
          yield* client["threads.setAgent"]({ agentId: "fake-load", threadId });
          const notes = (yield* client["threads.items"]({ threadId })).filter(
            (i) => i.kind === "status"
          );
          assert.deepStrictEqual(
            notes.map((i) => i.kind === "status" && i.text),
            ["Switched to Fake"]
          );

          yield* prompt(threadId, "history");
          const { items } = yield* waitForThread(threadId, turnsEnded(2));
          assert.include(said(items), "history:User: reply");

          // Only a session's first prompt carries it.
          yield* prompt(threadId, "history");
          const again = yield* waitForThread(threadId, turnsEnded(3));
          assert.strictEqual(said(again.items).at(-1), "history:none");
        }),
      30_000
    );

    it.effect(
      "applies a model chosen before the session starts, from what earlier sessions offered",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const known = yield* client["agents.options"]();
          assert.deepStrictEqual(
            known
              .find((a) => a.agentId === "fake")
              ?.configOptions.map((o) => [o.id, o.currentValue]),
            [["model", "fast"]]
          );
          const threadId = yield* startThread;
          yield* client["threads.setConfigOption"]({
            optionId: "model",
            threadId,
            value: "smart",
          });
          yield* prompt(threadId, "model");
          const { items, thread } = yield* waitForThread(threadId, turnEnded);
          assert.include(said(items), "model:smart");
          assert.strictEqual(thread?.configOptions?.[0]?.currentValue, "smart");
        })
    );

    it.effect("starts a new thread with the default agent and model", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        yield* client["chat.setDefaults"]({ agentId: "fake", model: "smart" });
        const thread = yield* client["threads.create"]({});
        yield* client["chat.setDefaults"]({});
        assert.strictEqual(thread.agentId, "fake");
        assert.strictEqual(thread.configOptions?.[0]?.currentValue, "smart");
        yield* prompt(thread.id, "model");
        const { items } = yield* waitForThread(thread.id, turnEnded);
        assert.include(said(items), "model:smart");
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

    it.effect("lets the user decline a form, and the agent hears so", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const threadId = yield* startThread;
        yield* prompt(threadId, "elicit");
        const card = yield* waitingCard(threadId);
        yield* client["threads.decline"]({ itemId: card?.id ?? "", threadId });
        const { items } = yield* waitForThread(threadId, turnEnded);
        assert.include(said(items), "elicit:decline:null");
        const declined = items.find((i) => i.kind === "question");
        assert.strictEqual(
          declined?.kind === "question" && declined.outcome,
          "declined"
        );
      })
    );

    it.effect("lets a form go when the turn is stopped", () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const threadId = yield* startThread;
        yield* prompt(threadId, "elicit");
        const card = yield* waitingCard(threadId);
        yield* client["threads.cancel"]({ threadId });
        const { items } = yield* waitForThread(threadId, turnEnded);
        assert.include(said(items), "elicit:cancel:null");
        const left = items.find((i) => i.kind === "question");
        assert.strictEqual(
          left?.kind === "question" && left.outcome,
          "cancelled"
        );
        const late = yield* Effect.flip(
          client["threads.answer"]({
            answers: { plan: "free" },
            itemId: card?.id ?? "",
            threadId,
          })
        );
        assert.include(late.message, "already answered");
      })
    );

    it.effect("declines what it cannot draw, without a card", () =>
      Effect.gen(function* () {
        const threadId = yield* startThread;
        yield* prompt(threadId, "elicit link");
        const { items } = yield* waitForThread(threadId, turnEnded);
        assert.include(said(items), "elicit:decline:null");
        assert.notInclude(kinds(items), "question");
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
      "gives the agent the task a slash command stands for, and keeps what was typed",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const commands = yield* client["commands.list"]();
          assert.deepStrictEqual(
            commands.map((c) => c.name),
            [
              "init",
              "implement",
              "import-figma",
              "redraw",
              "components",
              "design-system",
              "sync",
            ]
          );
          const threadId = yield* startThread;
          yield* prompt(threadId, "/init");
          const init = yield* waitForThread(threadId, turnEnded);
          // The fixture configures no components: the task says so first, and that the
          // configuration is not the agent's to fix.
          assert.include(
            said(init.items).join("\n"),
            "task:init Before anything else: the editor sees no components"
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

          yield* prompt(threadId, '/components ""');
          const components = yield* waitForThread(threadId, turnsEnded(3));
          assert.include(
            said(components.items).at(-1) ?? "",
            "task:components Draw a sheet of this repository's design system into the canvas"
          );
          yield* prompt(threadId, "/redraw nowhere to wireframes");
          const redraw = yield* waitForThread(threadId, turnsEnded(4));
          assert.include(
            said(redraw.items).at(-1) ?? "",
            'task:redraw The user ran /redraw, but there is no canvas "nowhere".'
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
      "queues a prompt sent while a turn runs, and keeps it when the turn is stopped",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const threadId = yield* startThread;
          yield* prompt(threadId, "wait");
          yield* waitForThread(threadId, (_, transcript) =>
            transcript.some((i) => i.kind === "agent" && i.text === "waiting")
          );
          yield* prompt(threadId, "reply");
          yield* prompt(threadId, "model");
          const { thread: busy } = yield* waitForThread(
            threadId,
            (t) => (t.queued?.length ?? 0) === 2
          );
          assert.deepStrictEqual(
            busy?.queued?.map((q) => q.text),
            ["reply", "model"]
          );

          // Taken back out to be edited: it is no longer sent.
          const second = busy?.queued?.[1];
          const taken = yield* client["threads.unqueue"]({
            id: second?.id ?? "",
            threadId,
          });
          assert.strictEqual(taken?.text, "model");

          yield* client["threads.cancel"]({ threadId });
          const { items, thread } = yield* waitForThread(threadId, turnEnded);
          const end = items.at(-1);
          assert.strictEqual(
            end?.kind === "turn_end" && end.stopReason,
            "cancelled"
          );
          // A stopped turn sends nothing on its own; the user does.
          assert.deepStrictEqual(
            thread?.queued?.map((q) => q.text),
            ["reply"]
          );
          yield* client["threads.sendQueued"]({ threadId });
          const after = yield* waitForThread(threadId, turnsEnded(2));
          assert.include(said(after.items), "Hello world");
          assert.deepStrictEqual(after.thread?.queued ?? [], []);
        })
    );

    it.effect("sends a queued prompt when the turn ends by itself", () =>
      Effect.gen(function* () {
        const threadId = yield* startThread;
        yield* prompt(threadId, "slow");
        yield* waitForThread(threadId, (_, transcript) =>
          transcript.some((i) => i.kind === "agent" && i.text === "slow:start")
        );
        yield* prompt(threadId, "reply");
        const { items, thread } = yield* waitForThread(threadId, turnsEnded(2));
        const users = items.filter((i) => i.kind === "user").map((i) => i.text);
        assert.deepStrictEqual(users, ["slow", "reply"]);
        assert.include(said(items), "Hello world");
        assert.deepStrictEqual(thread?.queued ?? [], []);
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
          const { items, thread } = yield* waitForThread(
            threadId,
            turnsEnded(2)
          );
          assert.strictEqual(thread?.status, "idle");
          assert.include(said(items), "Hello world");
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
