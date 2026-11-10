/**
 * A thread's behaviour against an agent the test plays, in-process (`testing/threads.ts`): the
 * session's start, its turns, the queue, cancelling, permissions, questions and switching
 * agents. The agent's process, the SDK and the sandbox are `threads.test.ts`'s.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import type {
  CreateElicitationRequest,
  SessionUpdate,
} from "@ultrapaint/acp/acp-agent";
import { type ThreadItem, withChunk } from "@ultrapaint/contracts/threads";
import { Deferred, Effect, Fiber, FileSystem, Result, Stream } from "effect";
import { TestClock } from "effect/testing";
import { EventBus } from "./events.ts";
import { OpenProject } from "./project.ts";
import { DesignFiles } from "./services/design-files.ts";
import { AgentDiscovery } from "./services/threads/agent-discovery.ts";
import { ChatPreferences } from "./services/threads/chat-preferences.ts";
import {
  statusAfter,
  ThreadSessions,
} from "./services/threads/thread-session.ts";
import { ThreadStore } from "./services/threads/thread-store.ts";
import { perTest } from "./testing/each-test.ts";
import {
  type LaunchedAgent,
  ScriptedAgents,
} from "./testing/scripted-agents.ts";
import {
  briefingFor,
  FixtureProject,
  HeldTask,
  onThread,
  promptThread,
  SCRIPTED_SANDBOX_META,
  ThreadFixture,
  ThreadTest,
  type ThreadTestServices,
  taskFor,
  threadTest,
  threadWhen,
} from "./testing/threads.ts";
import { kinds, said, turnEnded, turnsEnded } from "./testing/turns.ts";

/**
 * A test on its own thread services, its own fixture and its own agents, on the test clock from
 * `TEST_EPOCH` (docs/TESTING.md rule 3).
 */
const test = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, ThreadTestServices>
) => perTest(ThreadTest).effect(name, body);

const send = (threadId: string, text: string) =>
  promptThread({ attachments: [], text, threadId });

/** A new thread whose first prompt has reached its agent: the agent, and the turn it plays. */
const started = Effect.fnUntraced(function* (
  text = "hello",
  agentId = "scripted"
) {
  const threads = yield* ThreadSessions;
  const agents = yield* ScriptedAgents;
  const { id: threadId } = yield* threads.create({ agentId });
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
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      const boot = yield* Deferred.make<void>();
      yield* agents.script({ booting: Deferred.await(boot) });
      const created = yield* threads.create({ agentId: "scripted" });
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

  test("tells the user how the agent signs in when it says it must, and signs in with none", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      yield* agents.script({
        authMethods: [
          { description: "Opens the browser", id: "chatgpt", name: "ChatGPT" },
          { id: "login", name: "Log in", type: "terminal" },
        ],
        requiresAuth: true,
      });
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
      yield* send(threadId, "hello");
      const agent = yield* agents.next;
      const { items, thread } = yield* threadWhen(
        threadId,
        (t) => t.status === "error"
      );
      const why =
        "Scripted is not signed in. It signs in with ChatGPT (Opens the browser), or with Log in, in a terminal.";
      assert.strictEqual(thread.error, why);
      // A turn whose session could not start says so in the transcript, as any failed turn does.
      assert.deepStrictEqual(kinds(items), ["user", "status"]);
      const last = items.at(-1);
      assert.strictEqual(
        last?.kind === "status" && last.text,
        `Turn failed: ${why}`
      );
      assert.deepStrictEqual(methodsOf(yield* agent.calls), [
        "initialize",
        "session/new",
      ]);
    }));

  test("cancels a turn whose agent is still starting, before it reaches the agent", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      const boot = yield* Deferred.make<void>();
      yield* agents.script({ booting: Deferred.await(boot) });
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
      yield* send(threadId, "hello");
      const agent = yield* agents.next;
      yield* onThread(threadId, (s) => s.cancel);
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
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      yield* agents.script({ booting: Effect.never });
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
      yield* send(threadId, "hello");
      const agent = yield* agents.next;
      yield* threads.delete(threadId);
      yield* agent.stopped;
      assert.isUndefined(yield* store.get(threadId));
    }));

  test("stops the agent when its thread is deleted mid-turn", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const store = yield* ThreadStore;
      const { agent, threadId } = yield* started();
      yield* threads.delete(threadId);
      yield* agent.stopped;
      assert.isUndefined(yield* store.get(threadId));
    }));

  test("stops the agent of a thread whose delete is cut short, as a closing socket cuts a request", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const store = yield* ThreadStore;
      const { agent, threadId } = yield* started();
      // Begun at once, so the interrupt finds it where it first waits: the thread's file.
      const deleting = yield* Effect.forkChild(threads.delete(threadId), {
        startImmediately: true,
      });
      yield* Fiber.interrupt(deleting);
      yield* agent.stopped;
      assert.isUndefined(yield* store.get(threadId));
    }));

  test("keeps no session for a thread that is not there", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
      assert.strictEqual(
        yield* threads.of(threadId),
        yield* threads.of(threadId)
      );
      yield* threads.delete(threadId);
      // Asked for after its delete, as a request still on its way is: answered, and not kept.
      const late = yield* threads.of(threadId);
      assert.notStrictEqual(yield* threads.of(threadId), late);
      const error = yield* Effect.flip(
        late.prompt({ attachments: [], text: "hello", threadId })
      );
      assert.strictEqual(error._tag, "NotFound");
    }));

  test("keeps the mode with a mode option chosen before the session starts", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      yield* agents.script({
        configOptions: [
          {
            category: "mode",
            currentValue: "ask",
            id: "mode",
            name: "Mode",
            options: [
              { name: "Ask", value: "ask" },
              { name: "Auto", value: "auto" },
            ],
            type: "select",
          },
        ],
      });
      yield* (yield* AgentDiscovery).discover("scripted");
      yield* agents.next;
      // A new thread starts in the agent's automatic mode.
      const created = yield* threads.create({ agentId: "scripted" });
      assert.strictEqual(created.currentModeId, "auto");
      yield* onThread(created.id, (s) => s.setConfigOption("mode", "ask"));
      const thread = yield* store.get(created.id);
      assert.strictEqual(thread?.configOptions?.[0]?.currentValue, "ask");
      assert.strictEqual(thread?.currentModeId, "ask");
    }));

  test("says a thread that is not there is not found when an option is set on it", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        onThread("thread_gone_00001", (s) =>
          s.setConfigOption("model", "smart")
        )
      );
      assert.strictEqual(error._tag, "NotFound");
    }));

  test("applies a model and a mode chosen before the session starts, from what discovery learnt", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      yield* (yield* AgentDiscovery).discover("scripted");
      yield* agents.next;
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
      // No session yet: the thread keeps the choice for the one its first prompt starts.
      yield* onThread(threadId, (s) => s.setConfigOption("model", "smart"));
      yield* onThread(threadId, (s) => s.setMode("auto"));
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
      const threads = yield* ThreadSessions;
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

  test("resumes the stored session where the agent can, rather than load and replay it", () =>
    Effect.gen(function* () {
      const agents = yield* ScriptedAgents;
      yield* agents.script({ loadSession: true, resume: true });
      const first = yield* started();
      yield* first.turn.end();
      yield* threadWhen(first.threadId, turnEnded);
      yield* first.agent.exit(0);
      yield* first.agent.stopped;

      yield* send(first.threadId, "again");
      const agent = yield* agents.next;
      const turn = yield* agent.nextTurn;
      assert.deepStrictEqual(methodsOf(yield* agent.calls), [
        "initialize",
        "session/resume",
        "session/prompt",
      ]);
      assert.strictEqual(turn.sessionId, first.turn.sessionId);
      assert.deepStrictEqual(turn.texts, ["again"]);
    }));

  perTest(threadTest({ sandboxed: true })).effect(
    "reopens a stored session with what stops a confined agent's own sandbox",
    () =>
      Effect.gen(function* () {
        const agents = yield* ScriptedAgents;
        yield* agents.script({ loadSession: true });
        const first = yield* started();
        yield* first.turn.end();
        yield* threadWhen(first.threadId, turnEnded);
        yield* first.agent.exit(0);
        yield* first.agent.stopped;

        yield* send(first.threadId, "again");
        const agent = yield* agents.next;
        yield* agent.nextTurn;
        const reopened = (yield* agent.calls).find(
          (c) => c.method === "session/load"
        );
        assert.deepStrictEqual(
          (reopened?.params as { _meta?: unknown } | undefined)?._meta,
          SCRIPTED_SANDBOX_META
        );
      })
  );

  test("tells the agent who the client is, by the server's version", () =>
    Effect.gen(function* () {
      const { agent } = yield* started();
      const [initialize] = yield* agent.calls;
      assert.deepStrictEqual(
        (initialize?.params as { clientInfo?: unknown } | undefined)
          ?.clientInfo,
        { name: "ultrapaint", version: "test" }
      );
    }));

  test("ends with the project, and starts again with the next prompt", () =>
    Effect.gen(function* () {
      const project = yield* FixtureProject;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      const { agent, threadId, turn } = yield* started();
      yield* turn.say("working");
      yield* project.close;
      yield* agent.stopped;
      // A thread that was mid-turn does not stay running.
      assert.strictEqual((yield* store.get(threadId))?.status, "idle");

      yield* project.reopen;
      yield* send(threadId, "again");
      const next = yield* agents.next;
      yield* Effect.andThen(next.nextTurn, (t) => t.end());
      yield* threadWhen(threadId, (thread) => thread.status === "idle");
      assert.strictEqual(yield* agents.launched, 2);
    }));

  test("cannot prompt before a project is open", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const project = yield* FixtureProject;
      const store = yield* ThreadStore;
      yield* project.close;
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
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

  test("keeps the plan through a plan_update the editor never asked for", () =>
    Effect.gen(function* () {
      const { threadId, turn } = yield* started();
      const entries = [
        { content: "Draw the page", priority: "high", status: "in_progress" },
      ] as const;
      yield* turn.update({ entries: [...entries], sessionUpdate: "plan" });
      // Unstable, and shaped otherwise: sent only to a client that says it reads it.
      yield* turn.update({
        plan: { entries: [], planId: "plan_1" },
        sessionUpdate: "plan_update",
      } as unknown as SessionUpdate);
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
      const plan = items.find((i) => i.kind === "plan");
      assert.deepStrictEqual(plan?.kind === "plan" && plan.entries, [
        ...entries,
      ]);
    }));

  test("names an attached file by its URL, whatever its name holds", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      const { repo } = yield* ThreadFixture;
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
      const file = "designs/my page#2.page.json";
      yield* promptThread({
        attachments: [{ kind: "file", path: file }],
        text: "look",
        threadId,
      });
      const turn = yield* Effect.flatMap(agents.next, (a) => a.nextTurn);
      const uris = turn.prompt.flatMap((b) => {
        if (b.type === "resource") {
          return [b.resource.uri];
        }
        return b.type === "resource_link" ? [b.uri] : [];
      });
      assert.deepStrictEqual(uris, [pathToFileURL(path.join(repo, file)).href]);
    }));

  test("reads a text file from the person's disk into the prompt's text, named in the transcript", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      // An agent that takes nothing but text still reads it.
      yield* agents.script({ capabilities: { promptCapabilities: {} } });
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
      yield* promptThread({
        attachments: [
          { kind: "text", name: "brief.md", text: "# Brief\nA habit tracker" },
        ],
        text: "make this",
        threadId,
      });
      const turn = yield* Effect.flatMap(agents.next, (a) => a.nextTurn);
      const file = turn.prompt.find(
        (b) => b.type === "text" && b.text.includes("<attached-file")
      );
      assert.deepStrictEqual(file, {
        text: 'The user attached the file brief.md:\n<attached-file name="brief.md">\n# Brief\nA habit tracker\n</attached-file>',
        type: "text",
      });
      const { items } = yield* threadWhen(threadId, (_thread, all) =>
        all.some((i) => i.kind === "user")
      );
      const user = items.find((i) => i.kind === "user");
      assert.deepStrictEqual(user?.kind === "user" && user.attachments, [
        "brief.md",
      ]);
    }));

  test("sends what the agent takes: a file as a link, a picture as a note, where it says it takes neither", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      const { repo } = yield* ThreadFixture;
      yield* agents.script({
        capabilities: { promptCapabilities: {} },
      });
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
      yield* promptThread({
        attachments: [
          { kind: "file", path: "designs/home.page.json" },
          {
            dataUrl: "data:image/png;base64,AAAA",
            kind: "image",
            name: "shot",
          },
        ],
        text: "look",
        threadId,
      });
      const turn = yield* Effect.flatMap(agents.next, (a) => a.nextTurn);
      assert.deepStrictEqual(
        turn.prompt.map((b) => b.type),
        ["text", "text", "resource_link", "text"]
      );
      assert.deepStrictEqual(turn.prompt[2], {
        name: "home.page.json",
        type: "resource_link",
        uri: pathToFileURL(path.join(repo, "designs/home.page.json")).href,
      });
      assert.include(turn.texts.at(-1) ?? "", "picture");
    }));

  perTest(threadTest({ mcp: true })).effect(
    "offers the editor's MCP server to an agent that reaches one over http, and only then",
    () =>
      Effect.gen(function* () {
        const agents = yield* ScriptedAgents;
        /** How many MCP servers the agent's session was given. */
        const serversOf = (agent: LaunchedAgent) =>
          Effect.map(agent.calls, (calls) => {
            const opened = calls.find((c) => c.method === "session/new");
            return (opened?.params as { mcpServers?: unknown[] } | undefined)
              ?.mcpServers?.length;
          });
        const reaches = yield* started();
        assert.strictEqual(yield* serversOf(reaches.agent), 1);
        yield* agents.script({ capabilities: { mcpCapabilities: {} } });
        const cannot = yield* started();
        assert.strictEqual(yield* serversOf(cannot.agent), 0);
      })
  );

  perTest(threadTest({ mcp: true })).effect(
    "briefs an agent and words its task for the tools it was given, not the server's",
    () =>
      Effect.gen(function* () {
        const agents = yield* ScriptedAgents;
        const reaches = yield* started("/redraw marketing");
        assert.deepStrictEqual(reaches.turn.texts.slice(0, 2), [
          briefingFor("design", true),
          taskFor("redraw", "marketing", true),
        ]);
        // An agent that cannot reach the server is told to do it without the tools.
        yield* agents.script({ capabilities: { mcpCapabilities: {} } });
        const cannot = yield* started("/redraw marketing");
        assert.deepStrictEqual(cannot.turn.texts.slice(0, 2), [
          briefingFor("design"),
          taskFor("redraw", "marketing"),
        ]);
      })
  );

  test("offers each choice of an option the agent groups", () =>
    Effect.gen(function* () {
      const agents = yield* ScriptedAgents;
      yield* agents.script({
        configOptions: [
          {
            currentValue: "sonnet",
            id: "model",
            name: "Model",
            options: [
              {
                group: "anthropic",
                name: "Anthropic",
                options: [
                  { name: "Sonnet", value: "sonnet" },
                  { name: "Opus", value: "opus" },
                ],
              },
            ],
            type: "select",
          },
        ],
      });
      const { threadId, turn } = yield* started();
      yield* turn.end();
      const { thread } = yield* threadWhen(threadId, turnEnded);
      assert.deepStrictEqual(
        thread.configOptions?.[0]?.options.map((o) => o.value),
        ["sonnet", "opus"]
      );
    }));

  test("ends with what the turn spent, as ACP says it, and the thread says how full the context is", () =>
    Effect.gen(function* () {
      const { threadId, turn } = yield* started();
      yield* turn.update({
        cost: { amount: 0.12, currency: "USD" },
        sessionUpdate: "usage_update",
        size: 200_000,
        used: 1200,
      });
      yield* turn.answer({
        _meta: {
          quota: {
            model_usage: [{ model: "opus", token_count: { totalTokens: 15 } }],
          },
        },
        stopReason: "end_turn",
        usage: {
          cachedReadTokens: 3,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      });
      const { items, thread } = yield* threadWhen(threadId, turnEnded);
      const end = items.at(-1);
      assert.deepStrictEqual(end?.kind === "turn_end" && end.usage, {
        byModel: [{ model: "opus", tokens: 15 }],
        cachedReadTokens: 3,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
      assert.deepStrictEqual(thread.context, {
        cost: { amount: 0.12, currency: "USD" },
        size: 200_000,
        used: 1200,
      });
    }));

  test("reads what a turn spent from Codex's own accounting, where ACP's is not sent", () =>
    Effect.gen(function* () {
      const { threadId, turn } = yield* started();
      yield* turn.answer({
        _meta: {
          quota: {
            token_count: {
              cachedInputTokens: 2,
              inputTokens: 7,
              outputTokens: 4,
              totalTokens: 11,
            },
          },
        },
        stopReason: "end_turn",
      });
      const { items } = yield* threadWhen(threadId, turnEnded);
      const end = items.at(-1);
      assert.deepStrictEqual(end?.kind === "turn_end" && end.usage, {
        cachedReadTokens: 2,
        inputTokens: 7,
        outputTokens: 4,
        totalTokens: 11,
      });
    }));

  test("sends each chunk of a streamed reply alone, not with the reply so far", () =>
    Effect.gen(function* () {
      const events = yield* EventBus;
      const { threadId, turn } = yield* started();
      // Started at once, the fiber has subscribed by the time the fork returns.
      const sent = yield* Effect.forkChild(
        events.subscribe("agent").pipe(
          Stream.filterMap((ev) =>
            ev.type === "itemText" ? Result.succeed(ev.text) : Result.failVoid
          ),
          Stream.take(2),
          Stream.runCollect
        ),
        { startImmediately: true }
      );
      yield* turn.say("Hello ");
      yield* turn.say("world");
      yield* turn.say("!");
      // The first chunk opens the message; each one after is sent as itself.
      assert.deepStrictEqual(yield* Fiber.join(sent), ["world", "!"]);
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
      assert.deepStrictEqual(said(items), ["Hello world!"]);
    }));

  test("says where each chunk starts, so a transcript read mid-reply is continued by the chunks told before it and after", () =>
    Effect.gen(function* () {
      const events = yield* EventBus;
      const store = yield* ThreadStore;
      const { threadId, turn } = yield* started();
      // Started at once, the fiber has subscribed by the time the fork returns.
      const sent = yield* Effect.forkChild(
        events.subscribe("agent").pipe(
          Stream.filterMap((ev) =>
            ev.type === "itemText" ? Result.succeed(ev) : Result.failVoid
          ),
          Stream.take(3),
          Stream.runCollect
        ),
        { startImmediately: true }
      );
      yield* turn.say("Hello ");
      yield* turn.say("wor");
      // As `threads.items` answers an editor that opens the chat here: the chunk before it is
      // in the answer, and may reach that editor after it.
      const [read = ""] = said(yield* store.items(threadId));
      yield* turn.say("ld");
      yield* turn.say("!");
      const chunks = yield* Fiber.join(sent);
      assert.deepStrictEqual(
        chunks.map((c) => [c.offset, c.text]),
        [
          [6, "wor"],
          [9, "ld"],
          [11, "!"],
        ]
      );
      assert.strictEqual(read, "Hello wor");
      assert.strictEqual(
        chunks.reduce((held, chunk) => withChunk(held, chunk) ?? held, read),
        "Hello world!"
      );
    }));

  test("keeps the tail of a terminal's output in the tool call that ran it", () =>
    Effect.gen(function* () {
      const { agent, threadId, turn } = yield* started();
      const { terminalId } = yield* agent.host.terminal.create({
        args: ["-c", "echo built"],
        command: "/bin/sh",
        sessionId: turn.sessionId,
      });
      yield* turn.update({
        content: [{ terminalId, type: "terminal" }],
        kind: "execute",
        sessionUpdate: "tool_call",
        status: "in_progress",
        title: "Build",
        toolCallId: "call_1",
      });
      yield* agent.host.terminal.waitForExit({
        sessionId: turn.sessionId,
        terminalId,
      });
      yield* agent.host.terminal.release({
        sessionId: turn.sessionId,
        terminalId,
      });
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
      const tool = items.find((i) => i.kind === "tool");
      assert.deepStrictEqual(tool?.kind === "tool" && tool.content, [
        { output: "built\n", terminalId, type: "terminal" },
      ]);
    }));

  test("sets an option that is a switch as a boolean, and a choice as its value", () =>
    Effect.gen(function* () {
      const agents = yield* ScriptedAgents;
      yield* agents.script({
        configOptions: [
          { currentValue: false, id: "fast", name: "Fast", type: "boolean" },
          {
            currentValue: "false",
            id: "verbose",
            name: "Verbose",
            options: [
              { name: "Yes", value: "true" },
              { name: "No", value: "false" },
            ],
            type: "select",
          },
        ],
      });
      const { agent, threadId } = yield* started();
      yield* onThread(threadId, (s) => s.setConfigOption("fast", "true"));
      yield* onThread(threadId, (s) => s.setConfigOption("verbose", "true"));
      const set = (yield* agent.calls).filter(
        (c) => c.method === "session/set_config_option"
      );
      assert.deepStrictEqual(
        set.map((c) => (c.params as { value: unknown }).value),
        [true, "true"]
      );
    }));

  test("keeps the mode and the mode option the same, whichever the agent changes", () =>
    Effect.gen(function* () {
      const agents = yield* ScriptedAgents;
      yield* agents.script({
        configOptions: [
          {
            category: "mode",
            currentValue: "ask",
            id: "mode",
            name: "Mode",
            options: [
              { name: "Ask", value: "ask" },
              { name: "Auto", value: "auto" },
            ],
            type: "select",
          },
        ],
      });
      const { threadId, turn } = yield* started();
      yield* turn.update({
        currentModeId: "auto",
        sessionUpdate: "current_mode_update",
      });
      yield* turn.end();
      const { thread } = yield* threadWhen(threadId, turnEnded);
      assert.strictEqual(thread.currentModeId, "auto");
      assert.strictEqual(thread.configOptions?.[0]?.currentValue, "auto");
    }));

  test("keeps the commands the agent's session says it has, for the composer to offer", () =>
    Effect.gen(function* () {
      const { threadId, turn } = yield* started();
      yield* turn.update({
        availableCommands: [
          {
            description: "Review the changes",
            input: { hint: "<branch>" },
            name: "review",
          },
          { description: "Plan first", name: "create_plan" },
        ],
        sessionUpdate: "available_commands_update",
      });
      yield* turn.end();
      const { thread } = yield* threadWhen(threadId, turnEnded);
      assert.deepStrictEqual(thread.agentCommands, [
        {
          argument: "<branch>",
          description: "Review the changes",
          name: "review",
        },
        { description: "Plan first", name: "create_plan" },
      ]);
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

  test("reads a file for the agent, and says one that is not there is not found", () =>
    Effect.gen(function* () {
      const { repo } = yield* ThreadFixture;
      const { agent, turn } = yield* started();
      const read = yield* agent.host.readTextFile({
        limit: 1,
        path: path.join(repo, "designs/home.page.json"),
        sessionId: turn.sessionId,
      });
      assert.strictEqual(read.content, "{");
      const missing = yield* Effect.flip(
        agent.host.readTextFile({
          path: path.join(repo, "designs/gone.page.json"),
          sessionId: turn.sessionId,
        })
      );
      assert.strictEqual(
        (missing as { readonly _tag?: string })._tag,
        "ResourceNotFound"
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
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      const { home } = yield* ThreadFixture;
      const fs = yield* FileSystem.FileSystem;
      const store = path.join(home, "store");
      const { id: threadId } = yield* threads.create({ agentId: "scripted" });
      // The checkpoint taken before the turn cannot be written: an I/O error, a defect.
      yield* fs.remove(store, { force: true, recursive: true });
      yield* fs.writeFileString(store, "not a directory");
      yield* send(threadId, "hello");
      const agent = yield* agents.next;
      const broken = yield* threadWhen(threadId, (t) => t.status === "error");
      const last = broken.items.at(-1);
      assert.isTrue(
        last?.kind === "status" && last.text.startsWith("Turn failed:")
      );

      yield* fs.remove(store);
      yield* fs.makeDirectory(store);
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

/** The turn's end: the files credited to its agent, and those changed during it by others. */
const endOf = (items: readonly ThreadItem[]) => {
  const end = items.findLast((i) => i.kind === "turn_end");
  return end?.kind === "turn_end"
    ? { by: end.changedFiles, during: end.changedDuring ?? [] }
    : null;
};

describe("the files a turn changed", () => {
  test("are its agent's when nothing else changed files meanwhile, its shell's included", () =>
    Effect.gen(function* () {
      const { repo } = yield* ThreadFixture;
      const fs = yield* FileSystem.FileSystem;
      const { threadId, turn } = yield* started();
      // Written by the agent's own shell: the editor hears nothing of it.
      yield* fs.writeFileString(path.join(repo, "designs/shell.tsx"), "x\n");
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
      assert.deepStrictEqual(endOf(items), {
        by: ["designs/shell.tsx"],
        during: [],
      });
    }));

  test("of two turns at once are each credited only with what its agent was seen writing", () =>
    Effect.gen(function* () {
      const { repo } = yield* ThreadFixture;
      const fs = yield* FileSystem.FileSystem;
      const a = yield* started("first");
      const b = yield* started("second");
      // A writes through the editor, and edits a file it names in a tool call.
      yield* a.agent.host.writeTextFile({
        content: "export default function A() {}\n",
        path: path.join(repo, "designs/a.tsx"),
        sessionId: a.turn.sessionId,
      });
      yield* a.turn.update({
        kind: "edit",
        locations: [{ path: path.join(repo, "designs/edited.tsx") }],
        sessionUpdate: "tool_call",
        status: "pending",
        title: "Edit",
        toolCallId: "call_1",
      });
      yield* fs.writeFileString(path.join(repo, "designs/edited.tsx"), "e\n");
      // B writes through the editor, and a shell nobody can tell writes another.
      yield* b.agent.host.writeTextFile({
        content: "export default function B() {}\n",
        path: path.join(repo, "designs/b.tsx"),
        sessionId: b.turn.sessionId,
      });
      yield* fs.writeFileString(path.join(repo, "designs/shell.tsx"), "s\n");
      yield* a.turn.end();
      yield* b.turn.end();
      const first = yield* threadWhen(a.threadId, turnEnded);
      const second = yield* threadWhen(b.threadId, turnEnded);
      assert.deepStrictEqual(endOf(first.items), {
        by: ["designs/a.tsx", "designs/edited.tsx"],
        during: ["designs/b.tsx", "designs/shell.tsx"],
      });
      assert.deepStrictEqual(endOf(second.items), {
        by: ["designs/b.tsx"],
        during: ["designs/a.tsx", "designs/edited.tsx", "designs/shell.tsx"],
      });
    }));

  test("leave out of the agent's what the editor changed for the user meanwhile", () =>
    Effect.gen(function* () {
      const { repo } = yield* ThreadFixture;
      const fs = yield* FileSystem.FileSystem;
      const project = yield* OpenProject;
      const { agent, threadId, turn } = yield* started();
      yield* agent.host.writeTextFile({
        content: "export default function A() {}\n",
        path: path.join(repo, "designs/a.tsx"),
        sessionId: turn.sessionId,
      });
      // The user edits a page in the editor while the agent works.
      const page = "designs/home.page.json";
      yield* fs.writeFileString(path.join(repo, page), "{}\n");
      yield* project.service(DesignFiles)((files) =>
        files.report(page, "{}\n", { _tag: "Editor" })
      );
      yield* turn.end();
      const { items } = yield* threadWhen(threadId, turnEnded);
      assert.deepStrictEqual(endOf(items), {
        by: ["designs/a.tsx"],
        during: [page],
      });
    }));
});

describe("the queue", () => {
  test("holds a prompt sent while a turn runs, and the turn's end sends it", () =>
    Effect.gen(function* () {
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
      const taken = yield* onThread(threadId, (s) =>
        s.unqueue(busy?.queued?.[1]?.id ?? "")
      );
      assert.strictEqual(taken?.text, "third");
      assert.isNull(
        yield* onThread(threadId, (s) => s.unqueue(taken?.id ?? ""))
      );

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
      const store = yield* ThreadStore;
      const { agent, threadId, turn } = yield* started("first");
      yield* send(threadId, "second");
      yield* onThread(threadId, (s) => s.cancel);
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

      yield* onThread(threadId, (s) => s.sendQueued);
      const next = yield* agent.nextTurn;
      assert.include(next.texts, "second");
      yield* next.end();
      const after = yield* threadWhen(threadId, turnsEnded(2));
      assert.deepStrictEqual(after.thread.queued ?? [], []);
    }));

  test("a cancel after the turn ended leaves the thread alone, and the next prompt is sent", () =>
    Effect.gen(function* () {
      const store = yield* ThreadStore;
      const { agent, threadId, turn } = yield* started();
      yield* turn.end();
      yield* threadWhen(threadId, turnEnded);
      yield* onThread(threadId, (s) => s.cancel);
      assert.strictEqual((yield* store.get(threadId))?.status, "idle");
      assert.notInclude(methodsOf(yield* agent.calls), "session/cancel");

      // Sent, not queued behind a turn that is not there.
      yield* send(threadId, "again");
      yield* Effect.andThen(agent.nextTurn, (t) => t.end());
      const { thread } = yield* threadWhen(threadId, turnsEnded(2));
      assert.deepStrictEqual(thread.queued ?? [], []);
    }));
});

describe("the thread's status", () => {
  it("moves only as a turn, a cancel, an exit and a session's end allow", () => {
    assert.deepStrictEqual(statusAfter("idle", { _tag: "Prompted" }), {
      error: undefined,
      status: "running",
    });
    // A cancel stops a turn under way, and only that.
    assert.deepStrictEqual(statusAfter("running", { _tag: "CancelAsked" }), {
      status: "cancelling",
    });
    assert.isNull(statusAfter("idle", { _tag: "CancelAsked" }));
    assert.isNull(statusAfter("error", { _tag: "CancelAsked" }));
    // A cancel that outlived its turn takes the thread out of "cancelling", and only that.
    assert.deepStrictEqual(
      statusAfter("cancelling", { _tag: "CancelOutlived" }),
      { status: "idle" }
    );
    assert.isNull(statusAfter("idle", { _tag: "CancelOutlived" }));
    assert.isNull(statusAfter("running", { _tag: "CancelOutlived" }));
    // An exit is a failure only while the agent works on a turn it was not asked to stop.
    assert.deepStrictEqual(
      statusAfter("running", { _tag: "AgentExited", reason: "7" }),
      { error: "agent exited (7)", status: "error" }
    );
    assert.isNull(
      statusAfter("cancelling", { _tag: "AgentExited", reason: "7" })
    );
    // A session's end leaves a failure shown.
    assert.isNull(statusAfter("error", { _tag: "SessionClosed" }));
    assert.deepStrictEqual(statusAfter("running", { _tag: "SessionClosed" }), {
      status: "idle",
    });
  });

  test("a cancel with no turn under way leaves the status alone", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      // Nothing was ever sent: no agent is started to be told to stop.
      const { id: fresh } = yield* threads.create({ agentId: "scripted" });
      yield* onThread(fresh, (s) => s.cancel);
      assert.strictEqual((yield* store.get(fresh))?.status, "idle");
      assert.strictEqual(yield* agents.launched, 0);

      // A turn that failed: the failure stays shown, and the agent is not asked to stop.
      const { agent, threadId, turn } = yield* started();
      yield* turn.fail("usage limit reached");
      yield* threadWhen(threadId, (t) => t.status === "error");
      yield* onThread(threadId, (s) => s.cancel);
      const failed = yield* store.get(threadId);
      assert.strictEqual(failed?.status, "error");
      assert.strictEqual(failed?.error, "usage limit reached");
      assert.notInclude(methodsOf(yield* agent.calls), "session/cancel");
    }));

  test("a turn the user stops is idle once the agent has ended it", () =>
    Effect.gen(function* () {
      const store = yield* ThreadStore;
      const { threadId, turn } = yield* started();
      yield* onThread(threadId, (s) => s.cancel);
      assert.strictEqual((yield* store.get(threadId))?.status, "cancelling");
      // A second cancel while the agent stops changes nothing.
      yield* onThread(threadId, (s) => s.cancel);
      assert.strictEqual((yield* store.get(threadId))?.status, "cancelling");
      yield* turn.cancelled;
      yield* turn.end("cancelled");
      const { thread } = yield* threadWhen(threadId, turnEnded);
      assert.isUndefined(thread.error);
    }));
});

describe("a permission request", () => {
  test("is answered by the user's pick, which the card records", () =>
    Effect.gen(function* () {
      const { threadId, turn } = yield* started();
      const asking = yield* Effect.forkChild(turn.requestPermission(EDIT_HOME));
      const { items } = yield* threadWhen(threadId, has("permission"));
      const card = items.find((i) => i.kind === "permission");
      assert.strictEqual(card?.kind === "permission" && card.decision, null);
      assert.strictEqual(
        card?.kind === "permission" && card.title,
        "Edit home"
      );
      yield* onThread(threadId, (s) => s.cards.choose(card?.id ?? "", "allow"));
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
    }));

  test("is declined by the user, and asked again next time", () =>
    Effect.gen(function* () {
      const { agent, threadId, turn } = yield* started();
      const asking = yield* Effect.forkChild(turn.requestPermission(EDIT_HOME));
      const { items } = yield* threadWhen(threadId, has("permission"));
      const card = items.find((i) => i.kind === "permission");
      yield* onThread(threadId, (s) =>
        s.cards.choose(card?.id ?? "", "reject")
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
      const { threadId, turn } = yield* started();
      const asking = yield* Effect.forkChild(turn.requestPermission(EDIT_HOME));
      yield* threadWhen(threadId, has("permission"));
      yield* onThread(threadId, (s) => s.cancel);
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
      const { threadId } = yield* started();
      const error = yield* Effect.flip(
        onThread(threadId, (s) => s.cards.choose("perm_missing", "allow"))
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
      // A form sent now would come back with the card counted.
      const { cards } = yield* (yield* ThreadSessions).of(threadId);
      assert.strictEqual(yield* cards.formSent, "1");
      // Answered while the agent is still in its turn: it is waiting for exactly this.
      yield* onThread(threadId, (s) =>
        s.answer(card?.id ?? "", {
          plan: "pro",
          seats: "3",
        })
      );
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
      const store = yield* ThreadStore;
      const { card, reply, threadId } = yield* asked();
      yield* onThread(threadId, (s) => s.cards.decline(card?.id ?? ""));
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
      const { card, reply, threadId, turn } = yield* asked();
      yield* onThread(threadId, (s) => s.cancel);
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
        onThread(threadId, (s) => s.answer(card?.id ?? "", { plan: "free" }))
      );
      assert.include(late.message, "already answered");
    }));

  test("that cannot be drawn is declined, without a card", () =>
    Effect.gen(function* () {
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
      const { cards } = yield* (yield* ThreadSessions).of(threadId);
      assert.strictEqual(yield* cards.formSent, "0");
    }));
});

describe("switching a thread's agent", () => {
  test("stops the session, and tells the next agent what was said", () =>
    Effect.gen(function* () {
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      const { agent, threadId, turn } = yield* started();
      // Not while it works on a prompt.
      const busy = yield* Effect.flip(
        onThread(threadId, (s) => s.switchAgent("other"))
      );
      assert.strictEqual(busy._tag, "Conflict");
      yield* turn.say("Hi there");
      yield* turn.end();
      yield* threadWhen(threadId, turnEnded);

      yield* onThread(threadId, (s) => s.switchAgent("other"));
      yield* agent.stopped;
      const switched = yield* store.get(threadId);
      assert.strictEqual(switched?.agentId, "other");
      assert.isUndefined(switched?.sessionId);
      // A change of mind before the next prompt leaves one note, naming the last choice.
      yield* onThread(threadId, (s) => s.switchAgent("scripted"));
      yield* onThread(threadId, (s) => s.switchAgent("other"));
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

  test("is refused while a prompt is being accepted, whose turn goes on", () =>
    Effect.gen(function* () {
      const store = yield* ThreadStore;
      const held = yield* HeldTask;
      const { agent, threadId, turn } = yield* started();
      yield* turn.end();
      yield* threadWhen(threadId, turnEnded);
      // The next prompt is accepted and its turn begun, its task still being written for the
      // session (it is worded for the tools the session was given).
      const sending = yield* Effect.forkChild(send(threadId, "/hold"));
      yield* Deferred.await(held.reached);
      const refused = yield* Effect.flip(
        onThread(threadId, (s) => s.switchAgent("other"))
      );
      assert.strictEqual(refused._tag, "Conflict");
      yield* Deferred.succeed(held.release, undefined);
      yield* Fiber.join(sending);
      assert.strictEqual((yield* store.get(threadId))?.status, "running");
      // The same session takes it, and the turn ends as any does.
      const next = yield* agent.nextTurn;
      assert.include(next.texts.at(-1) ?? "", taskFor("hold"));
      yield* next.end();
      const { thread } = yield* threadWhen(threadId, turnsEnded(2));
      assert.strictEqual(thread.agentId, "scripted");
      assert.strictEqual(thread.status, "idle");
    }));
});

describe("discovery", () => {
  test("starts the agent to learn what its sessions offer, and gives it to waiting threads", () =>
    Effect.gen(function* () {
      const threads = yield* ThreadSessions;
      const agents = yield* ScriptedAgents;
      const store = yield* ThreadStore;
      const discovery = yield* AgentDiscovery;
      const { id: threadId } = yield* threads.create({ agentId: "other" });
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
