/**
 * A thread's behaviour against an agent the test plays, in-process (`testing/threads.ts`): the
 * session's start, its turns, the queue, cancelling, permissions, questions and switching
 * agents. The agent's process, the SDK and the sandbox are `threads.test.ts`'s.
 */
import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { CreateElicitationRequest } from "@ultrapaint/acp/acp-agent";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { Deferred, Effect, Fiber, FileSystem } from "effect";
import { TestClock } from "effect/testing";
import { ProjectManager } from "./project.ts";
import { AgentDiscovery } from "./services/threads/agent-discovery.ts";
import { ChatPreferences } from "./services/threads/chat-preferences.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { ThreadService } from "./services/threads/threads.ts";
import { ScriptedAgents } from "./testing/scripted-agents.ts";
import {
  briefingFor,
  ThreadFixture,
  ThreadTest,
  type ThreadTestServices,
  taskFor,
  threadWhen,
} from "./testing/threads.ts";
import { kinds, said, turnEnded, turnsEnded } from "./testing/turns.ts";

/** A test on its own thread services, its own fixture and its own agents. */
const test = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, ThreadTestServices>
) => it.effect(name, () => Effect.provide(body(), ThreadTest));

const send = (threadId: string, text: string) =>
  Effect.flatMap(ThreadService, (threads) =>
    threads.prompt({ attachments: [], text, threadId })
  );

/** A new thread whose first prompt has reached its agent: the agent, and the turn it plays. */
const started = Effect.fnUntraced(function* (
  text = "hello",
  agentId = "scripted"
) {
  const threads = yield* ThreadService;
  const agents = yield* ScriptedAgents;
  const { id: threadId } = yield* threads.create(agentId);
  yield* send(threadId, text);
  const agent = yield* agents.next;
  const turn = yield* agent.nextTurn;
  return { agent, threadId, turn };
});

const methodsOf = (calls: readonly { readonly method: string }[]) =>
  calls.map((c) => c.method);

const has =
  (kind: ThreadItem["kind"]) => (_: unknown, items: readonly ThreadItem[]) =>
    items.some((i) => i.kind === kind);

const PLAN_SCHEMA = {
  properties: {
    plan: {
      oneOf: [
        { const: "free", title: "Free" },
        { const: "pro", title: "Pro" },
      ],
      title: "Which plan?",
      type: "string",
    },
    seats: { title: "How many seats?", type: "integer" },
  },
  required: ["plan"],
  type: "object",
};

const planForm = (sessionId: string) =>
  ({
    message: "Pick a plan",
    mode: "form",
    requestedSchema: PLAN_SCHEMA,
    sessionId,
  }) as CreateElicitationRequest;

const EDIT_HOME = {
  options: [
    { kind: "allow_once" as const, name: "Allow", optionId: "allow" },
    { kind: "reject_once" as const, name: "Reject", optionId: "reject" },
  ],
  toolCall: { kind: "edit" as const, title: "Edit home", toolCallId: "call_2" },
};

describe("a thread's session", () => {
  test("is started by the first prompt, which runs while the agent boots", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      const boot = yield* Deferred.make<void>();
      yield* agents.script({ booting: Deferred.await(boot) });
      const created = yield* threads.create("scripted");
      assert.strictEqual(created.status, "idle");
      assert.strictEqual(created.title, "New chat");
      assert.strictEqual(yield* agents.launched, 0);

      yield* send(created.id, "reply to this\nand more");
      const agent = yield* agents.next;
      // The agent is still answering `initialize`; the prompt already shows as running.
      assert.strictEqual((yield* store.get(created.id))?.status, "running");
      assert.deepStrictEqual(kinds(yield* store.items(created.id)), ["user"]);
      yield* Deferred.succeed(boot, undefined);

      const turn = yield* agent.nextTurn;
      assert.deepStrictEqual(methodsOf(yield* agent.calls), [
        "initialize",
        "session/new",
        "session/prompt",
      ]);
      yield* turn.end();
      const { thread } = yield* threadWhen(created.id, turnEnded);
      assert.strictEqual(thread.title, "reply to this");
      assert.strictEqual(thread.sessionId, turn.sessionId);
      assert.strictEqual(thread.currentModeId, "ask");
      assert.deepStrictEqual(
        thread.modes?.map((m) => m.id),
        ["ask", "auto"]
      );
      // What the session offered is what the agent's next thread starts with.
      const preferences = yield* ChatPreferences;
      assert.deepStrictEqual(
        (yield* preferences.optionsFor("scripted")).configOptions?.map((o) => [
          o.id,
          o.currentValue,
        ]),
        [["model", "fast"]]
      );
    }));

  test("authenticates and asks again when the agent wants it", () =>
    Effect.gen(function* () {
      const agents = yield* ScriptedAgents;
      yield* agents.script({ requiresAuth: true });
      const { agent, threadId, turn } = yield* started();
      yield* turn.end();
      const { thread } = yield* threadWhen(threadId, turnEnded);
      assert.isUndefined(thread.error);
      assert.deepStrictEqual(methodsOf(yield* agent.calls).slice(0, 4), [
        "initialize",
        "session/new",
        "authenticate",
        "session/new",
      ]);
    }));

  test("cancels a turn whose agent is still starting, before it reaches the agent", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const agents = yield* ScriptedAgents;
      const boot = yield* Deferred.make<void>();
      yield* agents.script({ booting: Deferred.await(boot) });
      const { id: threadId } = yield* threads.create("scripted");
      yield* send(threadId, "hello");
      const agent = yield* agents.next;
      yield* threads.cancel(threadId);
      const { items } = yield* threadWhen(threadId, turnEnded);
      const end = items.at(-1);
      assert.strictEqual(
        end?.kind === "turn_end" && end.stopReason,
        "cancelled"
      );

      // The agent finishes starting; the cancelled prompt never reaches it, the next one does.
      yield* Deferred.succeed(boot, undefined);
      yield* send(threadId, "again");
      const turn = yield* agent.nextTurn;
      assert.include(turn.texts, "again");
      assert.notInclude(turn.texts, "hello");
      assert.strictEqual(yield* agents.launched, 1);
    }));

  test("stops the agent of a thread deleted while the agent starts", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      yield* agents.script({ booting: Effect.never });
      const { id: threadId } = yield* threads.create("scripted");
      yield* send(threadId, "hello");
      const agent = yield* agents.next;
      yield* threads.delete(threadId);
      yield* agent.stopped;
      assert.isUndefined(yield* store.get(threadId));
    }));

  test("stops the agent when its thread is deleted mid-turn", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const store = yield* ThreadStore;
      const { agent, threadId } = yield* started();
      yield* threads.delete(threadId);
      yield* agent.stopped;
      assert.isUndefined(yield* store.get(threadId));
    }));

  test("applies a model and a mode chosen before the session starts, from what discovery learnt", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const agents = yield* ScriptedAgents;
      yield* (yield* AgentDiscovery).discover("scripted");
      yield* agents.next;
      const { id: threadId } = yield* threads.create("scripted");
      // No session yet: the thread keeps the choice for the one its first prompt starts.
      yield* threads.setConfigOption(threadId, "model", "smart");
      yield* threads.setMode(threadId, "auto");
      yield* send(threadId, "hello");
      const agent = yield* agents.next;
      const turn = yield* agent.nextTurn;
      const calls = yield* agent.calls;
      assert.deepInclude(calls, {
        method: "session/set_config_option",
        params: {
          configId: "model",
          sessionId: turn.sessionId,
          value: "smart",
        },
      });
      assert.deepInclude(calls, {
        method: "session/set_mode",
        params: { modeId: "auto", sessionId: turn.sessionId },
      });
      yield* turn.end();
      const { thread } = yield* threadWhen(threadId, turnEnded);
      assert.strictEqual(thread.configOptions?.[0]?.currentValue, "smart");
      assert.strictEqual(thread.currentModeId, "auto");
    }));

  test("starts a new thread with the default agent and model", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const agents = yield* ScriptedAgents;
      const preferences = yield* ChatPreferences;
      // The agent's models are known once one of its sessions has offered them.
      const first = yield* started();
      yield* first.turn.end();
      yield* threadWhen(first.threadId, turnEnded);

      yield* preferences.setDefaults({ agentId: "scripted", model: "smart" });
      const thread = yield* threads.create();
      assert.strictEqual(thread.agentId, "scripted");
      assert.strictEqual(thread.configOptions?.[0]?.currentValue, "smart");
      yield* send(thread.id, "hello");
      const agent = yield* agents.next;
      const turn = yield* agent.nextTurn;
      assert.deepInclude(yield* agent.calls, {
        method: "session/set_config_option",
        params: {
          configId: "model",
          sessionId: turn.sessionId,
          value: "smart",
        },
      });
    }));

  test("resumes the stored session, without its replay or a second briefing", () =>
    Effect.gen(function* () {
      const agents = yield* ScriptedAgents;
      yield* agents.script({
        loadSession: true,
        replay: [
          {
            content: { text: "replayed history", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        ],
      });
      const first = yield* started();
      assert.include(first.turn.texts, briefingFor("design"));
      yield* first.turn.end();
      yield* threadWhen(first.threadId, turnEnded);
      // The agent goes away; the next prompt starts another, which loads the stored session.
      yield* first.agent.exit(0);
      yield* first.agent.stopped;

      yield* send(first.threadId, "again");
      const agent = yield* agents.next;
      const turn = yield* agent.nextTurn;
      assert.include(methodsOf(yield* agent.calls), "session/load");
      assert.notInclude(methodsOf(yield* agent.calls), "session/new");
      assert.strictEqual(turn.sessionId, first.turn.sessionId);
      // It has the conversation back, and the briefing with it.
      assert.deepStrictEqual(turn.texts, ["again"]);
      yield* turn.end();
      const { items, thread } = yield* threadWhen(
        first.threadId,
        turnsEnded(2)
      );
      assert.strictEqual(thread.sessionId, first.turn.sessionId);
      assert.notInclude(said(items), "replayed history");
    }));

  test("ends with the project, and starts again with the next prompt", () =>
    Effect.gen(function* () {
      const project = yield* ProjectManager;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      const { repo } = yield* ThreadFixture;
      const { agent, threadId, turn } = yield* started();
      yield* turn.say("working");
      yield* project.close;
      yield* agent.stopped;
      // A thread that was mid-turn does not stay running.
      assert.strictEqual((yield* store.get(threadId))?.status, "idle");

      yield* project.open(defaultSettings(repo));
      yield* send(threadId, "again");
      const next = yield* agents.next;
      yield* Effect.andThen(next.nextTurn, (t) => t.end());
      yield* threadWhen(threadId, (thread) => thread.status === "idle");
      assert.strictEqual(yield* agents.launched, 2);
    }));

  test("cannot prompt before a project is open", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const project = yield* ProjectManager;
      const store = yield* ThreadStore;
      yield* project.close;
      const { id: threadId } = yield* threads.create("scripted");
      const error = yield* Effect.flip(send(threadId, "hello"));
      assert.strictEqual(error._tag, "NotConfigured");
      assert.lengthOf(yield* store.items(threadId), 0);
    }));
});

describe("a turn", () => {
  test("streams a reply into one thought and one message, in order", () =>
    Effect.gen(function* () {
      const { threadId, turn } = yield* started("reply please");
      yield* turn.think("Thinking.");
      yield* turn.say("Hello ");
      yield* turn.say("world");
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
      assert.deepStrictEqual(kinds(items), [
        "user",
        "thought",
        "agent",
        "turn_end",
      ]);
      assert.deepStrictEqual(said(items), ["Hello world"]);
    }));

  test("tracks a tool call from pending to completed", () =>
    Effect.gen(function* () {
      const { repo } = yield* ThreadFixture;
      const { threadId, turn } = yield* started();
      yield* turn.update({
        kind: "read",
        // An agent names a file by absolute path; the transcript by its path in the repository.
        locations: [{ path: path.join(repo, "designs/home.tsx") }],
        sessionUpdate: "tool_call",
        status: "pending",
        title: "Read home",
        toolCallId: "call_1",
      });
      yield* turn.update({
        content: [
          { content: { text: "file body", type: "text" }, type: "content" },
        ],
        sessionUpdate: "tool_call_update",
        status: "completed",
        toolCallId: "call_1",
      });
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
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
    }));

  test("briefs the agent once per session, for the thread's purpose", () =>
    Effect.gen(function* () {
      const { agent, threadId, turn } = yield* started();
      assert.deepStrictEqual(turn.texts, [briefingFor("design"), "hello"]);
      yield* turn.end();
      yield* threadWhen(threadId, turnEnded);
      yield* send(threadId, "again");
      const second = yield* agent.nextTurn;
      assert.deepStrictEqual(second.texts, ["again"]);
    }));

  test("confines a design thread's agent to the designs; /implement makes an implement thread", () =>
    Effect.gen(function* () {
      const { repo } = yield* ThreadFixture;
      const store = yield* ThreadStore;
      const design = yield* started();
      assert.strictEqual(design.agent.writable, path.join(repo, "designs"));
      // Its agent is running: it is told to send the user to an implement thread (ADR 0030).
      yield* design.turn.end();
      yield* threadWhen(design.threadId, turnEnded);
      yield* send(design.threadId, "/implement /home");
      const refused = yield* design.agent.nextTurn;
      assert.include(
        refused.texts.join("\n"),
        "The user ran /implement in a thread that designs"
      );
      assert.isUndefined((yield* store.get(design.threadId))?.purpose);

      // A thread that starts with /implement implements: its agent may write the repository.
      const implement = yield* started("/implement /home");
      assert.isUndefined(implement.agent.writable);
      assert.deepStrictEqual(implement.turn.texts, [
        briefingFor("implement"),
        taskFor("implement", "/home"),
      ]);
      assert.strictEqual(
        (yield* store.get(implement.threadId))?.purpose,
        "implement"
      );
      // The transcript keeps what was typed.
      const [typed] = yield* store.items(implement.threadId);
      assert.strictEqual(
        typed?.kind === "user" && typed.text,
        "/implement /home"
      );
    }));

  test("writes for the agent in the designs, attributes the file, and refuses the rest", () =>
    Effect.gen(function* () {
      const { repo } = yield* ThreadFixture;
      const fs = yield* FileSystem.FileSystem;
      const { agent, threadId, turn } = yield* started();
      yield* agent.host.writeTextFile({
        content: "export default function Agent() {}\n",
        path: path.join(repo, "designs/agent.tsx"),
        sessionId: turn.sessionId,
      });
      const outside = yield* Effect.flip(
        agent.host.writeTextFile({
          content: "x",
          path: path.join(repo, "ui/button.tsx"),
          sessionId: turn.sessionId,
        })
      );
      assert.include(outside.message, "outside the designs directory");
      const git = yield* Effect.flip(
        agent.host.writeTextFile({
          content: "x",
          path: path.join(repo, "designs/.git/config"),
          sessionId: turn.sessionId,
        })
      );
      assert.include(git.message, "is git's own");
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
      const end = items.at(-1);
      assert.deepStrictEqual(end?.kind === "turn_end" && end.changedFiles, [
        "designs/agent.tsx",
      ]);
      assert.include(
        yield* fs.readFileString(path.join(repo, "designs/agent.tsx")),
        "function Agent"
      );
    }));

  test("fails with the agent's explanation, and takes prompts again", () =>
    Effect.gen(function* () {
      const { agent, threadId, turn } = yield* started();
      yield* turn.fail("usage limit reached");
      const { items, thread } = yield* threadWhen(
        threadId,
        (t) => t.status === "error"
      );
      assert.strictEqual(thread.error, "usage limit reached");
      const last = items.at(-1);
      assert.strictEqual(
        last?.kind === "status" && last.text,
        "Turn failed: usage limit reached"
      );
      yield* send(threadId, "again");
      yield* Effect.andThen(agent.nextTurn, (t) => t.end());
      const after = yield* threadWhen(threadId, turnEnded);
      assert.isUndefined(after.thread.error);
    }));

  test("fails a turn that breaks on the way to the agent, and takes prompts again", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const agents = yield* ScriptedAgents;
      const { home } = yield* ThreadFixture;
      const fs = yield* FileSystem.FileSystem;
      const checkpoints = path.join(home, "checkpoints");
      const { id: threadId } = yield* threads.create("scripted");
      // The checkpoint taken before the turn cannot be written: an I/O error, a defect.
      yield* fs.remove(checkpoints, { recursive: true });
      yield* fs.writeFileString(checkpoints, "not a directory");
      yield* send(threadId, "hello");
      const agent = yield* agents.next;
      const broken = yield* threadWhen(threadId, (t) => t.status === "error");
      const last = broken.items.at(-1);
      assert.isTrue(
        last?.kind === "status" && last.text.startsWith("Turn failed:")
      );

      yield* fs.remove(checkpoints);
      yield* fs.makeDirectory(checkpoints);
      yield* send(threadId, "again");
      yield* Effect.andThen(agent.nextTurn, (t) => t.end());
      yield* threadWhen(threadId, turnsEnded(1));
    }));

  test("fails when the agent exits mid-turn, and the next prompt starts another", () =>
    Effect.gen(function* () {
      const agents = yield* ScriptedAgents;
      const { agent, threadId, turn } = yield* started();
      yield* turn.say("working");
      yield* agent.exit(7);
      const dead = yield* threadWhen(threadId, (t) => t.status === "error");
      assert.include(dead.thread.error ?? "", "agent exited (7)");
      yield* agent.stopped;

      yield* send(threadId, "again");
      const next = yield* agents.next;
      yield* Effect.andThen(next.nextTurn, (t) => t.end());
      const { thread } = yield* threadWhen(threadId, turnEnded);
      assert.isUndefined(thread.error);
    }));
});

describe("the queue", () => {
  test("holds a prompt sent while a turn runs, and the turn's end sends it", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const store = yield* ThreadStore;
      const { agent, threadId, turn } = yield* started("first");
      yield* send(threadId, "second");
      yield* send(threadId, "third");
      const busy = yield* store.get(threadId);
      assert.deepStrictEqual(
        busy?.queued?.map((q) => q.text),
        ["second", "third"]
      );
      // Taken back out to be edited: it is no longer sent.
      const taken = yield* threads.unqueue(
        threadId,
        busy?.queued?.[1]?.id ?? ""
      );
      assert.strictEqual(taken?.text, "third");
      assert.isNull(yield* threads.unqueue(threadId, taken?.id ?? ""));

      yield* turn.end();
      const next = yield* agent.nextTurn;
      assert.include(next.texts, "second");
      yield* next.end();
      const { items, thread } = yield* threadWhen(threadId, turnsEnded(2));
      assert.deepStrictEqual(
        items.flatMap((i) => (i.kind === "user" ? [i.text] : [])),
        ["first", "second"]
      );
      assert.deepStrictEqual(thread.queued ?? [], []);
    }));

  test("keeps the queue when the turn is stopped, until the user sends it", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const store = yield* ThreadStore;
      const { agent, threadId, turn } = yield* started("first");
      yield* send(threadId, "second");
      yield* threads.cancel(threadId);
      // The agent is asked to stop, and the thread says so until it has.
      assert.strictEqual((yield* store.get(threadId))?.status, "cancelling");
      yield* turn.cancelled;
      yield* turn.end("cancelled");
      const { items, thread } = yield* threadWhen(threadId, turnEnded);
      const end = items.at(-1);
      assert.strictEqual(
        end?.kind === "turn_end" && end.stopReason,
        "cancelled"
      );
      assert.deepStrictEqual(
        thread.queued?.map((q) => q.text),
        ["second"]
      );

      yield* threads.sendQueued(threadId);
      const next = yield* agent.nextTurn;
      assert.include(next.texts, "second");
      yield* next.end();
      const after = yield* threadWhen(threadId, turnsEnded(2));
      assert.deepStrictEqual(after.thread.queued ?? [], []);
    }));

  test("a cancel after the turn ended leaves the thread alone, and the next prompt is sent", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const store = yield* ThreadStore;
      const { agent, threadId, turn } = yield* started();
      yield* turn.end();
      yield* threadWhen(threadId, turnEnded);
      yield* threads.cancel(threadId);
      assert.strictEqual((yield* store.get(threadId))?.status, "idle");
      assert.notInclude(methodsOf(yield* agent.calls), "session/cancel");

      // Sent, not queued behind a turn that is not there.
      yield* send(threadId, "again");
      yield* Effect.andThen(agent.nextTurn, (t) => t.end());
      const { thread } = yield* threadWhen(threadId, turnsEnded(2));
      assert.deepStrictEqual(thread.queued ?? [], []);
    }));
});

describe("a permission request", () => {
  test("is answered by the user, and remembered when asked to", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const { agent, threadId, turn } = yield* started();
      const asking = yield* Effect.forkChild(turn.requestPermission(EDIT_HOME));
      const { items } = yield* threadWhen(threadId, has("permission"));
      const card = items.find((i) => i.kind === "permission");
      assert.strictEqual(card?.kind === "permission" && card.decision, null);
      assert.strictEqual(
        card?.kind === "permission" && card.title,
        "Edit home"
      );
      yield* threads.resolvePermission(threadId, card?.id ?? "", "allow", true);
      assert.deepStrictEqual(yield* Fiber.join(asking), {
        outcome: { optionId: "allow", outcome: "selected" },
      });
      yield* turn.end();
      const first = yield* threadWhen(threadId, turnEnded);
      const answered = first.items.find((i) => i.kind === "permission");
      assert.strictEqual(
        answered?.kind === "permission" && answered.decision,
        "allow"
      );

      // The same kind of tool again: answered from memory, with no second card.
      yield* send(threadId, "again");
      const second = yield* agent.nextTurn;
      assert.deepStrictEqual(yield* second.requestPermission(EDIT_HOME), {
        outcome: { optionId: "allow", outcome: "selected" },
      });
      yield* second.end();
      const after = yield* threadWhen(threadId, turnsEnded(2));
      assert.lengthOf(
        after.items.filter((i) => i.kind === "permission"),
        1
      );
    }));

  test("is declined by the user, and asked again next time", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const { agent, threadId, turn } = yield* started();
      const asking = yield* Effect.forkChild(turn.requestPermission(EDIT_HOME));
      const { items } = yield* threadWhen(threadId, has("permission"));
      const card = items.find((i) => i.kind === "permission");
      yield* threads.resolvePermission(
        threadId,
        card?.id ?? "",
        "reject",
        false
      );
      assert.deepStrictEqual(yield* Fiber.join(asking), {
        outcome: { optionId: "reject", outcome: "selected" },
      });
      yield* turn.end();
      const first = yield* threadWhen(threadId, turnEnded);
      const declined = first.items.find((i) => i.kind === "permission");
      assert.strictEqual(
        declined?.kind === "permission" && declined.decision,
        "reject"
      );

      yield* send(threadId, "again");
      const second = yield* agent.nextTurn;
      yield* Effect.forkChild(second.requestPermission(EDIT_HOME));
      const again = yield* threadWhen(
        threadId,
        (_, all) => all.filter((i) => i.kind === "permission").length === 2
      );
      const open = again.items.at(-1);
      assert.strictEqual(open?.kind === "permission" && open.decision, null);
    }));

  test("is answered with cancelled when the turn is stopped", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const { threadId, turn } = yield* started();
      const asking = yield* Effect.forkChild(turn.requestPermission(EDIT_HOME));
      yield* threadWhen(threadId, has("permission"));
      yield* threads.cancel(threadId);
      assert.deepStrictEqual(yield* Fiber.join(asking), {
        outcome: { outcome: "cancelled" },
      });
      yield* turn.cancelled;
      yield* turn.end("cancelled");
      const { items } = yield* threadWhen(threadId, turnEnded);
      const card = items.find((i) => i.kind === "permission");
      assert.strictEqual(
        card?.kind === "permission" && card.decision,
        "cancelled"
      );
    }));

  test("that is not pending cannot be answered", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const { threadId } = yield* started();
      const error = yield* Effect.flip(
        threads.resolvePermission(threadId, "perm_missing", "allow", false)
      );
      assert.strictEqual(error._tag, "NotFound");
    }));
});

describe("a question the agent waits on", () => {
  /** The card of the form the turn asks, once it is in the thread, and the fiber waiting on it. */
  const asked = Effect.fnUntraced(function* () {
    const { threadId, turn } = yield* started();
    const reply = yield* Effect.forkChild(
      turn.elicit(planForm(turn.sessionId))
    );
    const { items } = yield* threadWhen(threadId, has("question"));
    const card = items.find((i) => i.kind === "question");
    return {
      card: card?.kind === "question" ? card : undefined,
      reply,
      threadId,
      turn,
    };
  });

  test("is drawn as a card, and the answers go back typed", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const { card, reply, threadId, turn } = yield* asked();
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
      assert.strictEqual(yield* threads.cardsShown(threadId), 1);
      // Answered while the agent is still in its turn: it is waiting for exactly this.
      yield* threads.answer(threadId, card?.id ?? "", {
        plan: "pro",
        seats: "3",
      });
      assert.deepStrictEqual(yield* Fiber.join(reply), {
        action: "accept",
        content: { plan: "pro", seats: 3 },
      });
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
      // No prompt of their own: the answers went back through the agent's tool.
      assert.lengthOf(
        items.filter((i) => i.kind === "user"),
        1
      );
    }));

  test("is declined by the user, and the agent hears so", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const store = yield* ThreadStore;
      const { card, reply, threadId } = yield* asked();
      yield* threads.decline(threadId, card?.id ?? "");
      assert.deepStrictEqual(yield* Fiber.join(reply), { action: "decline" });
      const declined = (yield* store.items(threadId)).find(
        (i) => i.kind === "question"
      );
      assert.strictEqual(
        declined?.kind === "question" && declined.outcome,
        "declined"
      );
    }));

  test("is let go when the turn is stopped, and cannot be answered after", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const { card, reply, threadId, turn } = yield* asked();
      yield* threads.cancel(threadId);
      assert.deepStrictEqual(yield* Fiber.join(reply), { action: "cancel" });
      yield* turn.cancelled;
      yield* turn.end("cancelled");
      const { items } = yield* threadWhen(threadId, turnEnded);
      const left = items.find((i) => i.kind === "question");
      assert.strictEqual(
        left?.kind === "question" && left.outcome,
        "cancelled"
      );
      const late = yield* Effect.flip(
        threads.answer(threadId, card?.id ?? "", { plan: "free" })
      );
      assert.include(late.message, "already answered");
    }));

  test("that cannot be drawn is declined, without a card", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const { threadId, turn } = yield* started();
      const reply = yield* turn.elicit({
        elicitationId: "el_1",
        message: "Sign in",
        mode: "url",
        sessionId: turn.sessionId,
        url: "https://example.com/sign-in",
      });
      assert.deepStrictEqual(reply, { action: "decline" });
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
      assert.notInclude(kinds(items), "question");
      assert.strictEqual(yield* threads.cardsShown(threadId), 0);
    }));
});

describe("switching a thread's agent", () => {
  test("stops the session, and tells the next agent what was said", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      const { agent, threadId, turn } = yield* started();
      // Not while it works on a prompt.
      const busy = yield* Effect.flip(threads.setAgent(threadId, "other"));
      assert.strictEqual(busy._tag, "Conflict");
      yield* turn.say("Hi there");
      yield* turn.end();
      yield* threadWhen(threadId, turnEnded);

      yield* threads.setAgent(threadId, "other");
      yield* agent.stopped;
      const switched = yield* store.get(threadId);
      assert.strictEqual(switched?.agentId, "other");
      assert.isUndefined(switched?.sessionId);
      // A change of mind before the next prompt leaves one note, naming the last choice.
      yield* threads.setAgent(threadId, "scripted");
      yield* threads.setAgent(threadId, "other");
      const notes = (yield* store.items(threadId)).flatMap((i) =>
        i.kind === "status" ? [i.text] : []
      );
      assert.deepStrictEqual(notes, ["Switched to Other"]);

      yield* send(threadId, "next");
      const other = yield* agents.next;
      assert.strictEqual(other.config.id, "other");
      const first = yield* other.nextTurn;
      const [about, recap, text] = first.texts;
      assert.strictEqual(about, briefingFor("design"));
      assert.include(recap ?? "", "<ultrapaint-history>");
      assert.include(recap ?? "", "User: hello");
      assert.strictEqual(text, "next");
      yield* first.end();
      yield* threadWhen(threadId, turnsEnded(2));

      // Only a session's first prompt carries it.
      yield* send(threadId, "more");
      const second = yield* other.nextTurn;
      assert.deepStrictEqual(second.texts, ["more"]);
    }));
});

describe("discovery", () => {
  test("starts the agent to learn what its sessions offer, and gives it to waiting threads", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadService;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      const discovery = yield* AgentDiscovery;
      const { id: threadId } = yield* threads.create("other");
      assert.isUndefined((yield* store.get(threadId))?.configOptions);
      const options = yield* discovery.discover("other");
      assert.deepStrictEqual(
        options.configOptions.map((o) => [o.id, o.currentValue]),
        [["model", "fast"]]
      );
      const probe = yield* agents.next;
      // Started, asked, stopped: no prompt, so no cost.
      yield* probe.stopped;
      assert.deepStrictEqual(methodsOf(yield* probe.calls), [
        "initialize",
        "session/new",
      ]);
      assert.deepStrictEqual(
        (yield* store.get(threadId))?.configOptions?.map((o) => o.id),
        ["model"]
      );
    }));

  test("gives up on an agent that does not answer within two minutes", () =>
    Effect.gen(function* () {
      const agents = yield* ScriptedAgents;
      const discovery = yield* AgentDiscovery;
      yield* agents.script({ booting: Effect.never }, "other");
      const asking = yield* Effect.forkChild(discovery.discover("other"));
      const probe = yield* agents.next;
      yield* TestClock.adjust("2 minutes");
      const error = yield* Effect.flip(Fiber.join(asking));
      assert.include(
        error.message,
        "Other did not list its models: no answer within 2 minutes"
      );
      yield* probe.stopped;
    }));
});
